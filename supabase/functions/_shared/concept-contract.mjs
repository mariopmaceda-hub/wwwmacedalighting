/** Downstream contract only: never repairs or regenerates Concept Layout geometry. */
export const CONTRACT_VERSION = 'maceda-concept/1';
export const MIN_CONFIDENCE = 0.65;
const point = p => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1);
const box = b => Array.isArray(b) && b.length === 4 && b.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0) && b[2] > 0 && b[3] > 0 && b[0]+b[2] <= 1 && b[1]+b[3] <= 1;
const line = p => Array.isArray(p) && p.length >= 2 && p.every(point) && p.some(q => q[0] !== p[0][0] || q[1] !== p[0][1]);
function freeze(v) { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
export function validateDesign(s, catalog = []) {
  const errors = [], warnings = [];
  const zones = Array.isArray(s.install_zones) ? s.install_zones : [];
  const selected = Array.isArray(s.selected_zones) ? s.selected_zones : [];
  const rawPlacements = s.selections?.placements;
  const placements = Array.isArray(rawPlacements) ? rawPlacements : [];
  const used = new Set([...selected, ...(Array.isArray(placements) ? placements.map(p => p.zone_id) : [])]);
  const ids = new Set();
  for (const z of zones) {
    if (!z || typeof z.id !== 'string' || ids.has(z.id)) { errors.push('Duplicate or missing zone ID.'); continue; }
    ids.add(z.id);
    if (!used.has(z.id)) continue;
    if (z.visible === false) errors.push(z.id+': hidden zone cannot be rendered.');
    if (z.visible === undefined) warnings.push(z.id+': visibility was not explicitly recorded.');
    if (typeof z.confidence !== 'number' || !Number.isFinite(z.confidence) || z.confidence < MIN_CONFIDENCE || z.confidence > 1) errors.push(z.id+': confidence must be between 0.65 and 1.');
    if (z.polyline?.length && !line(z.polyline)) errors.push(z.id+': invalid polyline.');
    if (z.bbox?.length && !box(z.bbox)) errors.push(z.id+': invalid bounding box.');
    if (z.anchor?.length && !point(z.anchor)) errors.push(z.id+': invalid anchor.');
    if (selected.includes(z.id) && !line(z.polyline) && !box(z.bbox)) errors.push(z.id+': missing lighting geometry.');
    if (z.occlusion_masks !== undefined && (!Array.isArray(z.occlusion_masks) || !z.occlusion_masks.every(p => Array.isArray(p) && p.length >= 3 && p.every(point)))) errors.push(z.id+': unsupported occlusion mask.');
    if (z.occlusion_masks === undefined) warnings.push(z.id+': no explicit occlusion mask; only the supplied visible outline is used.');
  }
  for (const id of used) if (!ids.has(id)) errors.push(String(id)+': selected zone is missing.');
  if (!Array.isArray(rawPlacements)) errors.push('selections.placements must be an array.');
  const seen = new Set();
  for (const p of Array.isArray(placements) ? placements : []) {
    const d = catalog.find(d => d.id === p.catalog_id);
    if (!d || !['ring','drape','path','arch'].includes(d.concept_geometry)) errors.push('Unsupported decoration: '+String(p.catalog_id));
    if (d && !(d.allowed_zones || []).includes(p.zone_id)) errors.push('Decoration is not supported in '+p.zone_id);
    if (!point(p.anchor)) errors.push('Missing or invalid placement anchor: '+String(p.catalog_id));
    if (seen.has(p.catalog_id)) errors.push('Duplicate decoration placement: '+String(p.catalog_id));
    seen.add(p.catalog_id);
    if (p.scale_status !== 'concept_unmeasured' || (p.physical_dimensions !== null && p.physical_dimensions !== undefined)) errors.push('Unverified physical sizing is unsupported.');
  }
  for (const name of s.selected_decorations || []) if (!(placements || []).some(p => p.customer_name === name)) errors.push('Missing placement for '+name);
  if (!s.source_photo_path || !Number.isInteger(s.design_revision) || s.design_revision < 0) errors.push('Photo and design revision are required.');
  if (!selected.length && !(placements || []).length) errors.push('Choose at least one lighting area or decoration.');
  return { valid: errors.length === 0, errors, warnings };
}
export function createSnapshot(s, catalog, photoSha256) {
  const validation = validateDesign(s, catalog);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  if (!/^[a-f0-9]{64}$/.test(photoSha256)) throw new Error('Verified source photo digest required.');
  // JSON roundtrip detaches the snapshot from mutable session and catalog objects.
  return freeze(JSON.parse(JSON.stringify({
    contract_version: CONTRACT_VERSION, renderer: 'deterministic-v1',
    source_photo_path: s.source_photo_path, source_photo_sha256: photoSha256,
    additional_photo_paths: s.additional_photo_paths || [], photo_views: s.photo_views || {},
    design_revision: s.design_revision, mode: s.mode, preset: s.preset,
    color_style: s.color_style, install_zones: s.install_zones,
    selected_zones: s.selected_zones, selected_decorations: s.selected_decorations,
    selections: s.selections, architecture_lock: s.architecture_lock,
    catalog: catalog.filter(d => s.selections.placements.some(p => p.catalog_id === d.id)),
    scale_status: 'concept_unmeasured', physical_dimensions: null,
    validation
  })));
}
export function canonicalJSON(value) {
  if (Array.isArray(value)) return '['+value.map(canonicalJSON).join(',')+']';
  if (value && typeof value === 'object') return '{'+Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => JSON.stringify(k)+':'+canonicalJSON(value[k])).join(',')+'}';
  return JSON.stringify(value);
}

