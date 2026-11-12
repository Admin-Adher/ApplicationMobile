import {translatePoints,closestSegment,geometryProblem} from './geometry.js';
import {num,shapeQuantity} from './model.js';

/** Draft geometry stays separate from persisted works until explicit validation. */
export class GeometryEditor{
  constructor({overlay,layer,root,loupe,getScale,onApply,onCancel,onMessage,onPreview}){
    Object.assign(this,{overlay,layer,root,loupe,getScale,onApply,onCancel,onMessage,onPreview});
    this.active=false;this.index=0;this.whole=false;this.inserting=false;this.history=[];
    root.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button)return;
      if(button.dataset.nudge){const [x,y]=button.dataset.nudge.split(',').map(Number),scale=getScale();if(!scale)return;
        this.remember();this.points=translatePoints(this.points,this.index,x*Number(root.querySelector('#precisionStep').value)/100/scale,y*Number(root.querySelector('#precisionStep').value)/100/scale,this.bounds(),this.whole);this.paint();}
      if(button.hasAttribute('data-precision-whole')){this.whole=!this.whole;this.inserting=false;this.paint();}
      if(button.hasAttribute('data-precision-add')){this.inserting=!this.inserting;this.whole=false;this.paint();}
      if(button.hasAttribute('data-precision-remove')){if(this.points.length<=(this.kind==='area'?3:2))return;this.remember();this.points.splice(this.index,1);this.index=Math.min(this.index,this.points.length-1);this.paint();}
      if(button.hasAttribute('data-precision-undo')){const previous=this.history.pop();if(previous){this.points=previous;this.index=Math.min(this.index,this.points.length-1);this.paint();}}
      if(button.hasAttribute('data-precision-cancel'))onCancel();
      if(button.hasAttribute('data-precision-apply'))void this.apply();
    });
    root.querySelector('#precisionPoint').addEventListener('change',event=>{this.index=Number(event.target.value);this.paint();});
    overlay.addEventListener('pointerdown',event=>{
      if(!this.active)return;
      // An additional finger belongs to navigation, never to a second vertex.
      if(this.drag){this.points=this.drag.points;if(this.drag.remembered)this.history.pop();this.drag=null;this.loupe.hidden=true;this.paint();return;}
      const handle=event.target.closest('[data-vertex]');if(!handle||event.button!==0)return;
      this.index=Number(handle.dataset.vertex);this.inserting=false;
      this.drag={id:event.pointerId,start:this.position(event),points:this.points.map(p=>({...p}))};
      overlay.setPointerCapture(event.pointerId);event.preventDefault();this.paint();
    });
    overlay.addEventListener('pointermove',event=>{
      if(!this.drag||this.drag.id!==event.pointerId)return;
      const position=this.position(event),d=this.drag;
      if(!d.remembered&&(Math.abs(position.x-d.start.x)>1e-8||Math.abs(position.y-d.start.y)>1e-8)){this.remember();d.remembered=true;}
      this.points=translatePoints(d.points,this.index,position.x-d.start.x,position.y-d.start.y,this.bounds(),this.whole);
      this.paint();this.magnify(event);event.preventDefault();
    });
    const stop=event=>{if(this.drag?.id===event.pointerId){this.drag=null;this.loupe.hidden=true;if(overlay.hasPointerCapture(event.pointerId))overlay.releasePointerCapture(event.pointerId);}};
    overlay.addEventListener('pointerup',stop);overlay.addEventListener('pointercancel',stop);
    overlay.addEventListener('keydown',event=>{
      if(!this.active)return;
      const handle=event.target.closest('[data-vertex]');if(!handle)return;
      if(['Enter',' '].includes(event.key)){event.preventDefault();this.index=Number(handle.dataset.vertex);this.paint();root.querySelector('#precisionPoint').focus();}
    });
  }
  bounds(){const b=this.overlay.viewBox.baseVal;return {width:b.width,height:b.height};}
  position(event){const p=this.overlay.createSVGPoint();p.x=event.clientX;p.y=event.clientY;return p.matrixTransform(this.overlay.getScreenCTM().inverse());}
  remember(){this.history.push(this.points.map(p=>({...p})));if(this.history.length>30)this.history.shift();}
  start(element){this.kind=element.kind;this.points=element.points.map(p=>({...p}));this.original=this.points.map(p=>({...p}));this.index=0;this.active=true;this.whole=false;this.inserting=false;this.history=[];this.root.hidden=false;this.paint();}
  stop(){this.active=false;this.drag=null;this.loupe.hidden=true;this.layer.innerHTML='';this.root.hidden=true;}
  click(event){
    if(!this.active)return;
    const handle=event.target.closest('[data-vertex]');if(handle){this.index=Number(handle.dataset.vertex);this.paint();return;}
    if(!this.inserting)return;
    if(this.points.length>=1000){this.onMessage('Ce tracé a atteint la limite de points.');return;}
    const p=this.position(event),b=this.bounds(),hit=closestSegment(this.points,p,this.kind==='area');
    if(p.x<0||p.y<0||p.x>b.width||p.y>b.height)return;
    const scale=this.overlay.getBoundingClientRect().width/1000;
    if(hit.distance*scale>44){this.onMessage('Touchez près du tracé pour ajouter le nouveau point.');return;}
    this.remember();this.points.splice(hit.index+1,0,{x:p.x,y:p.y});this.index=hit.index+1;this.inserting=false;this.paint();
  }
  async apply(){
    if(this.applying)return;
    const problem=geometryProblem(this.kind,this.points);
    if(problem){this.onMessage(problem);return;}
    this.applying=true;
    try{await this.onApply(this.points.map(p=>({...p})));}finally{this.applying=false;}
  }
  paint(){
    if(!this.active)return;
    const s=1000/Math.max(1,this.overlay.getBoundingClientRect().width),coords=this.points.map(p=>`${p.x},${p.y}`).join(' ');
    const tag=this.kind==='area'?'polygon':'polyline';
    const shape=this.kind==='point'?'':`<${tag} class="precision-shape ${this.kind==='line'?'precision-line':''}" points="${coords}" stroke-width="${2*s}"/>`;
    this.layer.innerHTML=shape+this.points.map((p,i)=>`<g data-vertex="${i}" tabindex="0" role="button" aria-label="Ajuster le point ${i+1}" aria-pressed="${i===this.index}"><circle cx="${p.x}" cy="${p.y}" r="${22*s}" fill="transparent"/><circle class="precision-handle ${i===this.index?'chosen':''}" cx="${p.x}" cy="${p.y}" r="${(i===this.index?10:7)*s}" stroke-width="${2*s}"/><text class="precision-number" x="${p.x}" y="${p.y}" style="font-size:${11*s}px">${i+1}</text></g>`).join('');
    const select=this.root.querySelector('#precisionPoint');
    if(select.options.length!==this.points.length)select.innerHTML=this.points.map((_,i)=>`<option value="${i}">Point ${i+1} / ${this.points.length}</option>`).join('');
    select.value=String(this.index);
    const scale=this.getScale(),unit=this.kind==='point'?'u':this.kind==='area'?'m²':'m';
    this.root.querySelector('#precisionMeasure').textContent=`Avant ${num(shapeQuantity(this.kind,this.original,scale),3)} ${unit} → Après ${num(shapeQuantity(this.kind,this.points,scale),3)} ${unit}`;
    this.root.querySelector('#precisionHint').textContent=this.inserting?'Touchez le tracé à l’endroit du nouveau point.':this.whole?'Déplacez une poignée ou utilisez les flèches : tout le tracé suit.':scale?'Touchez un point, puis glissez-le ou utilisez les flèches.':'Touchez un point pour le déplacer. Réglez l’échelle pour ajuster en cm.';
    this.root.querySelectorAll('[data-nudge],#precisionStep').forEach(el=>el.disabled=!scale);
    this.root.querySelector('[data-precision-whole]').setAttribute('aria-pressed',String(this.whole));
    this.root.querySelector('[data-precision-add]').setAttribute('aria-pressed',String(this.inserting));
    this.root.querySelector('[data-precision-add]').hidden=this.kind==='point';
    this.root.querySelector('[data-precision-remove]').hidden=this.kind==='point';
    this.root.querySelector('[data-precision-remove]').disabled=this.points.length<=(this.kind==='area'?3:2);
    this.root.querySelector('[data-precision-undo]').disabled=!this.history.length;
    this.onPreview?.(this.points);
  }
  magnify(event){
    const canvas=this.loupe,ctx=canvas.getContext('2d'),r=this.overlay.getScreenCTM(),point=this.points[this.index];
    if(!ctx||!r)return;
    const p=this.overlay.createSVGPoint();p.x=point.x;p.y=point.y;const center=p.matrixTransform(r),size=canvas.width;
    ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#fff';ctx.fillRect(0,0,size,size);ctx.setTransform(2,0,0,2,size/2,size/2);
    for(const source of document.querySelectorAll('#planPaper canvas')){const b=source.getBoundingClientRect();try{ctx.drawImage(source,b.x-center.x,b.y-center.y,b.width,b.height);}catch{}}
    ctx.beginPath();for(const [i,vertex] of this.points.entries()){p.x=vertex.x;p.y=vertex.y;const q=p.matrixTransform(r);i?ctx.lineTo(q.x-center.x,q.y-center.y):ctx.moveTo(q.x-center.x,q.y-center.y);}if(this.kind==='area')ctx.closePath();ctx.strokeStyle='#003082';ctx.lineWidth=1;ctx.stroke();
    ctx.setTransform(1,0,0,1,0,0);ctx.strokeStyle='#b34a09';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(size/2-12,size/2);ctx.lineTo(size/2+12,size/2);ctx.moveTo(size/2,size/2-12);ctx.lineTo(size/2,size/2+12);ctx.stroke();
    const viewport=document.getElementById('planViewport').getBoundingClientRect();
    canvas.style.left=(event.clientX<viewport.left+viewport.width/2?viewport.right-126:viewport.left+8)+'px';canvas.style.top=(viewport.top+8)+'px';canvas.hidden=false;
  }
}
