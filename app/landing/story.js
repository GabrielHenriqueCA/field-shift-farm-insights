// As quatro telas pertencem à mesma sequência de cenas da apresentação.
(() => {
  'use strict';
  window.createRotareStory=({asset,onDialog})=>{
    const section=document.querySelector('.product-story'),scenes=[...section.querySelectorAll('.story-scene')];
    const labels=[...section.querySelectorAll('.story-chapters>span')];
    const dialog=section.querySelector('.story-lightbox'),enlarged=dialog.querySelector('img');
    let returnFocus=null;
    section.querySelectorAll('[data-screen]').forEach(image=>{image.loading='eager';image.src=asset(image.dataset.screen);});
    function select(index){
      section.dataset.scene=String(index+1);
      scenes.forEach((scene,i)=>{const active=i===index;scene.classList.toggle('is-active',active);scene.inert=!active;scene.setAttribute('aria-hidden',String(!active));});
      labels.forEach((label,i)=>label.classList.toggle('active',i===index));
    }
    section.querySelectorAll('.story-enlarge').forEach(button=>button.addEventListener('click',()=>{
      returnFocus=button;const image=button.closest('.story-window').querySelector('img');
      enlarged.src=image.src;enlarged.alt=image.alt;onDialog?.(true);dialog.showModal();
    }));
    dialog.querySelector('.story-close').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
    dialog.addEventListener('close',()=>{onDialog?.(false);returnFocus?.focus({preventScroll:true});});
    select(0);return {select};
  };
})();
