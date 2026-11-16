'use client';

import { useEffect, useRef, useState } from 'react';
import { canTrackPdfPlan,editorHtml, emptyProgress, progressGroups, progressScope, type ProgressOperation } from '../../lib/plan-progress/core';
import { ProgressSession } from '../../lib/plan-progress/session';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { listWebOperations } from '@/lib/web-outbox';
import { progressPdfData } from '@/lib/plan-progress-pdf-cache';
import { waitForPlanUri } from '../../lib/plan-progress/startup';
import { readSupabase } from '@/lib/bounded-read';
import { loadProgressAsset } from '@/lib/plan-progress-assets';
import {storeMepWebPhoto,resolveMepWebPhotos} from '@/lib/mep-photos';
import {resolvePrivateMediaRefs} from '@/lib/private-media-client';
import {validateMepReportHtml} from '../../lib/plan-progress/print-contract';

type Props = {
  owner: string; userId: string; organizationId: string; companyId?: string;
  plan: { id: string; name: string; uri: string; pdf_page_count?: number; chantier_id?: string; building?:string;level?:string;revision_code?:string };
  people?: {id:string;name?:string;companyId?:string;company_id?:string}[];
  availablePlans?: {id:string;name:string;uri:string;file_type?:string;chantier_id?:string;pdf_page_count?:number;building?:string;level?:string;revision_code?:string}[];
  projectName: string; resolvedUri: string;
  companies: { id: string; name: string; color?: string; organization_id?: string }[];
  lots: { id: string; name?: string; company_id?: string; chantier_id?: string }[];
  permissions: { edit: boolean; editOwn: boolean; delete: boolean; export: boolean };
  pendingCount: number; syncError: boolean;
  enqueue: (operation: ProgressOperation) => Promise<void>;
  onClose: () => void;
};
export default function PlanProgress(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef(props); latest.current = props;
  const [html,setHtml] = useState('');
  const [error,setError] = useState('');
  const [attempt,setAttempt] = useState(0);
  const [closing,setClosing] = useState(false);
  const ready = useRef(false);
  const nonce = useRef('');
  const permissionKey = JSON.stringify({...props.permissions,companyId:props.companyId??null});

  useEffect(() => { const previous = document.activeElement; dialog.current?.showModal(); return () => { if (previous instanceof HTMLElement) previous.focus(); }; },[]);
  useEffect(() => {
    let active = true;
    const startup = new AbortController();
    setHtml('');setError('');
    ready.current = false;
    const captured = props;
    const owned = () => active && latest.current.owner === captured.owner && latest.current.companyId===captured.companyId && latest.current.plan.id === captured.plan.id && latest.current.plan.uri === captured.plan.uri;
    const key = progressScope(props.userId,props.organizationId,props.plan.id,props.plan.uri) + ':' + permissionKey;
    const drawingKey = `bt-progress-drawing-mode-v1:${props.userId}:${props.organizationId}`;
    const projectKey=key+':mep-project';
    const photoScope=captured.userId+':'+captured.organizationId;
    const pending = async () => (await listWebOperations(captured.owner)).filter(row => row.kind === 'plan_progress' && row.payload.planId === captured.plan.id && row.payload.sourceRef === captured.plan.uri).map(row => row.payload as unknown as ProgressOperation);
    const session = new ProgressSession({ planId: props.plan.id, sourceRef: props.plan.uri, owned, online: () => navigator.onLine,
      actor:{id:captured.userId,name:captured.people?.find(person=>person.id===captured.userId)?.name||'Utilisateur de cet appareil'},
      newId: () => crypto.randomUUID(), pending,
      cacheRead: async () => localStorage.getItem(key),
      cacheWrite: async value => { if (owned()) localStorage.setItem(key,value); },
      read: async () => {
        if (!navigator.onLine) return emptyProgress();
        return readSupabase(signal => supabaseBrowser.rpc('read_plan_progress', { p_plan_id: captured.plan.id, p_source_ref: captured.plan.uri }).abortSignal(signal), { signal: startup.signal });
      },
      enqueue: async operation => {
        const { data } = await supabaseBrowser.auth.getSession();
        if (!owned() || data.session?.user.id !== captured.userId) throw new Error('La session du chantier a changé.');
        await latest.current.enqueue(operation);
      },
    });
    const receive = async (event: MessageEvent) => {
      const message = event.data;
      if (!owned() || event.source !== frame.current?.contentWindow || message?.channel !== 'bt-plan-progress' || message.nonce !== nonce.current || typeof message.id !== 'string') return;
      try {
        let payload = {};
        if (message.type === 'ready') { ready.current = true; }
        else if (message.type === 'drawingPreference') {
          const value = message.payload?.value;
          if (value !== 'free' && value !== 'right_angles') throw new Error('Réglage de tracé invalide.');
          localStorage.setItem(drawingKey,value);
        }
        else if (message.type === 'exit') {
          setClosing(false);
          if (!message.payload?.unconfirmed || window.confirm('Enregistrement non confirmé. Revenir aux plans pour contrôler la file de synchronisation ?')) latest.current.onClose();
        }
        else if (message.type === 'closeError') { setClosing(false); window.alert(String(message.payload?.message ?? 'Enregistrement en cours.')); }
        else if (message.type === 'save') { await session.save(message.payload); payload = { text: 'Enregistré sur cet appareil · synchronisation en attente',history:session.history,elementActivity:session.elementActivity }; }
        else if (message.type === 'reload') { payload = await session.refresh() ?? {}; }
        else if(message.type==='projectMep'){
          if(!navigator.onLine){const cached=localStorage.getItem(projectKey);if(!cached)throw Error('Ouvrez la synthèse en ligne avant de la consulter hors connexion.');payload={...JSON.parse(cached),offline:true};}
          else {payload=await readSupabase(signal=>supabaseBrowser.rpc('read_project_mep',{p_plan_id:captured.plan.id,p_source_ref:captured.plan.uri}).abortSignal(signal),{signal:startup.signal});if(!owned())return;try{localStorage.setItem(projectKey,JSON.stringify(payload));}catch{}}
        }
        else if(message.type==='markMepNotificationsRead'){payload=await readSupabase(signal=>supabaseBrowser.rpc('mark_mep_notifications_read',{p_plan_id:captured.plan.id,p_source_ref:captured.plan.uri}).abortSignal(signal),{signal:startup.signal,retries:0});}
        else if(message.type==='mepLayerPlans'){
          payload=(latest.current.availablePlans||[]).filter(p=>p.chantier_id===captured.plan.chantier_id&&p.id!==captured.plan.id&&canTrackPdfPlan(p)).map(p=>({id:p.id,name:p.name,pages:p.pdf_page_count||1,building:p.building||'',level:p.level||'',revision:p.revision_code||''}));
        }
        else if(message.type==='mepLayerPdf'){
          const plan=latest.current.availablePlans?.find(p=>p.id===message.payload?.planId&&p.chantier_id===captured.plan.chantier_id&&canTrackPdfPlan(p));if(!plan)throw Error('Plan de calque inaccessible.');
          const source=await progressPdfData(progressScope(captured.userId,captured.organizationId,plan.id,plan.uri),async()=>{const refs=await resolvePrivateMediaRefs([plan.uri]);const uri=refs.get(plan.uri);if(!uri)throw Error('Calque indisponible. Ouvrez ce PDF en ligne avant le mode hors connexion.');return uri;});
          payload={source,pages:plan.pdf_page_count||1,id:plan.id,name:plan.name,revision:plan.revision_code||''};
        }
        else if(message.type==='pickMepPhotos'&&(captured.permissions.edit||captured.permissions.editOwn)){
          const input=window.document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';input.multiple=true;
          const files=await new Promise<File[]>((resolve,reject)=>{const timer=setTimeout(()=>{input.remove();reject(Error('Sélection photo expirée.'));},120000);input.onchange=()=>{clearTimeout(timer);resolve([...input.files||[]]);input.remove();};input.addEventListener('cancel',()=>{clearTimeout(timer);resolve([]);input.remove();});input.click();});
          if(!owned())return;if(files.length>10)throw Error('10 photos maximum par point bloquant.');
          const refs=[];for(const file of files){refs.push(await storeMepWebPhoto(photoScope,file));if(!owned())return;}payload={refs};
        }
        else if(message.type==='resolveMepPhotos'){
          const refs=message.payload?.refs;
          const allowed=new Set(session.document.elements.flatMap(el=>Array.isArray(el.blockers)?el.blockers.flatMap((b:any)=>b.photoRefs||[]):[]));
          // Unsaved photos belong to this account's IDB scope; remote refs require RPC access checks.
          if(!Array.isArray(refs)||refs.some((ref:string)=>!String(ref).startsWith('btlocal://')&&!allowed.has(ref))){
            // Project export refs are still individually authorised by the private-media resolver.
            if(!Array.isArray(refs)||refs.some((ref:string)=>!/^bt(?:local|media):\/\/[0-9a-f-]{36}$/i.test(ref)))throw Error('Photos invalides.');
          }
          payload=await resolveMepWebPhotos(photoScope,refs);
        }
        else if(message.type==='mepPdf'&&captured.permissions.export){
          const report=validateMepReportHtml(message.payload?.html);
          const printFrame=window.document.createElement('iframe');printFrame.title='Rapport MEP — enregistrer en PDF';printFrame.setAttribute('sandbox','allow-same-origin allow-modals');Object.assign(printFrame.style,{position:'fixed',width:'1px',height:'1px',opacity:'0',pointerEvents:'none'});
          printFrame.srcdoc=report;printFrame.onload=()=>{const images=[...printFrame.contentDocument?.images||[]];void Promise.all(images.map(img=>img.decode().catch(()=>{}))).then(()=>{if(!owned()){printFrame.remove();return;}printFrame.contentWindow?.focus();printFrame.contentWindow?.print();setTimeout(()=>printFrame.remove(),60000);});};window.document.body.append(printFrame);payload={printDialog:true};
        }
        else if (message.type === 'download' && captured.permissions.export) {
          const base64 = message.payload?.base64;
          if (typeof base64 !== 'string' || base64.length > 20_000_000 || !/^[A-Za-z0-9+/=]+$/.test(base64)) throw new Error('Export invalide.');
          const bytes = Uint8Array.from(atob(base64),char => char.charCodeAt(0));
          const format=message.payload?.format==='csv'?'csv':'xlsx';
          const url = URL.createObjectURL(new Blob([bytes],{ type: format==='csv'?'text/csv;charset=utf-8':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
          const link = document.createElement('a'); link.href = url; link.download = 'BuildTrack-avancement-'+new Date().toISOString().slice(0,10)+'.'+format; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),60_000);
        } else throw new Error('Action non autorisée.');
        if (owned()) frame.current?.contentWindow?.postMessage({ channel:'bt-plan-progress',nonce:nonce.current,id:message.id,payload },'*');
      } catch (cause) {
        if (owned()) frame.current?.contentWindow?.postMessage({ channel:'bt-plan-progress',nonce:nonce.current,id:message.id,error:cause instanceof Error ? cause.message : 'Enregistrement impossible.' },'*');
      }
    };
    window.addEventListener('message',receive);
    void (async () => {
      const [document,template,moduleSource,workerSource,pdfSource] = await Promise.all([
        session.open(),loadProgressAsset('editor.html'),loadProgressAsset('pdf.mjs'),loadProgressAsset('pdf.worker.mjs'),
        progressPdfData(progressScope(props.userId,props.organizationId,props.plan.id,props.plan.uri),
          () => waitForPlanUri(() => owned() ? latest.current.resolvedUri : '', startup.signal)),
      ]);
      if (!owned()) return;
      nonce.current = crypto.randomUUID();
      const groups = progressGroups(props.companies,props.lots.filter(lot=>session.assignableLotIds.includes(lot.id)).map(lot => ({ id:lot.id,name:lot.name ?? 'Ouvrages',companyId:lot.company_id,chantierId:lot.chantier_id })),props.plan.chantier_id);
      let drawingPreference: string | null = null;
      try { drawingPreference = localStorage.getItem(drawingKey); } catch {}
      setHtml(editorHtml(template,{ nonce:nonce.current,document,drawingPreference,history:session.history,elementActivity:session.elementActivity,groups,companyId:props.companyId,userId:props.userId,permissions:props.permissions,
        plan:{ id:props.plan.id,name:props.plan.name,pages:props.plan.pdf_page_count ?? 1,building:props.plan.building||'',level:props.plan.level||'',revision:props.plan.revision_code||'' },people:(props.people||[]).map(p=>({id:p.id,name:p.name||p.id,companyId:p.companyId||p.company_id})),projectName:props.projectName,pdfSource,pdfjs:{ moduleSource,workerSource },
        syncText:(await pending()).length ? 'Modifications en attente de synchronisation' : session.fresh ? 'Suivi chargé · synchronisé' : 'Données locales · actualisation à la connexion' }));
    })().catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Impossible de charger l’avancement.'); });
    return () => { active = false; startup.abort(); window.removeEventListener('message',receive); };
  },[props.owner,props.plan.id,props.plan.uri,permissionKey,attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ channel:'bt-plan-progress',nonce:nonce.current,type:'status',text:props.syncError ? 'Synchronisation à vérifier dans la file hors ligne' : props.pendingCount ? `${props.pendingCount} modification(s) en attente de synchronisation` : navigator.onLine ? 'File d’attente vide · actualisation du suivi' : 'Hors ligne · enregistré sur cet appareil' },'*');
    if (!props.pendingCount && !props.syncError && navigator.onLine) frame.current?.contentWindow?.postMessage({ channel:'bt-plan-progress',nonce:nonce.current,type:'refreshAvailable' },'*');
  },[props.pendingCount,props.syncError,html]);
  function closeEditor() {
    if (!html || !ready.current) { props.onClose(); return; }
    if (closing) return;
    setClosing(true);
    frame.current?.contentWindow?.postMessage({ channel:'bt-plan-progress',nonce:nonce.current,type:'closeEditor' },'*');
  }
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => { setClosing(false); window.alert('La fermeture n’a pas pu être confirmée. Les données restent affichées ; réessayez.'); },45_000);
    return () => clearTimeout(timer);
  },[closing]);
  return <dialog ref={dialog} aria-label="Avancement sur plan" onCancel={event => { event.preventDefault(); closeEditor(); }}
    style={{ margin:0,padding:0,width:'100vw',height:'100dvh',maxWidth:'100vw',maxHeight:'100dvh',border:0,background:'#fff',fontFamily:'Arial, sans-serif' }}>
    <div style={{ display:'flex',flexDirection:'column',height:'100%',paddingTop:'env(safe-area-inset-top)' }}>
      <header style={{ display:'flex',alignItems:'center',gap:12,padding:'0 12px',minHeight:48 }}>
        <button disabled={closing} onClick={closeEditor} style={{ minHeight:48,padding:'8px 16px',color:'#003582',fontWeight:700 }}>‹ Plans</button>
        <strong style={{ overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{props.plan.name}</strong>
      </header>
      {error ? <div role="alert" style={{ padding:24 }}><p>{error}</p><button onClick={() => setAttempt(value => value + 1)} style={{ minHeight:48 }}>Réessayer</button></div>
        : html ? <iframe ref={frame} title="Plan et avancement des ouvrages" sandbox="allow-scripts allow-forms" srcDoc={html} style={{ flex:1,minHeight:0,width:'100%',border:0,paddingBottom:'env(safe-area-inset-bottom)' }} />
          : <p role="status" style={{ padding:24 }}>Chargement du plan et de son avancement…</p>}
    </div>
  </dialog>;
}
