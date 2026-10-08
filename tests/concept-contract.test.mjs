import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDesign,createSnapshot,canonicalJSON} from '../supabase/functions/_shared/concept-contract.mjs';
const fixture = () => ({source_photo_path:'TEST/front.jpg',design_revision:1,selected_zones:['roof'],selected_decorations:[],selections:{placements:[]},install_zones:[{id:'roof',visible:true,confidence:.9,polyline:[[.1,.2],[.5,.1],[.9,.2]],anchor:[.5,.1]}]});
test('snapshot preserves exact geometry and remains detached and immutable',()=>{const s=fixture(),before=JSON.stringify(s);const snap=createSnapshot(s,[],'a'.repeat(64));assert.equal(JSON.stringify(s),before);assert.deepEqual(snap.install_zones,s.install_zones);s.install_zones[0].polyline[0][0]=.4;assert.equal(snap.install_zones[0].polyline[0][0],.1);assert.throws(()=>snap.install_zones.push({}));});
for (const [name,change] of [
 ['out of bounds',s=>s.install_zones[0].polyline[0][0]=-1],
 ['hidden',s=>s.install_zones[0].visible=false],
 ['low confidence',s=>s.install_zones[0].confidence=.64],
 ['non numeric',s=>s.install_zones[0].polyline[0][0]='0.1'],
 ['box overflow',s=>s.install_zones[0].bbox=[.9,.1,.2,.2]],
 ['missing zone',s=>s.selected_zones=['missing']],
 ['missing placement',s=>s.selected_decorations=['Wreath']],
 ['unsupported occlusion',s=>s.install_zones[0].occlusion_masks='behind tree']
]) test('rejects '+name+' without repairing it',()=>{const s=fixture();change(s);const before=JSON.stringify(s);assert.equal(validateDesign(s).valid,false);assert.equal(JSON.stringify(s),before);});
test('missing occlusion is explicitly flagged',()=>assert.match(validateDesign(fixture()).warnings.join(),/no explicit occlusion/));
test('placement anchor is preserved independently of zone anchor',()=>{const s=fixture();s.selected_decorations=['Wreath'];s.selections.placements=[{catalog_id:'w',customer_name:'Wreath',zone_id:'roof',anchor:[.4,.3],scale_status:'concept_unmeasured',physical_dimensions:null}];const snap=createSnapshot(s,[{id:'w',allowed_zones:['roof'],concept_geometry:'ring'}],'b'.repeat(64));assert.deepEqual(snap.selections.placements[0].anchor,[.4,.3]);});
test('canonical serialization ignores property order but detects geometry changes',()=>{assert.equal(canonicalJSON({b:2,a:1}),canonicalJSON({a:1,b:2}));const a=fixture(),b=fixture();b.install_zones[0].anchor[0]=.6;assert.notEqual(canonicalJSON(a),canonicalJSON(b));});
