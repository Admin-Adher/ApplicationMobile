export class PdfViewer{
  constructor(options){
    Object.assign(this,options);this.zoom=1;this.pageNumber=1;this.renderId=0;this.documentVersion=0;this.lastKey=null;this.activeKey=null;this.ratio=2/3;
    new ResizeObserver(()=>{clearTimeout(this.resizeTimer);this.resizeTimer=setTimeout(()=>{
      const old=this.lastLayout;
      const center=old&&old.paperWidth?{x:(this.viewport.scrollLeft+old.width/2-old.originX)/old.paperWidth*1000,y:(this.viewport.scrollTop+old.height/2-old.originY)/old.paperWidth*1000}:null;
      if(center&&this.doc){this.layout();this.centerOn(center.x,center.y);}
      this.render();
    },90);}).observe(this.viewport);
    this.viewport.addEventListener('scroll',()=>{this.onViewChange?.();clearTimeout(this.scrollTimer);this.scrollTimer=setTimeout(()=>this.render(),55);},{passive:true});
  }
  async setDocument(pdf,page=1){this.doc=pdf;this.documentVersion++;this.pageNumber=page;this.zoom=1;this.lastKey=null;await this.render();}
  async setPage(page){this.pageNumber=page;this.zoom=1;this.lastKey=null;await this.render();}
  baseWidth(){return Math.min(Math.max(120,this.viewport.clientWidth-56),Math.max(180,this.viewport.clientHeight-56)/this.ratio);}
  layout(){
    this.paperWidth=this.baseWidth()*this.zoom;this.paperHeight=this.paperWidth*this.ratio;
    this.paper.style.width=`${this.paperWidth}px`;this.paper.style.height=`${this.paperHeight}px`;
    this.overlay.setAttribute('viewBox',`0 0 1000 ${1000*this.ratio}`);this.onViewChange?.();
    const paper=this.paper.getBoundingClientRect(),v=this.viewport.getBoundingClientRect();
    this.lastLayout={width:this.viewport.clientWidth,height:this.viewport.clientHeight,paperWidth:this.paperWidth,originX:paper.left-v.left+this.viewport.scrollLeft,originY:paper.top-v.top+this.viewport.scrollTop};
  }
  tile(){
    const p=this.paper.getBoundingClientRect(),v=this.viewport.getBoundingClientRect(),margin=110;
    const left=Math.max(0,Math.floor((v.left-p.left-margin)/64)*64),top=Math.max(0,Math.floor((v.top-p.top-margin)/64)*64);
    return {left,top,width:Math.max(1,Math.min(this.paperWidth-left,this.viewport.clientWidth+margin*2+64)),height:Math.max(1,Math.min(this.paperHeight-top,this.viewport.clientHeight+margin*2+64))};
  }
  async render(){
    if(!this.doc||!this.viewport.clientWidth||!this.viewport.clientHeight)return;
    const generation=this.documentVersion,pageNumber=this.pageNumber,pdf=this.doc;
    try{
      const page=await pdf.getPage(pageNumber);if(generation!==this.documentVersion||pageNumber!==this.pageNumber)return;
      const base=page.getViewport({scale:1});this.ratio=base.height/base.width;this.layout();this.onPageSize?.(1000,1000*this.ratio);
      const tile=this.tile(),key=`${generation}:${pageNumber}:${this.zoom}:${this.paperWidth}:${tile.left}:${tile.top}:${tile.width}:${tile.height}`;
      if(key===this.lastKey||key===this.activeKey)return;
      this.activeKey=key;const id=++this.renderId;
      const previous=this.task;this.task=null;if(previous){previous.cancel();await previous.promise.catch(()=>{});}if(id!==this.renderId)return;
      if(this.lastPage!==`${generation}:${pageNumber}`)this.loading.hidden=false;
      // Render a viewport tile instead of allocating a huge canvas for a zoomed A0 sheet.
      const ratio=Math.min(devicePixelRatio||1,2,Math.sqrt(4_000_000/(tile.width*tile.height)));
      const buffer=document.createElement('canvas');buffer.width=Math.ceil(tile.width*ratio);buffer.height=Math.ceil(tile.height*ratio);
      const viewport=page.getViewport({scale:this.paperWidth/base.width*ratio});
      const task=page.render({canvasContext:buffer.getContext('2d'),viewport,transform:[1,0,0,1,-tile.left*ratio,-tile.top*ratio]});this.task=task;
      await task.promise;if(id!==this.renderId)return;
      this.canvas.width=buffer.width;this.canvas.height=buffer.height;this.canvas.getContext('2d').drawImage(buffer,0,0);
      Object.assign(this.canvas.style,{position:'absolute',left:`${tile.left}px`,top:`${tile.top}px`,width:`${tile.width}px`,height:`${tile.height}px`});
      this.canvas.dataset.renderedPage=String(pageNumber);this.canvas.dataset.renderedZoom=String(this.zoom);this.canvas.dataset.renderedTile=key;
      this.loading.hidden=true;this.lastKey=key;this.lastPage=`${generation}:${pageNumber}`;this.activeKey=null;this.onViewChange?.();
    }catch(error){
      if(error.name==='RenderingCancelledException'||generation!==this.documentVersion||pageNumber!==this.pageNumber)return;
      this.loading.hidden=true;this.activeKey=null;this.onError(error);
    }
  }
  centerOn(x,y,screenX=this.viewport.clientWidth/2,screenY=this.viewport.clientHeight/2){
    const p=this.paper.getBoundingClientRect(),v=this.viewport.getBoundingClientRect();
    this.viewport.scrollTo({left:this.viewport.scrollLeft+p.left-v.left+x/1000*this.paperWidth-screenX,top:this.viewport.scrollTop+p.top-v.top+y/1000*this.paperWidth-screenY,behavior:'instant'});
  }
  async changeZoom(delta,anchor){
    const p=this.paper.getBoundingClientRect(),v=this.viewport.getBoundingClientRect();
    const sx=anchor?anchor.x-v.left:this.viewport.clientWidth/2,sy=anchor?anchor.y-v.top:this.viewport.clientHeight/2;
    const x=(v.left+sx-p.left)/this.paperWidth*1000,y=(v.top+sy-p.top)/this.paperWidth*1000;
    this.zoom=Math.min(8,Math.max(.5,this.zoom+delta));this.layout();this.centerOn(x,y,sx,sy);await this.render();return this.zoom;
  }
  async focus(region){
    if(!region||region.w<2||region.h<2)return;
    const base=this.baseWidth();
    this.zoom=Math.max(.5,Math.min(8,Math.min((this.viewport.clientWidth-52)/(region.w*base/1000),(this.viewport.clientHeight-52)/(region.h*base/1000))));
    this.layout();this.centerOn(region.x+region.w/2,region.y+region.h/2);await this.render();return this.zoom;
  }
  async fit(){this.zoom=1;this.layout();this.viewport.scrollTo({top:0,left:0,behavior:'instant'});await this.render();return this.zoom;}
}
