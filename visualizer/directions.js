(function(root){
  'use strict';
  const MIN_CONFIDENCE = 0.65;
  const point = p => Array.isArray(p) && p.length === 2 && p.every(n => Number.isFinite(n) && n >= 0 && n <= 1);
  function usable(z){
    if(z.visible === false || !Number.isFinite(z.confidence) || z.confidence < MIN_CONFIDENCE)return false;
    const line = Array.isArray(z.polyline) && z.polyline.length >= 2 && z.polyline.every(point) && z.polyline.some(p => p[0] !== z.polyline[0][0] || p[1] !== z.polyline[0][1]);
    const b = z.bbox;
    const box = Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) && b[0] >= 0 && b[1] >= 0 && b[2] > 0 && b[3] > 0 && b[0]+b[2] <= 1.001 && b[1]+b[3] <= 1.001;
    return Boolean(line || box);
  }
  // Kevin's integration hook: supply candidates using supported preset, zones and decor
  // fields. This module only filters/ranks selections; it never generates outlines.
  function create({zones, catalog, presets, candidates}){
    const safe = zones.filter(usable), ids = new Set(safe.map(z => z.id));
    const defaults = ['Minimal Modern','Classic Christmas','Christmas Spectacular','Elegant Estate','Candy Cane','Griswold'].map(preset => ({preset,zones:presets[preset].all?[...ids]:presets[preset].z,decor:presets[preset].d}));
    const seen = new Set(), results = [];
    for(const item of candidates || defaults){
      if(!Object.hasOwn(presets,item.preset))continue;
      const selected = [...new Set((item.zones || []).filter(z => ids.has(z)))];
      if(!selected.length)continue; // Empty Maceda selections trigger backend preset fallback.
      const decor = [...new Set((item.decor || []).filter(name => catalog.some(d => d.customer_name === name && safe.some(z => (d.allowed_zones || []).includes(z.id) && (point(z.anchor) || z.bbox?.length === 4)))))];
      const signature = JSON.stringify([[...selected].sort(),[...decor].sort()]);
      if(seen.has(signature))continue;
      seen.add(signature);results.push({preset:item.preset,zones:selected,decor});
      if(results.length===3)break;
    }
    return results;
  }
  const api = {create,usable,MIN_CONFIDENCE};
  if(typeof module!=='undefined')module.exports=api;else root.MacedaDirections=api;
})(typeof window!=='undefined'?window:globalThis);
