import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const URL='https://gidqdlcvyasqalitqvcn.supabase.co',KEY='sb_publishable_bHlbA15kDnpoG4VA25rK0A_ollbphf0';
const sb=createClient(URL,KEY),el=id=>document.getElementById(id);
async function refresh(){
 el('quotes').replaceChildren();el('notifications').textContent='Unavailable';el('period').textContent='';el('classification').textContent='';
 try{const {data:{session}}=await sb.auth.getSession();if(!session){el('status').textContent='Sign in through Admin, then reopen this report.';return}
 el('status').textContent='Loading…';const r=await fetch(URL+'/functions/v1/marketing-report?days='+el('days').value,{headers:{Authorization:'Bearer '+session.access_token,apikey:KEY}});if(!r.ok)throw Error(r.status===401?'Your account does not have admin report access.':'Report unavailable. Try again shortly.');const j=await r.json(),q=j.report;
 for(const [label,n] of [['All completed',q.completed_quotes],['Door hanger',q.sources.door_hanger||0],['Yard sign',q.sources.yard_sign||0],['Flyer',q.sources.flyer||0],['Other sources',q.sources.other||0],['Unattributed',q.sources.unattributed||0]]){const d=document.createElement('div');d.className='card';const title=document.createElement('span'),v=document.createElement('strong');title.textContent=label;v.textContent=n;d.append(title,v);el('quotes').append(d)}
 el('period').textContent=new Date(j.since).toLocaleString()+' – '+new Date(j.until).toLocaleString();el('classification').textContent=q.unverified_classification+' included records have unverified real/test classification; review these in Admin before treating totals as real customers.';
 el('notifications').replaceChildren();for(const n of q.notifications){const p=document.createElement('p');p.textContent=n.channel.toUpperCase()+': '+n.state+' — '+n.total;el('notifications').append(p)}if(!q.notifications.length)el('notifications').textContent='No notification records in this period.';el('status').textContent='Database report refreshed.';
 }catch(e){el('status').textContent=e.message||'Report unavailable.'}
}
el('refresh').onclick=refresh;el('days').onchange=refresh;refresh();
