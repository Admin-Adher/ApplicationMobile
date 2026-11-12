// Keep dialogs in the visible portion of the screen when the mobile keyboard opens.
export function attachMobileViewport(){
  const viewport=window.visualViewport,root=document.documentElement;
  let frame;
  const update=()=>{
    cancelAnimationFrame(frame);
    frame=requestAnimationFrame(()=>{
      const zoomed=viewport&&Math.abs(viewport.scale-1)>.01;
      const height=zoomed?window.innerHeight:viewport?.height||window.innerHeight;
      root.style.setProperty('--app-height',`${Math.round(height)}px`);
      root.style.setProperty('--visible-top',`${viewport?.offsetTop||0}px`);
      const active=document.activeElement,dialog=active?.closest('dialog[open]');
      if(dialog&&active.matches('input,textarea,select')){
        const field=active.getBoundingClientRect(),box=dialog.getBoundingClientRect();
        if(field.top<box.top||field.bottom>box.bottom)active.scrollIntoView({block:'nearest'});
      }
    });
  };
  window.addEventListener('resize',update);
  viewport?.addEventListener('resize',update);viewport?.addEventListener('scroll',update);
  document.addEventListener('focusin',update);
  for(const input of document.querySelectorAll('input[type="number"]'))input.inputMode='decimal';
  update();
}
