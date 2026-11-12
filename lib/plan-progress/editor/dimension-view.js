import {dimensionsFor,dimensionText,quantityText,PRICE_BASES,basisFor} from './dimensions.js';
import {dimensionalMeasures} from './model.js';

export function dimensionSummary(element,state){
  if(element.kind==='point')return '';
  const d=dimensionsFor(element),m=dimensionalMeasures(element,state),rows=[];
  const add=(name,value)=>rows.push(`<div><dt>${name}</dt><dd>${value}</dd></div>`);
  if(element.kind==='line'){
    if(d.widthM)add(d.profile==='round'?'Diamètre':'Largeur / épaisseur',dimensionText(d.widthM,d.displayUnit));
    if(d.profile==='rect'&&d.heightM)add('Hauteur',dimensionText(d.heightM,d.displayUnit));
    if(m.footprint!==null)add('Emprise au sol',quantityText(m.footprint,'m²'));
    if(m.wall!==null)add('Surface verticale',quantityText(m.wall,'m²'));
  }else if(d.thicknessM)add('Épaisseur de couche',dimensionText(d.thicknessM,d.displayUnit));
  if(m.volume!==null)add('Volume géométrique',quantityText(m.volume,'m³'));
  return `<section class="dimension-summary" aria-label="Dimensions de l’ouvrage"><div class="dimension-summary-title"><h3>Dimensions</h3><button class="text-button" data-edit-dimensions>${rows.length?'Modifier':'Renseigner'}</button></div>${rows.length?`<dl>${rows.join('')}</dl>`:'<p>Ajoutez une largeur, un diamètre ou une épaisseur pour calculer l’emprise et le volume.</p>'}<div class="dimension-basis-note">Prix : ${PRICE_BASES[basisFor(element)].label}</div></section>`;
}
export function dimensionBand(element,state,color){
  const d=dimensionsFor(element),scale=state.calibrations[`${element.docId}:${element.page}`];
  if(element.kind!=='line'||!d.widthM||!scale)return '';
  const width=d.widthM/scale;
  return `<polyline class="dimension-band" data-width-m="${d.widthM}" data-plan-width="${width}" points="${element.points.map(p=>`${p.x},${p.y}`).join(' ')}" stroke="${color}" stroke-width="${width}" stroke-opacity=".18" stroke-linejoin="miter" stroke-miterlimit="4" stroke-linecap="butt" fill="none"/>`;
}
