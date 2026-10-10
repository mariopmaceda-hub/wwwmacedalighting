import { validateDesign } from '../supabase/functions/_shared/concept-contract.mjs';

// Incremental v1 editor: existing API, snapshots and quote handoff remain authoritative.
const surface = document.querySelector('#designStep .canvas');
const wrap = surface.querySelector('.picwrap');
surface.classList.add('editor-surface');
const toolbar = document.createElement('div');
toolbar.className = 'editor-toolbar';
toolbar.setAttribute('aria-label', 'Concept editing tools');
toolbar.innerHTML = '<button type="button" id="editorUndo" disabled>Undo</button><button type="button" id="editorRedo" disabled>Redo</button><button type="button" id="editorCompare" aria-pressed="false">Show original</button><span class="editor-spacer"></span><button type="button" id="editorZoomOut" aria-label="Zoom out">−</button><button type="button" id="editorZoomIn" aria-label="Zoom in">+</button><button type="button" id="editorFit">Fit photo</button>';
surface.before(toolbar);
const paint = document.createElement('canvas');
paint.className = 'editor-paint';
paint.setAttribute('aria-hidden', 'true');
wrap.append(paint);
const hits = svgEl('svg', { class: 'editor-hit-layer', preserveAspectRatio: 'none', 'aria-label': 'Detected lighting areas' });
wrap.append(hits);
const help = document.createElement('p');
help.className = 'editor-help';
help.id = 'editorHelp';
surface.after(help);
const legend = document.createElement('div');
legend.className = 'editor-legend';
legend.innerHTML = '<span>Selected lighting</span><span>Tap to add</span>';
help.after(legend);
const status = document.createElement('p');
status.id = 'editorPreviewStatus';
status.className = 'editor-status';
status.setAttribute('role', 'status');
legend.after(status);
const warning = document.createElement('p');
warning.id = 'editorWarning';
warning.className = 'editor-warning hidden';
warning.setAttribute('role', 'status');
status.after(warning);
const scaleNote = document.createElement('p');
scaleNote.className = 'editor-help';
scaleNote.textContent = 'Maceda installs C9 lights at 12-inch centers. Spacing and decoration sizes in this photo are illustrative. Measurements and final placement are confirmed on-site.';
warning.after(scaleNote);

const panels = [...document.querySelectorAll('#designStep .controls > .panel')];
const tabs = document.createElement('div');
tabs.className = 'editor-tabs';
tabs.setAttribute('aria-label', 'Design controls');
const sections = [['Style', [0]], ['Colors', [1]], ['Lights', [2]], ['Decor', [3]]];
let activeTab = 'Style';
sections.forEach(([name]) => {
  const b = button(name, '', () => { activeTab = name; refreshControls(); });
  b.dataset.section = name;
  tabs.append(b);
});
document.querySelector('#designStep .controls').prepend(tabs);

let zoom = 1, comparing = false, frame = 0, historyKey = '', past = [], future = [], current = null, restoring = false;
let worker, photoKey = '', photoEpoch = 0, photoReady = false, photoFailed = false, nextRequest = 0, activeRequest = 0, lastPaintKey = '', pendingPaintKey = '';
let workerBusy = false, queuedPaint = null;
const clone = value => JSON.parse(JSON.stringify(value));
const editState = () => clone({ preset: S.preset, color: S.color, zones: S.zones, decor: S.decor, placements: S.placements, directionChosen, colorChosen });
const stateKey = x => JSON.stringify(x);
function design() {
  return { ...S.s, selected_zones: [...S.zones], selected_decorations: [...S.decor], color_style: S.color, selections: { placements: clone(S.placements) }, catalog: S.catalog };
}
function usableZone(z) {
  if (!z) return false;
  return validateDesign({ source_photo_path: 'validation-only', design_revision: 0, install_zones: [z], selected_zones: [z.id], selections: { placements: [] } }, []).valid;
}
function validationMessage(result) {
  if (!S.zones.length && !S.placements.length) return 'Choose at least one lighting area or decoration.';
  if (!S.s?.source_photo_path) return 'Add your home photo before creating a preview.';
  if (S.zones.some(id => !usableZone(visible().find(z => z.id === id)))) return 'Some selected areas need review. Open Lights to remove areas marked “needs review”, or choose another style.';
  return 'A selected decoration or lighting area cannot be previewed. Choose another style or update your decoration locations.';
}
function resetHistoryIfNeeded() {
  const key = JSON.stringify([S.id, S.mode, epoch, S.s?.source_photo_path]);
  if (key !== historyKey) {
    historyKey = key; past = []; future = []; current = editState();
    comparing = false; surface.classList.remove('editor-original'); setZoom(1);
  }
}
function record() {
  resetHistoryIfNeeded();
  const next = editState();
  if (!restoring && current && stateKey(next) !== stateKey(current)) {
    past.push(current); if (past.length > 60) past.shift(); future = [];
  }
  current = next;
}
function restore(from, to) {
  if (S.busy || !from.length) return;
  to.push(editState()); const snapshot = from.pop();
  restoring = true;
  try {
    Object.assign(S, clone({ preset: snapshot.preset, color: snapshot.color, zones: snapshot.zones, decor: snapshot.decor, placements: snapshot.placements }));
    directionChosen = snapshot.directionChosen; colorChosen = snapshot.colorChosen;
    changed();
  } finally { restoring = false; }
}
$('editorUndo').onclick = () => restore(past, future);
$('editorRedo').onclick = () => restore(future, past);
$('editorCompare').onclick = () => {
  comparing = !comparing; surface.classList.toggle('editor-original', comparing); refreshControls();
};
function setZoom(value) {
  zoom = Math.max(1, Math.min(3, value)); wrap.style.width = `${zoom * 100}%`;
  if (zoom === 1) { surface.scrollLeft = 0; surface.scrollTop = 0; }
  $('editorZoomOut').disabled = zoom === 1; $('editorZoomIn').disabled = zoom === 3;
  $('editorFit').textContent = zoom === 1 ? 'Fit photo' : `${Math.round(zoom * 100)}% · Fit`;
}
$('editorZoomIn').onclick = () => setZoom(zoom + .5);
$('editorZoomOut').onclick = () => setZoom(zoom - .5);
$('editorFit').onclick = () => setZoom(1);
document.addEventListener('keydown', event => {
  if (stage !== 'design' || S.busy || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault(); event.shiftKey ? restore(future, past) : restore(past, future);
  }
});

