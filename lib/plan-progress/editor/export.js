import { LOTS,STATUSES,quantity,geometricQuantity,geometryUnitFor,dimensionalMeasures,summary,lotFor,floorName,unitFor,documentPageName,progressWeight } from './model.js';
import {dimensionsFor,basisFor,PRICE_BASES} from './dimensions.js';
import {request,boot} from './bridge.js';
const loadXlsx=async()=>globalThis.XLSX;
export async function exportWorkbook(state){
  const XLSX=await loadXlsx(),book=XLSX.utils.book_new();
  const rows=[['Document','Niveau / page','Lot','Entreprise','Quantité prévue','Unité','Réalisé (%)','Contrôlé (%)','Référence HT (€)','Réalisé HT (€)','Validé HT (€)','Déjà facturé HT (€)','À proposer HT (€)','Identifiant du PDF']];
  for(const doc of state.documents)for(let page=1;page<=doc.pages;page++){
    for(const row of summary(state,doc.id,page).rows.filter(r=>r.count||r.billed)){
      const line=rows.length+1;
      rows.push([doc.name,documentPageName(doc,page),row.lot.name,row.lot.company,row.mixed?row.referenceLabel:row.total,row.unit,row.percent/100,row.checkedPercent/100,row.contract,row.realized,row.validated,row.billed,{t:'n',f:`MAX(0,K${line}-L${line})`,v:row.proposal},doc.id]);
    }
  }
  const synth=XLSX.utils.aoa_to_sheet(rows);
  synth['!cols']=[{wch:42},{wch:16},{wch:18},{wch:20},{wch:18},{wch:9},{wch:15},{wch:15},...Array.from({length:5},()=>({wch:22})),{wch:38}];
  for(let i=1;i<rows.length;i++){
    for(const col of ['G','H'])if(synth[`${col}${i+1}`])synth[`${col}${i+1}`].z='0.0%';
    for(const col of ['I','J','K','L','M'])if(synth[`${col}${i+1}`])synth[`${col}${i+1}`].z='#,##0.00 "€"';
    if(synth[`E${i+1}`])synth[`E${i+1}`].z='0.######';
  }
  synth['!autofilter']={ref:`A1:N${Math.max(1,rows.length)}`};
  XLSX.utils.book_append_sheet(book,synth,'Synthèse');
  const details=state.elements.map(el=>{
    const lot=lotFor(el.lotId),doc=state.documents.find(d=>d.id===el.docId),q=quantity(el,state),d=dimensionsFor(el),m=dimensionalMeasures(el,state);
    return {'Document':doc?.name||el.docId,'Niveau / page':doc?documentPageName(doc,el.page):`Page ${el.page}`,'Référence':el.reference,'Ouvrage':el.name,'Entreprise':lot.company,'Lot':lot.name,'Quantité':q,'Unité':unitFor(el),'État':STATUSES[el.status].label,'Avancement':progressWeight(el),'Prix unitaire HT (€)':el.price,'Référence HT (€)':q*el.price,'Réalisé HT (€)':q*el.price*progressWeight(el),'Validé HT (€)':el.status==='checked'?q*el.price:0,'Note':el.note||'','Identifiant du PDF':el.docId,'Identifiant de l’ouvrage':el.id,'Mesure du tracé':geometricQuantity(el,state),'Unité du tracé':geometryUnitFor(el),'Section':el.kind==='line'?(d.profile==='round'?'Circulaire':'Rectangulaire'):'','Largeur / diamètre (m)':el.kind==='line'?d.widthM:null,'Hauteur (m)':el.kind==='line'&&d.profile==='rect'?d.heightM:null,'Épaisseur (m)':el.kind==='area'?d.thicknessM:null,'Emprise au sol (m²)':m.footprint,'Surface verticale (m²)':m.wall,'Volume géométrique (m³)':m.volume,'Calcul du prix':PRICE_BASES[basisFor(el)].label};
  });
  const detailSheet=XLSX.utils.json_to_sheet(details);
  detailSheet['!cols']=Array.from({length:27},(_,i)=>({wch:i===0||i===3||i===14||i===15||i===16||i===26?42:23}));
  for(let i=1;i<=details.length;i++){
    if(detailSheet[`J${i+1}`])detailSheet[`J${i+1}`].z='0%';
    for(const col of ['G','R','U','V','W','X','Y','Z'])if(detailSheet[`${col}${i+1}`])detailSheet[`${col}${i+1}`].z='0.######';
    for(const col of ['K','L','M','N'])if(detailSheet[`${col}${i+1}`])detailSheet[`${col}${i+1}`].z='#,##0.00 "€"';
  }
  XLSX.utils.book_append_sheet(book,detailSheet,'Ouvrages');
  const history=XLSX.utils.json_to_sheet(state.history.map(event=>({'Date UTC':event.time,'Action':event.title,'Détail':event.detail})));
  history['!cols']=[{wch:28},{wch:48},{wch:85}];
  XLSX.utils.book_append_sheet(book,history,'Historique');
  const notes=XLSX.utils.aoa_to_sheet([
    ['BuildTrack — suivi d’avancement sur PDF'],
    ['Source','Données du plan BuildTrack courant. Les modifications en attente de synchronisation sont incluses.'],
    ['Export du',new Date().toISOString()],
    ['Périmètre','Toutes les pages du PDF courant uniquement. Les autres plans du chantier ne sont pas inclus.'],
    ['Réalisé','À faire 0 %, En cours : pourcentage saisi (50 % par défaut), Terminé 100 %, Contrôlé 100 %.'],
    ['Pondération','Montants HT dans chaque lot et au total. Les unités différentes ne sont jamais additionnées.'],
    ['Validé','Montant des ouvrages marqués Contrôlé.'],
    ['À proposer','MAX(0, montant validé - montant déjà facturé), calculé séparément par lot et page.'],
    ['Attention','Proposition de suivi, sans émission de facture ni prise en compte de retenue, acompte ou TVA.'],
    ['Mise à jour','Instantané à la date d’export. Le fichier Excel existant ne se synchronise pas automatiquement.'],
    ['Quantités','Tracés mesurés selon l’échelle définie pour chaque page. Vérifier l’échelle avant utilisation.'],
    ['Dimensions','Largeur, diamètre, hauteur et épaisseur stockés en mètres ; saisie possible en mm, cm ou m.'],
    ['Volumes','Volumes géométriques pleins, sans déduction des vides, ouvertures ou raccords.'],
    ['Calcul du prix','Choix explicite par ouvrage : unité, longueur, surface, emprise, surface verticale ou volume. Ajouter une dimension ne change pas ce choix.'],
  ]);notes['!cols']=[{wch:22},{wch:120}];
  XLSX.utils.book_append_sheet(book,notes,'Mode de calcul');
  book.Props={Title:'BuildTrack — avancement sur PDF',Subject:'Suivi sur PDF et préparation de facturation',Author:'BuildTrack'};
  await request('download',{base64:XLSX.write(book,{type:'base64',bookType:'xlsx',compression:true})});
  return {rows:rows.length-1,elements:details.length};
}
