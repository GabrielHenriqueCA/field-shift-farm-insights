// Abertura em primeira pessoa: corredor, observação orbital e aproximação de Sorriso.
// Aviso de SI: implementação original criada com assistência de IA para Datanauts Brasil.
(() => {
  'use strict';
  window.createRotareIntro=({asset,globeFactory,reducedMotion,onActive})=>{
    const scene=document.querySelector('.flight-intro');
    if(!scene||reducedMotion||location.hash)return {finished:Promise.resolve()};
    const root=document.documentElement;
    const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
    const stars=scene.querySelector('.flight-stars'),ctx=stars.getContext('2d');
    const earthCanvas=scene.querySelector('.flight-earth-canvas');
    const globe=globeFactory?.(earthCanvas,null,asset('earth-day.jpg'));
    if(!ctx||!globe)return {finished:Promise.resolve()};
    const copy=scene.querySelector('.flight-copy');
    const heading=scene.querySelector('.flight-title'),subtitle=scene.querySelector('.flight-subtitle'),eyebrow=scene.querySelector('.flight-eyebrow');
    const ground=scene.querySelector('.flight-ground-image'),credit=scene.querySelector('.flight-credit');
    const stats=window.ROTARE_LANDING_STATS;
    const number=(value,digits=1)=>Number(value).toLocaleString('pt-BR',{minimumFractionDigits:digits,maximumFractionDigits:digits});
    if(stats){scene.querySelector('.flight-ndvi').textContent=number(stats.ndvi.find(item=>item.year===2024).mean,2);scene.querySelector('.flight-clay').textContent=number(stats.clayMean)+'%';scene.querySelector('.flight-slope').textContent=number(stats.slopeMean)+'%';}
    const background=[...document.querySelectorAll('.site-header,main,.site-footer,.skip-link')];
    const previousInert=background.map(element=>element.inert);
    let resolveFinished;const finished=new Promise(resolve=>{resolveFinished=resolve;});
    let elapsed=0,previousTime=0,lastPaint=0,raf=0,ended=false,width=1,height=1,currentPhase=-1;
    let scrub=null,queuedDirection=0,touchY=null,wheelDistance=0,lastWheelAt=0,wheelDirection=0;
    let active=true,disposeTimer=0;
    const clamp=x=>Math.max(0,Math.min(1,x)),mix=(a,b,t)=>a+(b-a)*t;
    const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
    const segment=(t,a,b)=>smooth((t-a)/(b-a));
    const phases=[
      {start:0,end:5,scene:'preparacao',label:'DATANAUTS BRASIL · TERRA + ÓRBITA',title:'A próxima safra começa com outro olhar.',text:'Uma viagem do espaço ao que importa no seu talhão.'},
      {start:5,end:14,scene:'orbita',label:'OBSERVAÇÃO DA TERRA',title:'Um planeta. Muitas possibilidades.',text:'Clima, solo e vegetação contam partes da mesma história.'},
      {start:14,end:20,scene:'aproximacao',label:'DO ESPAÇO AO CAMPO',title:'Vamos olhar mais de perto.',text:'Nossa viagem encontra o Cerrado. E se aproxima da sua próxima decisão.'},
      {start:20,end:27,scene:'sorriso',label:'SORRISO · MATO GROSSO',title:'Cada talhão tem um futuro a cultivar.',text:'Explore o histórico. Compare rotações. Decida o próximo passo com o Rotare.'}
    ];
    let seed=793;
    const random=()=>{seed=(seed*16807)%2147483647;return (seed-1)/2147483646;};
    const particles=Array.from({length:230},()=>({x:(random()-.5)*2,y:(random()-.5)*2,z:random()*.9+.1,size:random()*.7+.3}));
    function size(){
      width=innerWidth;height=innerHeight;
      const ratio=Math.min(devicePixelRatio||1,1.5);
      stars.width=Math.round(width*ratio);stars.height=Math.round(height*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);
      globe.resize();
    }
    function drawStars(dt,time){
      ctx.clearRect(0,0,width,height);
      const boost=segment(time,5.1,7.6)*(1-segment(time,10,14));
      const velocity=.045+boost*.8;
      for(const star of particles){
        star.z-=dt*velocity;
        if(star.z<.05){star.z=1;star.x=(random()-.5)*2;star.y=(random()-.5)*2;}
        const x=width*.5+star.x/star.z*width*.6,y=height*.42+star.y/star.z*height*.6;
        const oldZ=star.z+velocity*(.008+boost*.04);
        const px=width*.5+star.x/oldZ*width*.6,py=height*.42+star.y/oldZ*height*.6;
        ctx.strokeStyle=`rgba(204,218,233,${(.12+.48*(1-star.z))*(1-segment(time,19,21))})`;
        ctx.lineWidth=star.size;ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(x,y);ctx.stroke();
      }
    }
    function set(name,value){scene.style.setProperty(name,String(value));}
    function paint(time,dt){
      drawStars(dt,time);
      const depart=segment(time,3.8,6.1),orbit=segment(time,5,13.5),dive=segment(time,14,20.5),groundView=segment(time,19.5,21.5);
      set('--camera-z',`${mix(-220,1350,segment(time,0,5.8))}px`);
      set('--corridor-opacity',1-depart);
      set('--earth-opacity',segment(time,.4,3.2)*(1-segment(time,20.3,21.8)));
      set('--earth-scale',mix(.38,1.12,orbit)+dive*5.1);
      set('--earth-x',`${mix(13,3,orbit)*(1-dive)}vw`);
      set('--earth-y',`${mix(-6,-10,orbit)*(1-dive)}vh`);
      set('--earth-roll',`${mix(-16,-3,orbit)*(1-dive)}deg`);
      set('--cockpit-opacity',segment(time,4.5,6.8)*(1-segment(time,11,14.5)));
      set('--cockpit-scale',mix(1.1,1,segment(time,5,9)));
      set('--ground-opacity',groundView);
      set('--ground-scale',mix(1.55,1.08,segment(time,20,27)));
      set('--ground-tilt',`${mix(32,0,segment(time,19.5,24))}deg`);
      set('--location-opacity',segment(time,22,24));
      set('--sun-opacity',mix(.25,.75,orbit)*(1-groundView));
      globe.setView?.({longitude:mix(mix(-88,-48,orbit),-55.95,dive),latitude:mix(mix(15,-7,orbit),-12.6,dive)});
      globe.draw(time*1000);
      let index=phases.findIndex(phase=>time>=phase.start&&time<phase.end);if(index<0)index=phases.length-1;
      const phase=phases[index];
      if(currentPhase!==index){
        currentPhase=index;scene.dataset.scene=phase.scene;root.dataset.introScene=phase.scene;
        eyebrow.textContent=phase.label;heading.textContent=phase.title;
        credit.hidden=index!==3;
      }
      const local=time-phase.start,duration=phase.end-phase.start;
      const alpha=segment(local,0,.65)*(1-segment(local,duration-.42,duration));
      set('--copy-opacity',alpha);set('--copy-y',`${(1-alpha)*18}px`);set('--copy-blur',`${(1-alpha)*3}px`);
      const length=Math.min(phase.text.length,Math.max(0,Math.floor((local-.35)*43)));
      const text=phase.text.slice(0,length);if(subtitle.textContent!==text)subtitle.textContent=text;
      scene.dataset.elapsed=time.toFixed(2);
    }
    function schedule(){if(active&&!document.hidden&&!raf)raf=requestAnimationFrame(tick);}
    function tick(now){
      raf=0;if(!active||document.hidden)return;
      const delta=previousTime?Math.max(0,now-previousTime):0;previousTime=now;
      if(scrub){
        scrub.time+=delta;const progress=clamp(scrub.time/scrub.duration);
        elapsed=mix(scrub.from,scrub.to,smooth(progress));
        if(progress===1){scrub=null;if(queuedDirection&&elapsed<27000){const direction=queuedDirection;queuedDirection=0;seekPhase(direction);}else queuedDirection=0;}
      }else elapsed+=delta;
      if(now-lastPaint>=32){paint(elapsed/1000,Math.min((now-lastPaint)/1000,.1));lastPaint=now;}
      if(elapsed>=27000){finish();return;}
      if(elapsed>6500&&globe.ready===false){finish();return;}
      schedule();
    }
    function finish(){
      if(ended)return;ended=true;active=false;cancelAnimationFrame(raf);raf=0;
      root.dataset.introState='handoff';
      function commit(){
        root.classList.remove('intro-playing','intro-handoff');root.classList.add('intro-complete');root.dataset.introState='complete';
        background.forEach((element,i)=>{element.inert=previousInert[i];});
        scene.hidden=true;globe.dispose?.();cleanup();onActive?.(false);resolveFinished({startAt:'#inicio'});
      }
      window.scrollTo({top:0,behavior:'instant'});
      document.querySelector('.orbital-scene').style.setProperty('--scene-drift','0px');
      root.classList.add('intro-handoff');scene.classList.add('is-exiting');
      disposeTimer=setTimeout(commit,950);
    }
    function seekPhase(direction){
      if(!active)return;
      if(scrub){queuedDirection=direction;return;}
      const phaseIndex=Math.max(0,phases.findIndex(phase=>elapsed/1000>=phase.start&&elapsed/1000<phase.end));
      const next=phaseIndex+direction,to=next<0?0:next>=phases.length?27000:phases[next].start*1000+750;
      scrub={from:elapsed,to,time:0,duration:Math.min(850,400+Math.abs(to-elapsed)*.025)};schedule();
    }
    function keydown(event){
      if(!active||event.target.closest?.('button,a,input,select,[contenteditable]'))return;
      let direction=0;
      if([' ','ArrowDown','PageDown','ArrowRight'].includes(event.key))direction=event.shiftKey&&event.key===' '?-1:1;
      if(['ArrowUp','PageUp','ArrowLeft'].includes(event.key))direction=-1;
      if(direction){event.preventDefault();event.stopPropagation();seekPhase(direction);}
    }
    function wheel(event){
      if(!active||event.ctrlKey)return;
      event.preventDefault();event.stopPropagation();
      const pixels=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?innerHeight:1);
      const now=performance.now(),direction=Math.sign(pixels);if(!direction)return;
      if(now-lastWheelAt>180||direction!==wheelDirection)wheelDistance=0;
      wheelDistance+=pixels;lastWheelAt=now;wheelDirection=direction;
      if(Math.abs(wheelDistance)>=24){wheelDistance=0;seekPhase(direction);}
    }
    function touchstart(event){if(!active)return;touchY=event.touches[0]?.clientY;event.stopPropagation();}
    function touchend(event){
      if(!active||touchY===null)return;
      const distance=touchY-(event.changedTouches[0]?.clientY??touchY);touchY=null;event.stopPropagation();
      if(Math.abs(distance)>50)seekPhase(distance>0?1:-1);
    }
    function visibility(){previousTime=0;if(document.hidden){cancelAnimationFrame(raf);raf=0;}else schedule();}
    function pagehide(){active=false;cancelAnimationFrame(raf);clearTimeout(disposeTimer);globe.dispose?.();cleanup();}
    function preferenceChanged(event){if(event.matches)finish();}
    function cleanup(){window.removeEventListener('resize',size);window.removeEventListener('keydown',keydown,true);window.removeEventListener('wheel',wheel,true);window.removeEventListener('touchstart',touchstart,true);window.removeEventListener('touchend',touchend,true);window.removeEventListener('pagehide',pagehide);document.removeEventListener('visibilitychange',visibility);motionPreference.removeEventListener('change',preferenceChanged);}
    scene.hidden=false;ground.src=asset('sorriso-orbital.jpg');
    if('scrollRestoration'in history)history.scrollRestoration='manual';
    window.scrollTo({top:0,behavior:'instant'});
    background.forEach(element=>{element.inert=true;});root.classList.add('intro-playing');root.classList.remove('intro-pending');root.dataset.introState='playing';
    onActive?.(true);size();paint(0,0);
    window.addEventListener('resize',size);window.addEventListener('keydown',keydown,true);window.addEventListener('wheel',wheel,{capture:true,passive:false});window.addEventListener('touchstart',touchstart,{capture:true,passive:true});window.addEventListener('touchend',touchend,{capture:true,passive:true});window.addEventListener('pagehide',pagehide);document.addEventListener('visibilitychange',visibility);motionPreference.addEventListener('change',preferenceChanged);
    schedule();return {finished};
  };
})();
