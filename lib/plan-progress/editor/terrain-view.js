import {icon} from './icons.js';
import {boot} from './bridge.js';
import {STATUSES,lotFor,currentElements,quantity,unitFor,num,progressWeight,escapeHtml as e} from './model.js';
export const terrainLabel=status=>status==='installed'?'Terminé':STATUSES[status].label;
const marks={todo:'−',progress:'◐',installed:'✓'};
export function renderTerrainInspector(root,state,docId,page,selected){
  const elements=currentElements(state,docId,page).filter(el=>selected.has(el.id)),el=elements[0],one=elements.length===1;
  root.classList.toggle('selected-inspector',Boolean(el));
  if(!el){
    const count=currentElements(state,docId,page).length;
    root.innerHTML=`<div class="terrain-empty"><div>${icon('cursor')}<div><h2>${count?'Touchez un ouvrage sur le plan':boot.permissions.edit?'Votre plan est prêt':'Aucun ouvrage préparé'}</h2><p>${count?'Indiquez son avancement, ou ajoutez un nouvel ouvrage.':boot.permissions.edit?'« Ajouter un ouvrage » permet de placer vos premiers repères.':'Les ouvrages apparaîtront après leur préparation par l’équipe du chantier.'}</p></div></div><button class="terrain-button" ${count?'data-open-works':'data-open-add'}>${icon(count?'layers':'plus')}${count?'Voir la liste':'Ajouter un ouvrage'}</button></div>`;
    return;
  }
  const lot=lotFor(el.lotId);
  const sameStatus=elements.every(item=>item.status===el.status)?el.status:null;
  root.innerHTML=`
    <div class="terrain-selection-heading"><div>
      <span class="terrain-reference">${one?`${e(el.reference)} · ${e(lot.company)}`:'SÉLECTION MULTIPLE'}</span>
      <h2 tabindex="-1" id="terrainSelectionTitle">${one?`<button class="terrain-title-button" data-open-work-title aria-label="Nom complet et détails : ${e(el.name)}"><span>${e(el.name)}</span></button>`:`${elements.length} ouvrages sélectionnés`}</h2>
      <p>${one?`${el.status==='progress'?num(progressWeight(el)*100,1)+' % réalisé · ':''}${el.room?e(el.room)+' · ':''}${num(quantity(el,state),unitFor(el)==='m³'?6:1)} ${unitFor(el)}`:'Le choix d’avancement s’applique à toute la sélection.'}</p>
    </div><button class="terrain-icon-button" data-clear-selection aria-label="Fermer la sélection">${icon('close')}</button></div>
    <div class="terrain-statuses" aria-label="Avancement de l’ouvrage">${Object.entries(marks).map(([status,mark])=>`<button class="terrain-status" data-status="${status}" aria-pressed="${sameStatus===status}" style="--status-color:${STATUSES[status].color}"><span class="terrain-status-mark">${mark}</span><strong>${terrainLabel(status)}</strong></button>`).join('')}</div>
    ${one?'<button class="precise-progress-button" data-precise-progress>Renseigner un pourcentage ou une quantité</button>':''}
    <div class="terrain-selection-footer">
      ${one?`<button class="terrain-text-button" data-adjust-element>Ajuster le tracé</button><button class="terrain-text-button" data-edit-element>${icon('edit')}Modifier</button>`:''}
      <span class="terrain-current-state">${sameStatus==='checked'?icon('checkCircle'):''}${sameStatus==='checked'?'Contrôlé · validé':one?'':'En cours = 50 %'}</span>
      <button class="terrain-text-button" data-open-details aria-label="Détails et contrôle"><span class="full-details-label">Détails et contrôle</span><span class="compact-details-label" aria-hidden="true">Détails</span>${icon('chevron')}</button>
    </div>`;
}
export function workRows(elements,state){
  return elements.map(el=>`<button class="work-row" data-pick-element="${e(el.id)}"><span class="work-symbol" style="--status-color:${STATUSES[el.status].color}">${icon({point:'pin',line:'route',area:'area'}[el.kind])}</span><span class="work-description"><strong>${e(el.name)}</strong><span>${e(el.reference)} · ${e(lotFor(el.lotId).company)}</span><small>${num(quantity(el,state),unitFor(el)==='m³'?6:1)} ${unitFor(el)} · ${terrainLabel(el.status)}${el.status==='progress'?' · '+num(progressWeight(el)*100,1)+' %':''}</small></span>${icon('chevron')}</button>`).join('');
}
