import {num,shapeQuantity} from './model.js';
export class DrawingController {
  constructor({overlay,layer,getMode,getVariant,getRightAngles,getScale,onGeometry,onCalibration,onFocus,onPoints,onPreview,onError}){
    Object.assign(this,{overlay,layer,getMode,getVariant,getRightAngles,getScale,onGeometry,onCalibration,onFocus,onPoints,onPreview,onError});
    this.points=[];this.hover=null;this.invalid=false;
    overlay.addEventListener('pointermove',event=>{if(!this.isDrawing())return;this.hover=this.position(event);this.paint();});
    overlay.addEventListener('pointerleave',()=>{this.hover=null;this.paint();});
    overlay.addEventListener('dblclick',event=>{if(this.canFinish()){event.preventDefault();this.finish();}});
  }
  isDrawing(){return ['point','line','area','calibrate','focus'].includes(this.getMode());}
  canFinish(){return (this.getMode()==='area'&&this.getVariant()==='polygon')||(this.getMode()==='line'&&this.getVariant()==='path');}
  position(event){
    const point=this.overlay.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
    const local=point.matrixTransform(this.overlay.getScreenCTM().inverse());
    const box=this.overlay.viewBox.baseVal;
    const result={x:Math.max(0,Math.min(box.width,local.x)),y:Math.max(0,Math.min(box.height,local.y))};
    if(this.getMode()==='line'&&this.getVariant()==='path'&&this.getRightAngles()&&this.points.length){
      const last=this.points.at(-1);if(Math.abs(result.x-last.x)>=Math.abs(result.y-last.y))result.y=last.y;else result.x=last.x;
    }
    return result;
  }
  pixelDistance(a,b){return Math.hypot(a.x-b.x,a.y-b.y)*this.overlay.getBoundingClientRect().width/1000;}
  clear(){this.points=[];this.hover=null;this.invalid=false;this.layer.innerHTML='';this.onPoints(0);this.onPreview?.();}
  removeLast(){this.points.pop();this.hover=null;this.invalid=false;this.onPoints(this.points.length);this.paint();}
  rectangle(points){const [a,b]=points;return [{x:a.x,y:a.y},{x:b.x,y:a.y},{x:b.x,y:b.y},{x:a.x,y:b.y}];}
  click(event){
    const mode=this.getMode();if(!this.isDrawing()||event.detail>1)return;
    const point=this.position(event);
    if(mode==='point'){this.points=[point];this.paint();this.onGeometry('point',this.points.slice());return;}
    if(mode==='area'&&this.getVariant()==='polygon'&&this.points.length&&this.pixelDistance(point,this.points[0])<=16){
      if(this.points.length>=3)this.finish();else if(this.points.length>1)this.onError('Ajoutez un troisième sommet avant de fermer le contour.');
      return;
    }
    if(this.points.length&&this.pixelDistance(point,this.points.at(-1))<2)return;
    this.points.push(point);this.invalid=false;this.onPoints(this.points.length);this.paint();
    if(mode==='calibrate'&&this.points.length===2)this.onCalibration(this.points.slice());
    if(mode==='focus'&&this.points.length===2){const [a,b]=this.points;this.onFocus({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(b.x-a.x),h:Math.abs(b.y-a.y)});}
    if(mode==='line'&&this.getVariant()==='segment'&&this.points.length===2)this.onGeometry('line',this.points.slice());
    if(mode==='area'&&this.getVariant()==='rectangle'&&this.points.length===2){
      const points=this.rectangle(this.points);
      if(shapeQuantity('area',points,this.getScale())<.001){this.onError('Ce rectangle est trop petit. Recommencez avec deux coins opposés.');this.clear();return;}
      this.onGeometry('area',points);
    }
  }
  finish(){
    const mode=this.getMode();if(!this.canFinish()||this.points.length<(mode==='area'?3:2))return;
    const intersects=(a,b,c,d)=>{
      const cross=(p,q,r)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
      return cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0;
    };
    if(mode==='area')for(let i=0;i<this.points.length;i++)for(let j=i+1;j<this.points.length;j++){
      if(j===i+1||(i===0&&j===this.points.length-1))continue;
      if(intersects(this.points[i],this.points[(i+1)%this.points.length],this.points[j],this.points[(j+1)%this.points.length])){this.invalid=true;this.paint();this.onError('Le contour se croise. Retirez le dernier point pour le corriger, puis validez.');return;}
    }
    if(shapeQuantity(mode,this.points,this.getScale())<.001){this.onError('Le tracé est trop petit pour être mesuré.');return;}
    this.onGeometry(mode,this.points.slice());
  }
  paint(){
    const mode=this.getMode();if(!this.isDrawing()){this.layer.innerHTML='';this.onPreview?.();return;}
    let points=[...this.points];if(this.hover)points.push(this.hover);
    if(!points.length){this.layer.innerHTML='';this.onPreview?.();return;}
    if((mode==='focus'||mode==='area'&&this.getVariant()==='rectangle')&&points.length>=2)points=this.rectangle([points[0],points.at(-1)]);
    const coords=points.map(p=>`${p.x},${p.y}`).join(' '),scale=1000/Math.max(1,this.overlay.getBoundingClientRect().width);
    const shape=mode==='area'||mode==='focus'?`<polygon class="drawing-cross" points="${coords}"/>`:`<polyline class="drawing-cross" points="${coords}" fill="none"/>`;
    let label='',firstTarget='';
    if(points.length>=2&&(mode==='line'||mode==='area')){
      const q=shapeQuantity(mode,points,this.getScale()),p=points.at(-1);
      label=`<text class="draft-distance" x="${p.x+12*scale}" y="${p.y-12*scale}" style="font-size:${12*scale}px;stroke-width:${4*scale}px">${num(q,2)} ${mode==='line'?'m':'m²'}</text>`;
    }
    if(mode==='area'&&this.getVariant()==='polygon'&&this.points.length>=3){
      const p=this.points[0];firstTarget=`<circle class="close-target" cx="${p.x}" cy="${p.y}" r="${15*scale}" stroke-width="${2*scale}"/><text class="close-target-label" x="${p.x+21*scale}" y="${p.y-14*scale}" style="font-size:${11*scale}px;stroke-width:${4*scale}px">Fermer ici</text>`;
    }
    this.layer.innerHTML=`<g ${this.invalid?'class="invalid-draft"':''}>${shape}${this.points.map(p=>`<circle class="draft-point" cx="${p.x}" cy="${p.y}" r="${4*scale}" stroke-width="${1.5*scale}"/>`).join('')}${firstTarget}${label}</g>`;
    this.onPreview?.();
  }
}
