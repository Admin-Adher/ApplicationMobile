import {DIMENSION_UNITS,PRICE_BASES,DEFAULT_PRICE_BASIS,dimensionsFor,basisFor,measureDimensions,pricedQuantity,basisProblem,quantityText} from './dimensions.js';

export class DimensionForm{
  constructor({root,getBase,onChange}){
    Object.assign(this,{root,getBase,onChange});this.previousUnit='cm';
    this.unit=root.querySelector('#dimensionUnit');this.profile=root.querySelector('#dimensionProfile');
    this.inputs={widthM:root.querySelector('#dimensionWidth'),heightM:root.querySelector('#dimensionHeight'),thicknessM:root.querySelector('#dimensionThickness')};
    this.basis=root.querySelector('#priceBasis');
    this.unit.addEventListener('change',()=>{
      const ratio=DIMENSION_UNITS[this.previousUnit]/DIMENSION_UNITS[this.unit.value];
      for(const input of Object.values(this.inputs))if(input.value!=='')input.value=String(Number((Number(input.value)*ratio).toPrecision(12)));
      this.previousUnit=this.unit.value;this.update();
    });
    root.addEventListener('input',()=>this.update());root.addEventListener('change',()=>this.update());
  }
  setElement(element){
    this.kind=element.kind;const d=dimensionsFor(element);this.unit.value=d.displayUnit;this.previousUnit=d.displayUnit;this.profile.value=d.profile;
    for(const [name,input] of Object.entries(this.inputs))input.value=d[name]?String(Number((d[name]/DIMENSION_UNITS[d.displayUnit]).toPrecision(12))):'';
    const options=this.kind==='point'?['unit']:this.kind==='area'?['area','volume']:['linear','footprint','wall','volume'];
    this.basis.innerHTML=options.map(key=>`<option value="${key}">${PRICE_BASES[key].label}</option>`).join('');
    this.basis.value=basisFor(element);this.update();
  }
  element(){
    const factor=DIMENSION_UNITS[this.unit.value];
    const read=input=>input.value===''?null:Number(input.value)*factor;
    return {kind:this.kind,priceBasis:this.basis.value||DEFAULT_PRICE_BASIS[this.kind],dimensions:{profile:this.profile.value,displayUnit:this.unit.value,widthM:this.kind==='line'?read(this.inputs.widthM):null,heightM:this.kind==='line'?read(this.inputs.heightM):null,thicknessM:this.kind==='area'?read(this.inputs.thicknessM):null}};
  }
  read(){
    const element=this.element(),d=element.dimensions;
    for(const [key,input] of Object.entries(this.inputs)){
      const relevant=this.kind==='area'?key==='thicknessM':this.kind==='line'?(key==='widthM'||key==='heightM'&&d.profile==='rect'):false;
      if(relevant&&input.value!==''&&(!Number.isFinite(d[key])||d[key]<=0||d[key]>(key==='thicknessM'?100:1000))){input.setCustomValidity('Saisissez une dimension positive valide.');input.closest('details')?.setAttribute('open','');input.reportValidity();return null;}
    }
    const problem=basisProblem(element);
    this.basis.setCustomValidity(problem);
    if(problem){this.basis.closest('details')?.setAttribute('open','');this.basis.reportValidity();return null;}
    return element;
  }
  update(){
    for(const input of Object.values(this.inputs))input.setCustomValidity('');this.basis.setCustomValidity('');
    const line=this.kind==='line',area=this.kind==='area',element=this.element(),d=element.dimensions,base=this.getBase();
    this.root.querySelector('#dimensionFields').hidden=!(line||area);
    this.root.querySelector('#priceBasisField').hidden=this.kind==='point';
    this.root.querySelector('#dimensionProfileField').hidden=!line;
    this.root.querySelector('#dimensionWidthField').hidden=!line;
    this.root.querySelector('#dimensionHeightField').hidden=!line||d.profile==='round';
    this.inputs.heightM.disabled=!line||d.profile==='round';
    this.inputs.widthM.disabled=!line;this.inputs.thicknessM.disabled=!area;
    this.root.querySelector('#dimensionThicknessField').hidden=!area;
    this.root.querySelector('#dimensionWidthLabel').textContent=d.profile==='round'?'Diamètre':'Largeur / épaisseur';
    this.root.querySelectorAll('.dimension-unit-label').forEach(label=>label.textContent=this.unit.value);
    const m=measureDimensions(element,base),rows=[];
    const add=(label,value,unit)=>{if(value!==null&&Number.isFinite(value)&&value>=0)rows.push(`<div><span>${label}</span><strong>${quantityText(value,unit)}</strong></div>`);};
    if(line){add('Longueur du tracé',base,'m');add('Emprise au sol',m.footprint,'m²');add('Surface verticale',m.wall,'m²');}
    if(area)add('Surface du contour',base,'m²');
    add('Volume géométrique',m.volume,'m³');
    this.root.querySelector('#dimensionsPreview').innerHTML=rows.join('');
    const problem=basisProblem(element),unit=PRICE_BASES[basisFor(element)].unit;
    this.root.querySelector('#priceBasisHint').textContent=problem||`Quantité retenue : ${quantityText(pricedQuantity(element,base),unit)}. Le prix saisi s’applique par ${unit}.`;
    this.root.querySelector('#priceBasisHint').classList.toggle('dimension-problem',Boolean(problem));
    this.root.querySelector('#dimensionGeometryHint').textContent=area?'Le volume correspond à la surface × l’épaisseur.':d.profile==='round'?'Volume géométrique plein : longueur × π × (diamètre / 2)².':'Volume géométrique : longueur × largeur × hauteur, hors déduction des ouvertures et raccords.';
    this.onChange?.(element);
  }
}
