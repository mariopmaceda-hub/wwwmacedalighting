export function retentionText(q) {
 const date = value => new Date(value).toLocaleString('en-US',{timeZone:'America/Los_Angeles',timeZoneName:'short'});
 if(q.archived_at)return 'Archived '+date(q.archived_at)+'. All records are preserved; restore anytime.';
 if(q.archive_due_at)return 'In the shared Trash bin. Archives '+date(q.archive_due_at)+'. Restore anytime.';
 if(q.automatic_hold)return 'Restored: automatic archiving is paused. Move to Trash manually when ready.';
 if(q.trash_due_at)return 'Removal finished. Moves to Trash '+date(q.trash_due_at)+', then Archive after 15 days.';
 return 'The 30-day timer starts only after light removal is marked completed.';
}
export async function trashOrders(ctx,ids,name){
 if(!confirm('Move '+name+' to the shared Trash bin? After 15 days these records move to Archive. All details and payment history are preserved; restore anytime. This does not cancel calendar bookings or Stripe transactions.'))return false;
 await ctx.authFetch(ctx.url,{method:'POST',body:JSON.stringify({action:'trash_leads',ids})});return true;
}
