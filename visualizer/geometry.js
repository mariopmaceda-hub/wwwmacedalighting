(function(root){
  function physicalBounds(dimensions,calibration,anchor){
    if(!dimensions||dimensions.unit!=='m'||!calibration||calibration.verified!==true)return null;
    const w=Number(dimensions.width),h=Number(dimensions.height),sx=Number(calibration.meters_per_normalized_x),sy=Number(calibration.meters_per_normalized_y);
    if(![w,h,sx,sy].every(v=>Number.isFinite(v)&&v>0)||!Array.isArray(anchor)||anchor.length!==2)return null;
    const width=w/sx,height=h/sy;return {x:anchor[0]-width/2,y:anchor[1]-height/2,width,height,physical_dimensions:dimensions,scale_status:'calibrated'};
  }
  function eligibleZones(type,zones){return (zones||[]).filter(z=>(type.allowed_zones||[]).includes(z.id));}
  const api={physicalBounds,eligibleZones};
  if(typeof module!=='undefined')module.exports=api;else root.MacedaGeometry=api;
})(typeof window!=='undefined'?window:globalThis);
