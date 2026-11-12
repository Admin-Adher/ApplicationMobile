export function attachPlanNavigation({viewport,overlay,viewer,getMode,getTerrain=()=>false,onChange}){
  let drag=null,pinch=null,space=false,suppressClick=false,finishingPinch=false;
  const touches=new Map();
  const pair=()=>[...touches.values()].slice(0,2);
  const middle=([a,b])=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  const distance=([a,b])=>Math.hypot(a.x-b.x,a.y-b.y);
  window.addEventListener('keydown',event=>{
    if(event.code==='Space'&&!event.target.closest('input,textarea,select,button,[role="button"],dialog,a')&&document.activeElement?.closest('#planViewport')){space=true;event.preventDefault();viewport.classList.add('space-pan');}
  });
  window.addEventListener('keyup',event=>{if(event.code==='Space'){space=false;viewport.classList.remove('space-pan');}});
  window.addEventListener('blur',()=>{space=false;drag=null;pinch=null;touches.clear();finishingPinch=false;viewport.classList.remove('space-pan','dragging');});
  viewport.addEventListener('pointerdown',event=>{
    if(event.target.closest('button'))return;
    if(!pinch&&!finishingPinch)suppressClick=false;
    if(event.pointerType==='touch'&&getTerrain()){
      touches.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if(touches.size>=2){
        const points=pair(),center=middle(points),matrix=overlay.getScreenCTM();
        if(!matrix)return;
        const p=overlay.createSVGPoint();p.x=center.x;p.y=center.y;
        pinch={world:p.matrixTransform(matrix.inverse()),distance:Math.max(1,distance(points)),zoom:viewer.zoom};
        drag=null;suppressClick=true;finishingPinch=false;
        for(const id of touches.keys())viewport.setPointerCapture(id);
        viewport.classList.add('dragging');event.preventDefault();return;
      }
    }
    if(finishingPinch||![0,1].includes(event.button)||!(getMode()==='pan'||space||event.button===1||(getTerrain()&&getMode()==='select')))return;
    const immediate=getMode()==='pan'||space||event.button===1;
    if(immediate)event.preventDefault();
    suppressClick=false;drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop,moved:false};
    if(immediate){viewport.setPointerCapture(event.pointerId);viewport.classList.add('dragging');}
  });
  viewport.addEventListener('pointermove',event=>{
    if(touches.has(event.pointerId))touches.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pinch&&touches.size>=2){
      const points=pair(),center=middle(points),box=viewport.getBoundingClientRect();
      viewer.zoom=Math.max(.5,Math.min(8,pinch.zoom*distance(points)/pinch.distance));
      viewer.layout();viewer.centerOn(pinch.world.x,pinch.world.y,center.x-box.left,center.y-box.top);viewer.render().then(onChange);
      event.preventDefault();return;
    }
    if(finishingPinch||!drag||drag.id!==event.pointerId)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    if(Math.hypot(dx,dy)>8){drag.moved=true;viewport.setPointerCapture(event.pointerId);viewport.classList.add('dragging');}
    if(drag.moved){event.preventDefault();viewport.scrollLeft=drag.left-dx;viewport.scrollTop=drag.top-dy;}
  });
  const stop=event=>{
    touches.delete(event.pointerId);
    if(pinch||finishingPinch){pinch=null;drag=null;finishingPinch=touches.size>0;suppressClick=true;}
    else if(drag&&event.pointerId===drag.id){suppressClick=drag.moved||getMode()==='pan';drag=null;}
    if(viewport.hasPointerCapture(event.pointerId))viewport.releasePointerCapture(event.pointerId);
    viewport.classList.remove('dragging');
  };
  viewport.addEventListener('pointerup',stop);viewport.addEventListener('pointercancel',stop);
  overlay.addEventListener('click',event=>{if(suppressClick||getMode()==='pan'){event.stopImmediatePropagation();suppressClick=false;}},true);
  viewport.addEventListener('wheel',event=>{if(!event.ctrlKey&&!event.metaKey)return;event.preventDefault();viewer.changeZoom(event.deltaY<0?.3:-.3,{x:event.clientX,y:event.clientY}).then(onChange);},{passive:false});
}
