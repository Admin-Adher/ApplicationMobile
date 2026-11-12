import {boot} from './bridge.js';
let pdfModule;
const url=source=>URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
export async function loadPdf(source){
  if(!pdfModule){
    // Both sources are supplied by the authenticated host from bundled assets.
    // No CDN, session token or fallback to an unrelated PDF is used.
    const moduleUrl=url(boot.pdfjs.moduleSource),workerUrl=url(boot.pdfjs.workerSource);
    pdfModule=await new Function('url','return import(url)')(moduleUrl);
    pdfModule.GlobalWorkerOptions.workerSrc=workerUrl;
  }
  let options;
  if(typeof source==='string'&&source.startsWith('data:')){
    const bytes=atob(source.slice(source.indexOf(',')+1));
    options={data:Uint8Array.from(bytes,char=>char.charCodeAt(0))};
  }else options=typeof source==='string'?{url:source}:{data:new Uint8Array(source.slice(0))};
  return pdfModule.getDocument({...options,useSystemFonts:true,isEvalSupported:false}).promise;
}
export {PdfViewer} from './pdf-tile-viewer.js';
