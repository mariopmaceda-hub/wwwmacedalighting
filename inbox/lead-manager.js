import {retentionText} from "./order-lifecycle.js";
// Lead mutations use the dashboard's authenticated request helper.
export async function renderLeadManager(ctx, view = "leads") {
  const trash = view !== "leads", archived = view === "archive";
  const {el, esc, ops, authFetch, url, openDetail, navigate} = ctx;
  let page = 0, items = [], total = 0, selected = new Set();
  let loading = false, mutating = false, request = 0, timer;
  el('content').innerHTML = `
    <div id="leadManager">
      <div class="section-head"><div><h2>${archived ? 'Archive' : trash ? 'Trash' : 'Leads'}</h2><p>One shared Trash bin for leads, customers, and jobs. Archived records stay restorable.</p></div><button class="btn" id="lmRefresh">Refresh</button></div>
      <div class="lm-actions" aria-label="Lead views"><button class="btn ${trash ? '' : 'btn-dark'}" id="lmActive" aria-pressed="${!trash}">Active leads</button><button class="btn ${view === 'trash' ? 'btn-dark' : ''}" id="lmTrash" aria-pressed="${view === 'trash'}">Trash</button><button class="btn ${archived ? 'btn-dark' : ''}" id="lmArchive" aria-pressed="${archived}">Archive</button></div>
      <p class="lm-note">Light removal completion starts 30 days before Trash. After 15 days in Trash, records move to Archive. Customer details, orders, photos, messages and payment history are preserved. Restore works from either view.</p>
      <div class="lm-tools"><label>Search leads<input id="lmSearch" type="search" placeholder="Name, phone, email or address"></label><label>Status<select id="lmStatus"><option value="">All statuses</option></select></label><label>Record type<select id="lmKind"><option value="">All records</option><option value="unverified">Unverified</option><option value="real">Verified customers</option><option value="test">Verified tests</option></select></label></div>
      <div id="lmNotice" class="lm-note hidden" role="status" aria-live="polite" tabindex="-1"></div>
      <div class="lm-actions"><label class="lm-select-all"><input id="lmAll" type="checkbox"> Select eligible on this page</label><button class="btn ${trash ? '' : 'btn-red'}" id="lmBulk" disabled>${trash ? 'Restore' : 'Move to Trash'} selected</button><span id="lmCount" aria-live="polite"></span></div>
      <div id="lmRows" class="lm-grid"></div>
      <div class="lm-actions"><button class="btn" id="lmPrev">Previous</button><span id="lmPage"></span><button class="btn" id="lmNext">Next</button></div>
    </div>`;
  const root = el('leadManager');
  const mounted = () => root.isConnected;
  const eligible = q => trash || !q.lead_protection_reason;
  function notice(message, protectedRows = []) {
    if (!mounted()) return;
    el('lmNotice').classList.remove('hidden');
    el('lmNotice').innerHTML = esc(message) + (protectedRows.length ? '<ul>' + protectedRows.map(q => `<li><strong>${esc(q.name || q.id || 'Lead')}</strong>: ${esc(q.reason || 'Payment or booking history')}</li>`).join('') + '</ul>' : '');
  }
  function controls() {
    if (!mounted()) return;
    const busy = loading || mutating, ids = items.filter(eligible).map(q => q.id);
    el('lmAll').checked = ids.length > 0 && ids.every(id => selected.has(id));
    el('lmAll').indeterminate = selected.size > 0 && !el('lmAll').checked;
    el('lmAll').disabled = busy || !ids.length;
    el('lmBulk').disabled = busy || !selected.size;
    el('lmCount').textContent = `${total} matching · ${selected.size} selected`;
    el('lmPrev').disabled = busy || page === 0;
    el('lmNext').disabled = busy || (page + 1) * 50 >= total;
    el('lmPage').textContent = `Page ${page + 1} of ${Math.max(1, Math.ceil(total / 50))}`;
    for (const id of ['lmRefresh', 'lmActive', 'lmTrash', 'lmArchive', 'lmSearch', 'lmStatus', 'lmKind']) el(id).disabled = mutating;
    root.querySelectorAll('[data-pick],[data-change]').forEach(n => {
      const q = items.find(q => q.id === (n.dataset.pick || n.dataset.change));
      n.disabled = busy || !eligible(q);
      if (n.dataset.pick) n.checked = selected.has(q.id);
    });
  }
  function draw() {
    el('lmRows').innerHTML = items.length ? items.map(q => `
      <article class="lm-card"><header><label class="lm-pick"><input type="checkbox" data-pick="${esc(q.id)}" aria-label="Select ${esc(q.name || 'unnamed lead')}"></label><h3>${esc(q.name || 'Unnamed customer')}</h3></header>
      <p>${esc(q.address || 'No address provided')}<br><span class="lm-muted">${esc(q.property_type || '')}</span></p>
      <p class="lm-muted">${esc(q.phone || 'No phone')}<br>${esc(q.email || 'No email')}</p>
      <p>${esc(q.status || 'No status')} · ${esc(q.preview_status || 'No preview')}</p>
      <p class="lm-muted">${esc((q.services || []).join(', '))}<br>Submitted ${esc(new Date(q.created_at).toLocaleString())}</p>
      ${trash && q.lead_trashed_at ? `<p class="lm-muted">Trashed ${esc(new Date(q.lead_trashed_at).toLocaleString())}</p>` : ''}
      <p class="lm-muted">${esc(retentionText(q))}</p>
      ${q.lead_protection_reason ? `<p class="lm-protected">Protected: ${esc(q.lead_protection_reason)}</p>` : ''}
      <footer><button class="btn" data-open="${esc(q.id)}">View details</button><button class="btn ${trash ? '' : 'btn-red'}" data-change="${esc(q.id)}">${trash ? 'Restore' : 'Move to Trash'}</button></footer></article>`).join('') : `<p class="lm-note">No matching ${trash ? 'trashed leads' : 'leads'}.</p>`;
    root.querySelectorAll('[data-pick]').forEach(n => n.onchange = () => {n.checked ? selected.add(n.dataset.pick) : selected.delete(n.dataset.pick); controls();});
    root.querySelectorAll('[data-open]').forEach(n => n.onclick = () => openDetail(n.dataset.open));
    root.querySelectorAll('[data-change]').forEach(n => n.onclick = () => change([n.dataset.change]));
    controls();
  }
  async function load() {
    if (!mounted()) return;
    const seq = ++request;
    loading = true; selected.clear(); controls();
    el('lmRows').innerHTML = '<p role="status">Loading leads…</p>';
    try {
      const j = await ops(view, {q: el('lmSearch').value.trim(), status: el('lmStatus').value, kind: el('lmKind').value, page});
      if (!mounted() || seq !== request) return;
      items = j.items || []; total = j.count || 0;
      if (page > 0 && !items.length) {page = Math.max(0, Math.ceil(total / 50) - 1); return await load();}
      const status = el('lmStatus').value;
      const statuses = [...new Set([...(j.statuses || []), ...(status ? [status] : [])])];
      el('lmStatus').innerHTML = '<option value="">All statuses</option>' + statuses.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
      el('lmStatus').value = status;
      el('lmActive').textContent = `Active leads (${j.active_count ?? 0})`;
      el('lmTrash').textContent = `Trash (${j.trash_count ?? 0})`;
      el('lmArchive').textContent = `Archive (${j.archive_count ?? 0})`;
      loading = false; draw();
    } catch (e) {
      if (!mounted() || seq !== request) return;
      items = []; total = 0;
      el('lmRows').textContent = 'Could not load leads. Use Refresh to retry.';
      notice(e.message);
    } finally {
      if (mounted() && seq === request) {loading = false; controls();}
    }
  }
  async function change(ids) {
    if (loading || mutating || !ids.length) return;
    const name = ids.length === 1 ? items.find(q => q.id === ids[0])?.name || 'this lead' : `${ids.length} selected leads`;
    if (!confirm(trash ? `Restore ${name} to active records? Automatic archiving will be paused.` : `Move ${name} to Trash? After 15 days it moves to Archive. All records are kept and can still be restored. External bookings and transactions are unchanged.`)) return;
    clearTimeout(timer); mutating = true; controls();
    try {
      const j = await authFetch(url, {method: 'POST', body: JSON.stringify({action: trash ? 'restore_leads' : 'trash_leads', ids})});
      notice(`${j.count ?? ids.length} lead(s) ${trash ? 'restored' : 'moved to Trash'}.`);
    } catch (e) {
      notice(e.message, e.status === 409 && Array.isArray(e.data?.protected) ? e.data.protected : []);
    } finally {
      if (mounted()) {await load(); mutating = false; controls(); el('lmNotice').focus();}
    }
  }
  el('lmAll').onchange = e => {selected.clear(); if (e.target.checked) items.filter(eligible).forEach(q => selected.add(q.id)); controls();};
  el('lmBulk').onclick = () => change([...selected]);
  el('lmRefresh').onclick = () => {if (!mutating) load();};
  el('lmActive').onclick = () => navigate('leads');
  el('lmTrash').onclick = () => navigate('trash');
  el('lmArchive').onclick = () => navigate('archive');
  el('lmPrev').onclick = () => {if (!loading && !mutating && page > 0) {page--; load();}};
  el('lmNext').onclick = () => {if (!loading && !mutating && (page + 1) * 50 < total) {page++; load();}};
  for (const id of ['lmStatus', 'lmKind']) el(id).onchange = () => {clearTimeout(timer); page = 0; load();};
  el('lmSearch').oninput = () => {clearTimeout(timer); timer = setTimeout(() => {if (mounted() && !mutating) {page = 0; load();}}, 250);};
  await load();
}