function refreshControls() {
  const diy = S.mode === 'design_my_home';
  help.textContent = diy ? 'Tap a detected line to add or remove lights. Zoom in for a closer look; scroll to move around the photo. You can also choose areas from Lights.' : 'Compare your selected direction with the original photo, then choose your light color.';
  legend.hidden = !diy; tabs.hidden = !diy;
  panels.forEach((panel, index) => panel.classList.toggle('editor-panel-hidden', diy && !sections.find(([name]) => name === activeTab)[1].includes(index)));
  tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.section === activeTab)));
  $('editorUndo').disabled = S.busy || !past.length; $('editorRedo').disabled = S.busy || !future.length;
  $('editorCompare').setAttribute('aria-pressed', String(comparing));
  $('editorCompare').textContent = comparing ? 'Show lighting' : 'Show original';
  document.querySelectorAll('#zones [data-v]').forEach(b => {
    const z = visible().find(z => z.id === b.dataset.v), usable = usableZone(z);
    b.disabled = S.busy || !diy || (!usable && !S.zones.includes(b.dataset.v));
    b.textContent = (LABEL[z?.id] || z?.label || b.dataset.v) + (usable ? '' : ' · needs review');
  });
}
function drawHits() {
  hits.replaceChildren();
  const w = $('house').naturalWidth || 1000, h = $('house').naturalHeight || 700;
  hits.setAttribute('viewBox', `0 0 ${w} ${h}`);
  if (S.mode !== 'design_my_home' || S.busy) return;
  visible().filter(usableZone).forEach(z => {
    const points = z.polyline?.length >= 2 ? z.polyline : (() => { const [x,y,w,h] = z.bbox; return [[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]; })();
    const d = points.map((p,i) => `${i ? 'L' : 'M'} ${p[0]*w} ${p[1]*h}`).join(' ');
    const selected = S.zones.includes(z.id);
    const guide = svgEl('path', { d, class: `run-guide${selected ? ' run-selected' : ''}`, 'aria-hidden': 'true' });
    const target = svgEl('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': 44, 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'stroke', role: 'button', tabindex: 0, 'aria-label': `${selected ? 'Remove' : 'Add'} ${LABEL[z.id] || z.label || z.id} lighting`, 'aria-pressed': String(selected), 'data-zone': z.id });
    let start;
    target.onpointerdown = e => { start = [e.clientX,e.clientY]; };
    const toggle = () => { if (S.busy || comparing) return; S.zones = S.zones.includes(z.id) ? S.zones.filter(id => id !== z.id) : [...S.zones,z.id]; changed(); };
    target.onclick = e => { if (!start || Math.hypot(e.clientX-start[0],e.clientY-start[1]) < 10) toggle(); start = null; };
    target.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); requestAnimationFrame(() => [...hits.querySelectorAll('[data-zone]')].find(p => p.dataset.zone === z.id)?.focus()); } };
    hits.append(guide,target);
  });
}
function ensureWorker() {
  if (worker) return worker;
  worker = new Worker('/visualizer/concept-preview-worker.js', { type: 'module' });
  worker.onmessage = ({ data }) => {
    workerBusy = false;
    if (data.id === activeRequest && data.sourceId === photoEpoch && stage === 'design') {
      if (!data.error) {
        paint.width = data.width; paint.height = data.height;
        paint.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data.pixels), data.width, data.height), 0, 0);
        surface.classList.add('editor-painted'); lastPaintKey = pendingPaintKey;
        status.textContent = 'Layout guide only · create your night preview to see realistic lights';
      } else { surface.classList.remove('editor-painted'); status.textContent = 'Quick layout view. Create your preview to check the finished lighting.'; }
    }
    if (queuedPaint) { const next = queuedPaint; queuedPaint = null; sendPaint(next); }
  };
  worker.onerror = () => { workerBusy = false; queuedPaint = null; photoFailed = true; surface.classList.remove('editor-painted'); status.textContent = 'Quick layout view. Create your preview to check the finished lighting.'; };
  return worker;
}
function sendPaint(request) {
  if (workerBusy) { queuedPaint = request; return; }
  workerBusy = true; pendingPaintKey = request.key;
  ensureWorker().postMessage(request);
}
function loadPhoto() {
  const key = $('house').currentSrc || $('house').src;
  if (!key || key === photoKey) return;
  photoKey = key; photoReady = false; photoFailed = false; lastPaintKey = ''; queuedPaint = null; activeRequest = ++nextRequest;
  const token = ++photoEpoch; surface.classList.remove('editor-painted');
  const img = new Image(); img.crossOrigin = 'anonymous';
  img.onload = () => {
    if (token !== photoEpoch) return;
    try {
      if (img.naturalWidth > 2400 || img.naturalHeight > 2400) throw Error('Legacy image exceeds interactive limit.');
      const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img,0,0);
      const data = ctx.getImageData(0,0,canvas.width,canvas.height);
      ensureWorker().postMessage({ type: 'photo', sourceId: token, width: canvas.width, height: canvas.height, pixels: data.data.buffer }, [data.data.buffer]);
      photoReady = true; schedule();
    } catch { photoFailed = true; schedule(); }
  };
  img.onerror = () => { if (token === photoEpoch) { photoFailed = true; schedule(); } };
  img.src = key;
}
function refresh() {
  resetHistoryIfNeeded(); refreshControls(); drawHits();
  if (stage !== 'design') return;
  loadPhoto();
  const snapshot = design(), result = validateDesign(snapshot, S.catalog);
  const uncertain = visible().filter(z => !usableZone(z));
  warning.classList.toggle('hidden', result.valid && !uncertain.length);
  warning.textContent = !result.valid ? validationMessage(result) : `${uncertain.length} detected ${uncertain.length === 1 ? 'area needs' : 'areas need'} review. Choose supported areas, or add a clearer photo to improve detection.`;
  if (!result.valid) { $('render').disabled = true; activeRequest = ++nextRequest; queuedPaint = null; surface.classList.remove('editor-painted'); status.textContent = 'Choose supported lighting areas and decorations to preview.'; return; }
  if (!photoReady || photoFailed) { status.textContent = photoFailed ? 'Quick layout view. Create your preview to check the finished lighting.' : 'Preparing your concept view…'; return; }
  const key = JSON.stringify([photoEpoch, snapshot.color_style, snapshot.selected_zones, snapshot.selections, snapshot.install_zones]);
  if (key === lastPaintKey && surface.classList.contains('editor-painted')) return;
  activeRequest = ++nextRequest; surface.classList.remove('editor-painted');
  status.textContent = 'Updating your concept view…';
  sendPaint({ type: 'paint', id: activeRequest, sourceId: photoEpoch, snapshot, key });
}
function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(refresh); }

// Observe existing edits, retaining their save queue, draft fallback and stale-render guard.
const originalChanged = changed;
changed = function() {
  if (S.busy) return;
  activeRequest = ++nextRequest; queuedPaint = null;
  surface.classList.remove('editor-painted'); status.textContent = 'Updating your concept view…';
  $('renderStatus').classList.add('hidden');
  record(); originalChanged(); schedule();
};
const originalSync = sync;
sync = function() { originalSync(); schedule(); };
const originalDraw = draw;
draw = function() { originalDraw(); schedule(); };
const originalShowStage = showStage;
showStage = function(...args) { originalShowStage(...args); schedule(); };
window.MacedaConceptEditor = { usableZone };
// Apply the same v1 confidence/geometry checks in both journeys before selection.
const originalEligible = eligible;
eligible = function(d) { return originalEligible(d).filter(usableZone); };
const originalRender = $('render').onclick;
$('render').onclick = async function(...args) {
  const check = validateDesign(design(), S.catalog);
  if (!check.valid) { message('renderStatus', validationMessage(check), true); schedule(); return; }
  return originalRender.apply(this,args);
};
$('house').addEventListener('load', schedule);
window.addEventListener('resize', schedule);
schedule();
