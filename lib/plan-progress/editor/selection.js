// Distances are in screen pixels so the touch tolerance stays useful at every zoom.
export function segmentDistance(p,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy;
  const t=l?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l)):0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
export function insidePolygon(p,points){
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[i],b=points[j];
    if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}
export function nearbyElements(elements,p,toScreen,{radius=28,widthFor=()=>0}={}){
  return elements.map(element=>{
    const points=element.points.map(toScreen);let distance=Infinity;
    if(element.kind==='point')distance=Math.hypot(p.x-points[0].x,p.y-points[0].y);
    else{
      for(let i=1;i<points.length;i++)distance=Math.min(distance,segmentDistance(p,points[i-1],points[i]));
      if(element.kind==='area')distance=insidePolygon(p,points)?0:Math.min(distance,segmentDistance(p,points.at(-1),points[0]));
    }
    const tolerance=element.kind==='line'?Math.max(radius,widthFor(element)/2):radius;
    return {element,distance,tolerance};
  }).filter(hit=>hit.distance<=hit.tolerance).sort((a,b)=>a.distance-b.distance);
}
