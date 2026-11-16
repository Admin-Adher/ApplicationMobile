import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {describe,expect,it,vi} from 'vitest';

function loadLayers(loadPdf=vi.fn()) {
  const controls=new Map<string,any>();
  const control=(key:string):any=>{
    if(controls.has(key))return controls.get(key);
    const value:any={value:'',open:false,disabled:false,hidden:false,textContent:'',dataset:{},style:{},events:{} as Record<string,Function>,
      setAttribute(){},append(){},replaceChildren(){},remove(){},
      addEventListener(event:string,handler:Function){this.events[event]=handler;},
      querySelector(selector:string){return control(selector);},
      showModal(){this.open=true;},close(){this.open=false;}};
    controls.set(key,value);return value;
  };
  const dialog=control('dialog'),exports:any={};
  const request=vi.fn(async(type:string)=>type==='mepLayerPlans'?[{id:'reference',name:'Autre PDF'}]:{source:'data:application/pdf;base64,UEZERg=='});
  const source=ts.transpileModule(readFileSync('lib/plan-progress/editor/plan-layers.js','utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  runInNewContext(source,{exports,Promise,document:{getElementById:control,createElement:(tag:string)=>control(tag),
    querySelector:control,body:{append(){}}},Option:class{constructor(public text:string,public value:string){}},
    require:(name:string)=>name==='./bridge.js'?{request}:name==='./pdf-viewer.js'?{loadPdf}:undefined});
  return {exports,dialog,control,request};
}

describe('temporary PDF reference lifetime',()=>{
  it('destroys the loading task rather than only cleaning rendered page resources',async()=>{
    const q=loadLayers(),destroy=vi.fn(async()=>{}),cleanup=vi.fn(),documentDestroy=vi.fn();
    q.exports.disposeLayerPdf({loadingTask:{destroy},destroy:documentDestroy,cleanup});
    await Promise.resolve();
    expect(destroy).toHaveBeenCalledOnce();expect(documentDestroy).not.toHaveBeenCalled();expect(cleanup).not.toHaveBeenCalled();
  });

  it('uses the document destruction API when no loading-task handle is available',()=>{
    const q=loadLayers(),destroy=vi.fn(),cleanup=vi.fn();
    q.exports.disposeLayerPdf({destroy,cleanup});
    expect(destroy).toHaveBeenCalledOnce();expect(cleanup).not.toHaveBeenCalled();
  });

  it('tolerates missing documents and legacy cleanup-only resources',()=>{
    const q=loadLayers(),cleanup=vi.fn();
    expect(()=>q.exports.disposeLayerPdf(null)).not.toThrow();
    expect(()=>q.exports.disposeLayerPdf(undefined)).not.toThrow();
    q.exports.disposeLayerPdf({cleanup});expect(cleanup).toHaveBeenCalledOnce();
  });

  it('does not let synchronous or asynchronous destruction failures escape the cleanup path',async()=>{
    const q=loadLayers();
    expect(()=>q.exports.disposeLayerPdf({destroy(){throw Error('Already destroyed');}})).not.toThrow();
    q.exports.disposeLayerPdf({loadingTask:{destroy:()=>Promise.reject(Error('Worker already gone'))}});
    await new Promise(resolve=>setTimeout(resolve,0));
  });

  it.each(['clear','close'])('disposes a PDF that finishes loading after the user has chosen to %s',async(action)=>{
    let complete!:(value:any)=>void;
    const loadPdf=vi.fn(()=>new Promise(resolve=>{complete=resolve;})),q=loadLayers(loadPdf);
    const api=q.exports.attachMepLayers({getState:()=>({currentDoc:'main',currentPage:1}),getViewer:()=>null,toast:vi.fn()});
    await api.open();q.control('#mepLayerPlan').value='reference';
    const button=q.control('[data-mep-layer-load]');button.hasAttribute=(key:string)=>key==='data-mep-layer-load';
    const pending=q.dialog.events.click({target:{closest:()=>button}});
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(loadPdf).toHaveBeenCalledOnce();
    if(action==='clear')api.clear();else q.dialog.close();
    const destroy=vi.fn(async()=>{}),getPage=vi.fn();
    complete({loadingTask:{destroy},numPages:3,getPage});await pending;
    expect(destroy).toHaveBeenCalledOnce();expect(getPage).not.toHaveBeenCalled();
    expect(q.control('#mepLayerPlan').disabled).toBe(false);expect(button.disabled).toBe(false);
  });
});
