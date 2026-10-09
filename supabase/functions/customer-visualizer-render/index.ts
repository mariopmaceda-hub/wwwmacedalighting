// Legacy paid renderer retired. Rendering runs synchronously through the session-authenticated API.
Deno.serve(() => new Response(JSON.stringify({ok:false,error:'Use customer-visualizer-api with your session to create a preview.'}), {status:410,headers:{'content-type':'application/json'}}));
