// A rolagem e o relógio percorrem as mesmas cenas e executam os mesmos efeitos.
// Aviso de SI: implementação criada com assistência de IA para Datanauts Brasil.
(() => {
  'use strict';
  window.createRotareTour=({stages,reducedMotion,onRunning,onComplete})=>{
    const root=document.documentElement,main=document.querySelector('main');
    const sections=[...main.children].filter(node=>node.tagName==='SECTION');
    let index=0,running=false,transitioning=false,completed=false,suspended=false,paused=false;
    let elapsed=0,lastTime=0,frame=0,manualUntil=0,touchY=null,pendingDirection=0,finishing=null;
    let wheelDistance=0,lastWheelAt=0,wheelDirection=0;
    const ease=p=>p*p*(3-2*p),lessMotion=()=>typeof reducedMotion==='object'?reducedMotion.matches:reducedMotion;
    main.classList.add('deck-ready');root.classList.add('deck-mode');
    const current=()=>stages[index];
    function sync(){
      root.classList.toggle('tour-running',running);
      root.dataset.presentationState=completed?'complete':paused?'paused':running?'running':'ready';
      root.dataset.presentationChapter=String(index+1);
    }
    function apply(next){
      index=next;elapsed=0;lastTime=0;finishing=null;
      const stage=current(),target=document.querySelector(stage.selector);
      sections.forEach(section=>{
        const active=section===target;
        section.classList.toggle('deck-current',active);section.inert=!active;
        section.setAttribute('aria-hidden',String(!active));
      });
      target.querySelectorAll('.reveal').forEach(node=>node.classList.add('visible'));
      stage.onEnter?.();stage.onFrame?.(0);root.dataset.deckScene=stage.id;
      window.scrollTo({top:0,behavior:'instant'});sync();
    }
    function schedule(){if(running&&!transitioning&&!document.hidden&&!frame)frame=requestAnimationFrame(tick);}
    async function fade(frames,duration){
      if(lessMotion())return;
      const animation=main.animate(frames,{duration,easing:'cubic-bezier(.22,.7,.22,1)',fill:'forwards'});
      await animation.finished.catch(()=>{});
      return animation;
    }
    async function move(next){
      if(transitioning||completed||next<0||next>=stages.length)return;
      transitioning=true;cancelAnimationFrame(frame);frame=0;lastTime=0;
      root.dataset.deckTransition='out';
      const out=await fade([{opacity:1,translate:'0 0'},{opacity:0,translate:'0 -10px'}],160);
      apply(next);root.dataset.deckTransition='in';
      const entrance=await fade([{opacity:0,translate:'0 16px'},{opacity:1,translate:'0 0'}],440);
      out?.cancel();entrance?.cancel();transitioning=false;root.dataset.deckTransition='idle';
      if(pendingDirection){const direction=pendingDirection;pendingDirection=0;navigate(direction);}
      schedule();
    }
    async function complete(){
      if(completed||transitioning)return;
      completed=true;running=false;transitioning=true;sync();onRunning?.(false);
      root.dataset.deckTransition='platform';
      await fade([{opacity:1},{opacity:0}],450);onComplete?.();
    }
    function tick(now){
      frame=0;if(!running||transitioning||document.hidden)return;
      const delta=lastTime?Math.max(0,now-lastTime):0;lastTime=now;
      if(!suspended&&(!paused||finishing)){
        if(finishing){
          finishing.time+=delta;
          const progress=Math.min(1,finishing.time/finishing.duration);
          elapsed=finishing.from+(current().duration-finishing.from)*ease(progress);
        }else if(now>=manualUntil)elapsed+=delta;
      }
      const progress=Math.min(1,elapsed/current().duration);current().onFrame?.(progress);
      if(progress===1){if(index===stages.length-1)complete();else move(index+1);return;}schedule();
    }
    function defer(ms=8000){manualUntil=performance.now()+ms;}
    function navigate(direction){
      if(!running||completed||suspended||root.classList.contains('intro-playing'))return;
      manualUntil=0;
      if(transitioning){pendingDirection=direction;return;}
      if(index+direction<0)return;
      if(index+direction>=stages.length){
        // A rolagem conclui a mesma animação final em ritmo mais rápido.
        if(!finishing){finishing={from:elapsed,time:0,duration:Math.min(700,Math.max(1,current().duration-elapsed))};lastTime=0;}
        schedule();return;
      }
      move(index+direction);
    }
    window.addEventListener('wheel',event=>{
      if(root.classList.contains('intro-playing')||event.ctrlKey||event.target.closest?.('dialog,input,textarea,select,[contenteditable]'))return;
      event.preventDefault();
      const pixels=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?main.clientHeight:1);
      const now=performance.now(),direction=Math.sign(pixels);
      if(!direction)return;
      if(now-lastWheelAt>180||direction!==wheelDirection)wheelDistance=0;
      lastWheelAt=now;wheelDirection=direction;wheelDistance+=pixels;
      if(Math.abs(wheelDistance)>=24){wheelDistance=0;navigate(direction);}
    },{passive:false});
    window.addEventListener('touchstart',event=>{
      if(root.classList.contains('intro-playing')||event.target.closest?.('dialog,input,textarea,select,[contenteditable]'))return;
      touchY=event.touches[0]?.clientY;
    },{passive:true});
    window.addEventListener('touchend',event=>{
      if(root.classList.contains('intro-playing')||event.target.closest?.('dialog,input,textarea,select,[contenteditable]')||touchY===null)return;
      const distance=touchY-(event.changedTouches[0]?.clientY??touchY);touchY=null;
      if(Math.abs(distance)>50)navigate(distance>0?1:-1);
    },{passive:true});
    window.addEventListener('keydown',event=>{
      if(root.classList.contains('intro-playing')||event.target.closest?.('button,a,input,textarea,select,dialog,[contenteditable]'))return;
      if([' ','ArrowDown','PageDown','ArrowRight'].includes(event.key)){event.preventDefault();navigate(event.shiftKey&&event.key===' '?-1:1);}
      if(['ArrowUp','PageUp','ArrowLeft'].includes(event.key)){event.preventDefault();navigate(-1);}
    });
    main.addEventListener('pointerdown',event=>{if(event.target.closest('button,input,a,select'))defer();},{passive:true});
    document.addEventListener('visibilitychange',()=>{lastTime=0;if(document.hidden){cancelAnimationFrame(frame);frame=0;}else schedule();});
    window.addEventListener('pagehide',()=>{running=false;pendingDirection=0;cancelAnimationFrame(frame);frame=0;},{once:true});
    apply(0);root.dataset.deckTransition='idle';
    return {start:()=>{running=true;lastTime=0;sync();onRunning?.(true);schedule();},defer,setSuspended:value=>{suspended=value;lastTime=0;},setPaused:value=>{paused=!!value;lastTime=0;sync();schedule();},get paused(){return paused;}};
  };
})();
