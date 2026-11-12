// All persisted dimensions are in metres. Display units never change the physical geometry.
export const DIMENSION_UNITS={mm:.001,cm:.01,m:1};
export const DEFAULT_PRICE_BASIS={point:'unit',line:'linear',area:'area'};
export const PRICE_BASES={
  unit:{unit:'u',label:'À l’unité (u)'},
  linear:{unit:'m',label:'Longueur du tracé (m)'},
  footprint:{unit:'m²',label:'Emprise au sol — longueur × largeur (m²)'},
  wall:{unit:'m²',label:'Surface verticale — longueur × hauteur (m²)'},
  area:{unit:'m²',label:'Surface du contour (m²)'},
  volume:{unit:'m³',label:'Volume géométrique (m³)'},
};
const positive=value=>Number.isFinite(value)&&value>0?value:null;
export function dimensionsFor(element){
  const d=element.dimensions||{};
  return {profile:d.profile==='round'?'round':'rect',widthM:positive(d.widthM),heightM:positive(d.heightM),thicknessM:positive(d.thicknessM),displayUnit:DIMENSION_UNITS[d.displayUnit]?d.displayUnit:'cm'};
}
export function basisFor(element){
  const allowed=element.kind==='point'?['unit']:element.kind==='area'?['area','volume']:['linear','footprint','wall','volume'];
  return allowed.includes(element.priceBasis)?element.priceBasis:DEFAULT_PRICE_BASIS[element.kind];
}
export function pricedUnit(element){return PRICE_BASES[basisFor(element)].unit;}
export function measureDimensions(element,base){
  const d=dimensionsFor(element);
  if(element.kind==='point')return {base,length:null,area:null,footprint:null,wall:null,volume:null,dimensions:d};
  if(element.kind==='area')return {base,length:null,area:base,footprint:base,wall:null,volume:d.thicknessM?base*d.thicknessM:null,dimensions:d};
  const footprint=d.widthM?base*d.widthM:null;
  const wall=d.profile==='rect'&&d.heightM?base*d.heightM:null;
  const section=d.profile==='round'?(d.widthM?Math.PI*(d.widthM/2)**2:null):(d.widthM&&d.heightM?d.widthM*d.heightM:null);
  return {base,length:base,area:null,footprint,wall,volume:section===null?null:base*section,dimensions:d};
}
export function pricedQuantity(element,base){
  const m=measureDimensions(element,base);
  return {unit:base,linear:base,area:base,footprint:m.footprint,wall:m.wall,volume:m.volume}[basisFor(element)]??0;
}
export function basisProblem(element){
  const d=dimensionsFor(element),basis=basisFor(element);
  if(basis==='footprint'&&!d.widthM)return 'Renseignez une largeur ou un diamètre pour calculer l’emprise.';
  if(basis==='wall'&&(d.profile==='round'||!d.heightM))return 'La surface verticale demande une section rectangulaire et une hauteur.';
  if(basis==='volume'&&element.kind==='area'&&!d.thicknessM)return 'Renseignez l’épaisseur de la couche pour calculer le volume.';
  if(basis==='volume'&&element.kind==='line'&&(!d.widthM||(d.profile==='rect'&&!d.heightM)))return d.profile==='round'?'Renseignez le diamètre pour calculer le volume.':'Renseignez la largeur et la hauteur pour calculer le volume.';
  return '';
}
export function dimensionText(meters,unit='cm'){
  return new Intl.NumberFormat('fr-FR',{maximumFractionDigits:4}).format(meters/DIMENSION_UNITS[unit])+' '+unit;
}
export function quantityText(value,unit){
  return new Intl.NumberFormat('fr-FR',{maximumFractionDigits:unit==='m³'?6:3}).format(value)+' '+unit;
}
export function dimensionCaption(element){
  const d=dimensionsFor(element);
  if(element.kind==='line'&&d.widthM)return `${d.profile==='round'?'Ø':'l.'} ${dimensionText(d.widthM,d.displayUnit)}`;
  if(element.kind==='area'&&d.thicknessM)return `ép. ${dimensionText(d.thicknessM,d.displayUnit)}`;
  return '';
}
