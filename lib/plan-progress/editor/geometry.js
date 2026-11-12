const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
export const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export function polygonArea(points){return Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-q.x*p.y;},0))/2;}
export function geometryProblem(kind,points){
  if(points.length<(kind==='point'?1:kind==='line'?2:3)||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return 'Placez tous les points nécessaires.';
  if(kind==='point')return '';
  const n=points.length,last=kind==='area'?n:n-1;
  for(let i=0;i<last;i++)if(distance(points[i],points[(i+1)%n])<1e-7)return 'Deux points se superposent. Déplacez ou retirez un point.';
  if(kind!=='area')return '';
  const on=(a,b,p)=>Math.abs(cross(a,b,p))<1e-8&&p.x>=Math.min(a.x,b.x)-1e-8&&p.x<=Math.max(a.x,b.x)+1e-8&&p.y>=Math.min(a.y,b.y)-1e-8&&p.y<=Math.max(a.y,b.y)+1e-8;
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
    if(j===i+1||(i===0&&j===n-1))continue;
    const a=points[i],b=points[(i+1)%n],c=points[j],d=points[(j+1)%n];
    if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))return 'Le contour se croise. Déplacez ou retirez un point.';
  }
  return polygonArea(points)<1e-8?'Cette surface est plate. Écartez les points.':'';
}
/** The first segment sets the local axes, even on a rotated PDF. */
export function orthogonalPoint(points,point){
  if(points.length<2)return point;
  const first=points[0],second=points[1],last=points.at(-1),length=distance(first,second);
  if(length<1e-8)return point;
  const ux=(second.x-first.x)/length,uy=(second.y-first.y)/length,dx=point.x-last.x,dy=point.y-last.y;
  const along=dx*ux+dy*uy,across=-dx*uy+dy*ux;
  return Math.abs(along)>=Math.abs(across)?{x:last.x+along*ux,y:last.y+along*uy}:{x:last.x-across*uy,y:last.y+across*ux};
}
export function orientedRectangle([a,b,c]){
  const length=distance(a,b);if(length<1e-8)return [a,b,b,a].map(p=>({...p}));
  const nx=-(b.y-a.y)/length,ny=(b.x-a.x)/length,offset=(c.x-a.x)*nx+(c.y-a.y)*ny;
  return [a,b,{x:b.x+nx*offset,y:b.y+ny*offset},{x:a.x+nx*offset,y:a.y+ny*offset}].map(p=>({...p}));
}
export function translatePoints(points,index,dx,dy,bounds,whole=false){
  const targets=whole?points:[points[index]];
  dx=Math.max(-Math.min(...targets.map(p=>p.x)),Math.min(bounds.width-Math.max(...targets.map(p=>p.x)),dx));
  dy=Math.max(-Math.min(...targets.map(p=>p.y)),Math.min(bounds.height-Math.max(...targets.map(p=>p.y)),dy));
  return points.map((p,i)=>whole||i===index?{x:p.x+dx,y:p.y+dy}:{...p});
}
export function closestSegment(points,p,closed=false){
  let best={index:0,distance:Infinity};
  for(let i=0;i<points.length-(closed?0:1);i++){
    const a=points[i],b=points[(i+1)%points.length],dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
    const t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;
    const d=Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);if(d<best.distance)best={index:i,distance:d};
  }
  return best;
}
export function progressWeight(element){
  if(element.status==='todo')return 0;if(element.status!=='progress')return 1;
  return typeof element.progressPercent==='number'&&Number.isFinite(element.progressPercent)?Math.max(0,Math.min(100,element.progressPercent))/100:.5;
}
