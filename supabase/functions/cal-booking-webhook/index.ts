
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

function adminClient() {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!raw) throw new Error("SUPABASE_SECRET_KEYS unavailable");
  const keys = JSON.parse(raw);
  const secret = keys.default ?? Object.values(keys)[0];
  if (!secret) throw new Error("No Supabase secret key");
  return createClient(Deno.env.get("SUPABASE_URL")!, secret as string);
}

async function hmacHex(secret: string, body: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,"0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i=0;i<a.length;i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function getQuoteId(bodyText: string, payload: any): string {
  const candidates = [
    payload?.metadata?.quoteId,
    payload?.metadata?.quote_id,
    payload?.responses?.quoteId?.value,
    payload?.responses?.quoteId,
    payload?.responses?.quote_id?.value,
    payload?.responses?.quote_id,
    payload?.quoteId,
    payload?.quote_id
  ];
  for (const v of candidates) {
    const s = String(v ?? "").trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) return s;
  }
  const m = bodyText.match(/["']quote_?id["']\s*:\s*["']([0-9a-f-]{36})["']/i);
  return m?.[1] ?? "";
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status:405 });

  const webhookSecret = Deno.env.get("CAL_WEBHOOK_SECRET");
  if (!webhookSecret) {
    return new Response(JSON.stringify({ok:false,error:"CAL_WEBHOOK_SECRET not configured"}), {
      status:503, headers:{"content-type":"application/json"}
    });
  }

  const rawBody = await req.text();
  const headerSig = (req.headers.get("x-cal-signature-256") ?? "").trim();
  if (!headerSig || headerSig === "no-secret-provided") {
    return new Response(JSON.stringify({ok:false,error:"Missing Cal.com signature"}), {
      status:401, headers:{"content-type":"application/json"}
    });
  }

  const expectedHex = await hmacHex(webhookSecret, rawBody);
  const suppliedHex = headerSig.toLowerCase().replace(/^sha256=/,"");
  if (!safeEqual(expectedHex, suppliedHex)) {
    return new Response(JSON.stringify({ok:false,error:"Invalid Cal.com signature"}), {
      status:401, headers:{"content-type":"application/json"}
    });
  }

  let body:any;
  try { body = JSON.parse(rawBody); }
  catch {
    return new Response(JSON.stringify({ok:false,error:"Invalid JSON"}), {
      status:400, headers:{"content-type":"application/json"}
    });
  }

  const trigger = String(body?.triggerEvent ?? body?.type ?? "").toUpperCase();
  const payload = body?.payload ?? body?.data ?? body;
  const uid = String(payload?.uid ?? payload?.bookingUid ?? payload?.booking_uid ?? payload?.id ?? "");
  const createdAt = String(body?.createdAt ?? payload?.createdAt ?? "");
  const eventKey = [trigger,uid,createdAt].join("|") || crypto.randomUUID();

  const sb = adminClient();
  const { data: prior } = await sb.from("cal_webhook_events").select("event_key,status").eq("event_key",eventKey).maybeSingle();
  if (prior?.status === "processed") {
    return new Response(JSON.stringify({ok:true,duplicate:true}), {
      status:200, headers:{"content-type":"application/json"}
    });
  }

  await sb.from("cal_webhook_events").upsert({
    event_key:eventKey,
    trigger_event:trigger || null,
    booking_uid:uid || null,
    status:"received",
    error:null
  });

  try {
    // Unrelated lifecycle events need no quote association or deposit lookup.
    // Signature verification and the event ledger still run above.
    const affectsBooking = trigger.includes("CANCEL") || trigger.includes("BOOKING_CREATED") || trigger.includes("BOOKING_CONFIRMED") || trigger.includes("RESCHEDULE");
    if (!affectsBooking) {
      await sb.from("cal_webhook_events").update({status:"processed",processed_at:new Date().toISOString()}).eq("event_key",eventKey);
      return new Response(JSON.stringify({ok:true,ignored:true,trigger}), {status:200,headers:{"content-type":"application/json"}});
    }
    const quoteId = getQuoteId(rawBody, payload);
    if (!quoteId) throw new Error("Quote ID not found in Cal.com payload metadata.");

    const { data: quote, error:qErr } = await sb.from("quotes")
      .select("id,email,deposit_status,deposit_paid,deposit_required,scheduling_status,booking_link_sent_at")
      .eq("id", quoteId)
      .single();
    if (qErr || !quote) throw new Error("Matching quote not found.");

    if (
      quote.deposit_status !== "paid" ||
      Number(quote.deposit_paid ?? 0) < Number(quote.deposit_required ?? 0) ||
      Number(quote.deposit_required ?? 0) <= 0
    ) throw new Error("Scheduling blocked because the required deposit is not paid.");

    const attendeeEmail = String(payload?.attendees?.[0]?.email ?? payload?.attendee?.email ?? "").trim().toLowerCase();
    const quoteEmail = String(quote.email ?? "").trim().toLowerCase();
    if (quoteEmail && attendeeEmail && quoteEmail !== attendeeEmail) {
      console.warn("Cal booking attendee email differs from quote email", {
        quote_id: quoteId,
        booking_uid: uid || null
      });
    }

    const startTime = payload?.startTime ?? payload?.start_time ?? payload?.start ?? null;
    const endTime = payload?.endTime ?? payload?.end_time ?? payload?.end ?? null;

    if (trigger.includes("CANCEL")) {
      const { error:uErr } = await sb.from("quotes").update({
        scheduling_status:"ready",
        cal_booking_status:"cancelled",
        cal_booking_uid:uid || null,
        cal_booking_start_at:startTime,
        cal_booking_end_at:endTime,
        cal_booking_updated_at:new Date().toISOString(),
        installation_start_at:null
      }).eq("id",quoteId);
      if (uErr) throw uErr;
    } else if (trigger.includes("BOOKING_CREATED") || trigger.includes("BOOKING_CONFIRMED") || trigger.includes("RESCHEDULE")) {
      if (!startTime) throw new Error("Booking start time missing.");
      const { error:uErr } = await sb.from("quotes").update({
        scheduling_status:"booked",
        cal_booking_status:trigger.includes("RESCHEDULE") ? "rescheduled" : "booked",
        cal_booking_uid:uid || null,
        cal_booking_start_at:startTime,
        cal_booking_end_at:endTime,
        cal_booking_updated_at:new Date().toISOString(),
        installation_start_at:startTime
      }).eq("id",quoteId);
      if (uErr) throw uErr;
    } else {
      await sb.from("cal_webhook_events").update({
        status:"processed",
        processed_at:new Date().toISOString()
      }).eq("event_key",eventKey);
      return new Response(JSON.stringify({ok:true,ignored:true,trigger}), {
        status:200, headers:{"content-type":"application/json"}
      });
    }

    await sb.from("cal_webhook_events").update({
      status:"processed",
      processed_at:new Date().toISOString()
    }).eq("event_key",eventKey);

    return new Response(JSON.stringify({ok:true,quote_id:quoteId,trigger,booking_uid:uid || null}), {
      status:200, headers:{"content-type":"application/json"}
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from("cal_webhook_events").update({
      status:"failed",
      processed_at:new Date().toISOString(),
      error:msg
    }).eq("event_key",eventKey);
    return new Response(JSON.stringify({ok:false,error:msg}), {
      status:409, headers:{"content-type":"application/json"}
    });
  }
});
