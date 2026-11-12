const paths = {
  menu:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  route:'<circle cx="5" cy="18" r="2"/><path d="M5 16V6h12"/><circle cx="19" cy="6" r="2"/><path d="M5 10h4V6"/>',
  hand:'<path d="M8 13V5a2 2 0 0 1 4 0v7-9a2 2 0 0 1 4 0v9-7a2 2 0 0 1 4 0v9c0 5-3 8-7 8-3 0-5-2-7-5l-3-5a2 2 0 0 1 3-2l2 3Z"/>',
  edit:'<path d="m4 16 12-12 4 4-12 12-5 1 1-5Zm10-10 4 4"/>',
  trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  layers:'<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
  chart:'<path d="M4 3v17h17M8 15v-4m5 4V6m5 9v-6"/>',
  history:'<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6m3-3v5l3 2"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 2-2.5 2-2.5 4M12 17h.01"/>',
  chevron:'<path d="m9 5 7 7-7 7"/>',
  upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
  download:'<path d="M12 3v13m-5-5 5 5 5-5M4 15v5h16v-5"/>',
  checkCircle:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  file:'<path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 13h8m-8 4h5"/>',
  building:'<path d="M4 21V4h11v17M15 10h5v11M8 8h3m-3 4h3m-3 4h3M2 21h20"/>',
  select:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8h8v8H8z"/>',
  cursor:'<path d="m5 3 14 10-7 1-3 7-4-18Z"/>',
  pin:'<circle cx="12" cy="9" r="3"/><path d="M18 9c0 5-6 12-6 12S6 14 6 9a6 6 0 0 1 12 0Z"/>',
  line:'<path d="m5 19 14-14"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/>',
  area:'<path d="m5 5 14-1 2 14-15 3L5 5Z"/><path d="M5 5h.01M19 4h.01M21 18h.01M6 21h.01" stroke-width="4"/>',
  ruler:'<path d="m3 16 13-13 5 5L8 21l-5-5Z"/><path d="m8 11 3 3m0-6 3 3m0-6 3 3"/>',
  minus:'<path d="M5 12h14"/>', plus:'<path d="M5 12h14M12 5v14"/>',
  fit:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
  bulb:'<path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0l-1 2H9l-1-2Z"/>',
  wind:'<path d="M3 8h12a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h5a3 3 0 1 1-3 3"/>',
  paint:'<path d="M4 4h14v6H4zM18 7h3v7h-9v3m-2 0h4v5h-4z"/>',
  undo:'<path d="M3 9h11a6 6 0 0 1 0 12M3 9l6-6M3 9l6 6"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  wallet:'<path d="M4 5h15v15H4V5Zm0 0V3h13v2m-2 6h6v5h-6v-5Z"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
};
export function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.info}</svg>`;
}
export function fillIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
}
