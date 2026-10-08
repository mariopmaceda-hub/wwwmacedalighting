/** Pixel compositor. Coordinates come exclusively from the immutable contract snapshot. */
export function compositeRGBA(source, width, height, snapshot) {
  if (!(source instanceof Uint8Array) || source.length !== width*height*4 || width<1 || height<1) throw Error('Invalid decoded source image.');
  const output = new Uint8Array(source), touched = new Uint8Array(width*height);
  const scale = width/1000, vbH = height/scale;
  const palette = snapshot.color_style==='Red + White'?[[224,68,56],[255,248,229]]:snapshot.color_style==='Multicolor'?[[224,68,56],[85,186,120],[86,141,246],[245,205,93]]:[[255,240,184]];
  let masks=[];
  function inside(x,y,polygon){let hit=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
  function disc(x,y,r,color,opacity,glow=false){
    x*=scale;y*=scale;r*=scale;
    for(let py=Math.max(0,Math.floor(y-r));py<=Math.min(height-1,Math.ceil(y+r));py++)for(let px=Math.max(0,Math.floor(x-r));px<=Math.min(width-1,Math.ceil(x+r));px++){
      const distance=Math.hypot(px+.5-x,py+.5-y);if(distance>r||masks.some(p=>inside((px+.5)/width,(py+.5)/height,p)))continue;
      const alpha=opacity*(glow?Math.pow(1-distance/r,2):Math.min(1,(r-distance)/Math.max(.5,scale)));
      if(alpha<=0)continue;const index=(py*width+px)*4;
      for(let c=0;c<3;c++)output[index+c]=Math.round(output[index+c]*(1-alpha)+color[c]*alpha);
      // Preserve source alpha; uploads are opaque normalized photographs.
      touched[py*width+px]=1;
    }
  }
  function bulb(x,y,i){const c=palette[i%palette.length];disc(x,y,9,c,.4,true);disc(x,y,2.3,c,1);disc(x,y,1,[255,255,244],1);}
  function run(points){let index=0;for(let i=1;i<points.length;i++){const a=[points[i-1][0]*1000,points[i-1][1]*vbH],b=[points[i][0]*1000,points[i][1]*vbH];const n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/11));for(let j=0;j<n;j++)bulb(a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n,index++);}const p=points.at(-1);bulb(p[0]*1000,p[1]*vbH,index);}
  for(const z of snapshot.install_zones){if(!snapshot.selected_zones.includes(z.id))continue;masks=z.occlusion_masks||[];if(z.polyline?.length>=2)run(z.polyline);else if(z.bbox?.length===4){const [x,y,w,h]=z.bbox;run([[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]);}}
  for(const p of snapshot.selections.placements){
    const d=snapshot.catalog.find(d=>d.id===p.catalog_id),z=snapshot.install_zones.find(z=>z.id===p.zone_id);if(!d||!z)throw Error('Incomplete snapshot.');
    masks=z.occlusion_masks||[];
    const x=p.anchor[0]*1000,y=p.anchor[1]*vbH,bb=z.bbox||[],w=bb.length===4?bb[2]*1000:80,h=bb.length===4?bb[3]*vbH:90;
    const r=Math.max(10,Math.min(w*.25,h*.2,30));let points=[];
    if(d.concept_geometry==='path'){for(let i=-2;i<=2;i++)bulb(x+i*w*.16,y+i*h*.08,i+2);continue;}
    for(let i=0;i<=96;i++){const t=i/96;
      if(d.concept_geometry==='ring')points.push([x+Math.cos(t*Math.PI*2)*r,y+Math.sin(t*Math.PI*2)*r]);
      else if(d.concept_geometry==='drape')points.push([(1-t)*(1-t)*(x-w*.42)+2*(1-t)*t*x+t*t*(x+w*.42),(1-t)*(1-t)*(y-h*.4)+2*(1-t)*t*y+t*t*(y-h*.4)]);
      else if(d.concept_geometry==='arch')points.push([(1-t)*(1-t)*(x-w*.35)+2*(1-t)*t*x+t*t*(x+w*.35),(1-t)*(1-t)*(y+h*.25)+2*(1-t)*t*(y-h*.6)+t*t*(y+h*.25)]);
      else throw Error('Unsupported decoration shape.');
    }
    points.forEach(([px,py],i)=>{disc(px,py,3,[42,91,55],1);if(i%8===0)bulb(px,py,i/8);});
  }
  return {pixels:output,touched};
}
