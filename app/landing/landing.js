// Apresentação em cenas, com dados e capturas reais. Aviso de SI: assistência de IA.
(() => {
  'use strict';
  const $=selector=>document.querySelector(selector),$$=selector=>[...document.querySelectorAll(selector)];
  const script=document.currentScript||document.querySelector('script[data-landing]');
  const assetRoot=script?.src?new URL('assets/',script.src).href:'';
  const assets=window.ROTARE_LANDING_ASSETS||{},asset=name=>assets[name]||assetRoot+name;
  const regional=window.ROTARE_LANDING_STATS,reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const counterFrames=new Map();
  // As rotas públicas abrem /explorar; o HTML direto abre a plataforma na mesma pasta.
  const platformURL=new URL(location.protocol==='file:'||location.pathname.endsWith('.html')?'plataforma.html':'explorar',location.href).href;
  document.querySelectorAll('.header-platform').forEach(link=>{link.href=platformURL;});
  function setupTabs(tabs, select) {
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => select(tab));
      tab.addEventListener('keydown', (event) => {
        let next;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = tabs.length - 1;
        if (next === undefined) return;
        event.preventDefault(); tabs[next].focus(); select(tabs[next]);
      });
    });
  }
  function activateTab(tabs, selected) {
    tabs.forEach((tab) => {
      const active = tab === selected;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
  }

  const layers = {
    vegetacao: { title: 'Green tells a story too.', description: 'NDVI indicates vegetation vigor. Its variation over time helps recognize crop cycles; the inferred crop must be confirmed by the farmer.', source: 'NASA MODIS · 250 m', badgeSource: 'NASA MODIS', badge: 'Vegetation seen from space', min: 'Lower vigor', max: 'Higher vigor', gradient: 'linear-gradient(90deg,#b88445,#d7c06b,#8cad62,#367d55,#163f38)', note: 'February monthly maximum. Same area every year. About 250 m resolution, without planting-row detail.' },
    solo: { title: 'The base of every next crop.', description: 'Clay content helps characterize the soil and feeds the water-retention estimate. This map is a regional estimate and can be complemented by a field soil test.', source: 'ISRIC SoilGrids 2.0 · 250 m', badgeSource: 'ISRIC SOILGRIDS', badge: 'Clay content · 0–30 cm layer', min: '0% clay', max: '70% clay', image: 'solo.webp', gradient: 'linear-gradient(90deg,#d9cb9b,#ae8e57,#8b5e34,#583a2d)', note: 'Weighted average over 0–30 cm. Spatial estimate from SoilGrids 2.0, without a lab analysis of the field. Colors use a fixed 0 to 70% clay scale.' },
    relevo: { title: 'Every slope changes the context.', description: 'Slope shows how the terrain tilts. Together with ground cover, it helps discuss runoff and erosion risk across management options.', source: 'NASA SRTM GL1 v003 · ~90 m grid', badgeSource: 'NASA SRTM', badge: 'Terrain slope', min: '0% · flattest', max: '10% or more', image: 'relevo.webp', gradient: 'linear-gradient(90deg,#283e43,#738676,#d2c68b,#e9c46a,#b16c4f)', note: 'Original 30 m SRTM aggregated to about 90 m during preparation. Slope is encoded in % in the project package; it is not a topographic survey.' }
  };
  const layerTabs = $$('.layer-tab');
  let selectedLayer = 'vegetacao';
  const yearInput = $('#ndvi-year');
  const layerImage = $('#layer-image');
  const previousLayer=new Image();previousLayer.className='layer-image-previous';previousLayer.alt='';previousLayer.setAttribute('aria-hidden','true');layerImage.before(previousLayer);
  function replayAnimation(element, className) {
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
  }
  function numberText(value,digits){return Number(value).toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits});}
  function setSignalNumber(element,value,digits){
    if(!element||element.dataset.target===String(value))return;
    const previous=Number(element.dataset.current);
    const initialized=element.dataset.current!==undefined;
    element.dataset.target=String(value);cancelAnimationFrame(counterFrames.get(element));
    if(!initialized||reducedMotion.matches){element.textContent=numberText(value,digits);element.dataset.current=String(value);return;}
    const started=performance.now();
    function animate(now){const p=Math.min(1,(now-started)/650),current=previous+(value-previous)*(1-Math.pow(1-p,3));element.textContent=numberText(current,digits);element.dataset.current=String(current);if(p<1)counterFrames.set(element,requestAnimationFrame(animate));else counterFrames.delete(element);}
    counterFrames.set(element,requestAnimationFrame(animate));
  }
  let historyPoints=[];
  if(regional){
    const values=regional.ndvi.map(item=>item.mean),low=Math.min(...values)-.025,high=Math.max(...values)+.025;
    historyPoints=regional.ndvi.map((item,i)=>({year:item.year,x:10+i*260/(regional.ndvi.length-1),y:50-(item.mean-low)/(high-low)*44}));
    const line=historyPoints.map((point,i)=>`${i?'L':'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
    $('#signal-ndvi-path').setAttribute('d',line);$('.signal-chart-area').setAttribute('d',`${line} L270,57 L10,57 Z`);
    $('#clay-gauge').style.width=`${regional.clayMean}%`;
  }
  function refreshSignals(){
    if(!regional)return;
    const year=Number(yearInput.value),snapshot=regional.ndvi.find(item=>item.year===year);
    setSignalNumber($('#signal-ndvi'),snapshot.mean,2);setSignalNumber($('#signal-clay'),regional.clayMean,1);setSignalNumber($('#signal-slope'),regional.slopeMean,1);
    $('#signal-date').textContent=`FEB ${year}`;
    const point=historyPoints.find(item=>item.year===year);
    $('.signal-chart-point').setAttribute('cx',point.x);$('.signal-chart-point').setAttribute('cy',point.y);
    $('.signal-chart-cursor').setAttribute('x1',point.x);$('.signal-chart-cursor').setAttribute('x2',point.x);
    $$('.data-signal').forEach(signal=>signal.classList.toggle('active',signal.dataset.signal===selectedLayer));
  }
  function updateLayerImage() {
    const year = yearInput.value;
    const layer = layers[selectedLayer];
    const name = selectedLayer === 'vegetacao' ? `ndvi-${year}.webp` : layer.image;
    const nextSource=asset(name);
    if(layerImage.src!==nextSource&&layerImage.complete){previousLayer.src=layerImage.src;replayAnimation(previousLayer,'is-crossfading');}
    layerImage.src = nextSource;
    layerImage.alt = selectedLayer === 'vegetacao' ? `Sorriso regional NDVI in February ${year}, derived from NASA MODIS observations.` : selectedLayer === 'solo' ? 'Regional map of estimated clay content in Sorriso, derived from SoilGrids 2.0.' : 'Regional slope map of Sorriso, derived from NASA SRTM.';
    $('#year-output').value = year;
    $('#year-output').textContent = year;
    $('#map-badge-label').textContent = selectedLayer === 'vegetacao' ? `Vegetation vigor · Feb ${year}` : layer.badge;
    replayAnimation($('.map-image-area'), 'layer-switch');
    refreshSignals();
  }
  function selectLayer(tab) {
    selectedLayer = tab.dataset.layer;
    const layer = layers[selectedLayer];
    activateTab(layerTabs, tab);
    $('#layer-details').setAttribute('aria-labelledby', tab.id);
    $('#layer-title').textContent = layer.title;
    $('#layer-description').textContent = layer.description;
    $('#layer-source').textContent = layer.source;
    $('#layer-note').textContent = layer.note;
    $('#map-badge-source').textContent = layer.badgeSource;
    $('#legend-min').textContent = layer.min;
    $('#legend-max').textContent = layer.max;
    $('#legend-gradient').style.background = layer.gradient;
    $('.year-control').hidden = selectedLayer !== 'vegetacao';
    updateLayerImage();
    replayAnimation($('.layer-panel'),'signal-refresh');
  }
  setupTabs(layerTabs, selectLayer);
  yearInput.addEventListener('input',()=>{tour?.defer(10000);updateLayerImage();});
  $('.layer-panel').addEventListener('pointerdown',()=>{tour?.defer(10000);});
  updateLayerImage();

  let motionReduced = reducedMotion.matches;
  let frame = 0;
  let stars = [];
  let lastFrame = 0;
  let visualElapsed = 0;
  let previousVisualTime = 0;
  const canvas = $('.starfield');
  const context = canvas.getContext('2d');
  const hero = $('.hero');
  const globe = window.createRotareGlobe?.($('.planet-canvas'), $('.brazil-pin'), asset('earth-day.jpg'));
  let tour;
  const story=window.createRotareStory({asset,onDialog:open=>tour?.setSuspended(open)});
  let visibleHero = true;
  let introPlaying = false;
  let width = 0, height = 0;
  function sizeStars() {
    width = hero.clientWidth; height = hero.clientHeight;
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Deterministic decorative stars; no data or telemetry is represented.
    let seed = 41;
    const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    stars = Array.from({length: Math.min(160, Math.round(width / 8))}, () => ({x:random()*width,y:random()*height,r:random()*.8+.25,a:random()*.45+.1,p:random()*6.28}));
    drawStars(0);
  }
  function drawStars(time) {
    if (!context) return;
    context.clearRect(0, 0, width, height);
    stars.forEach((star) => {
      const opacity = motionReduced ? star.a : star.a * (.65 + .35 * Math.sin(time / 1100 + star.p));
      context.fillStyle = `rgba(202,213,223,${opacity})`;
      const y = (star.y + time * .004 * (star.r + .5)) % height;
      context.beginPath(); context.arc(star.x, y, star.r, 0, Math.PI*2); context.fill();
    });
    if (!motionReduced) {
      const phase=(time%10000)/10000;
      if(phase<.12) {
        const t=phase/.12,x=width*.6+t*width*.35,y=height*.08+t*height*.19;
        const streak=context.createLinearGradient(x-65,y-28,x,y);
        streak.addColorStop(0,'#e9c46a00');streak.addColorStop(1,'#e9c46a88');
        context.strokeStyle=streak;context.lineWidth=1;context.beginPath();context.moveTo(x-65,y-28);context.lineTo(x,y);context.stroke();
      }
    }
  }
  function tick(time) {
    frame = 0;
    if (motionReduced || !visibleHero || document.hidden || introPlaying) return;
    if (previousVisualTime) visualElapsed += Math.max(0,time-previousVisualTime);
    previousVisualTime=time;
    if (time-lastFrame>33) { drawStars(visualElapsed); globe?.draw(visualElapsed); lastFrame=time; }
    frame=requestAnimationFrame(tick);
  }
  function startStars() { if (!frame && !motionReduced && visibleHero && !document.hidden && !introPlaying) frame=requestAnimationFrame(tick); }
  function updateMotionPreference() {
    motionReduced=reducedMotion.matches;previousVisualTime=0;
    if(motionReduced){cancelAnimationFrame(frame);frame=0;drawStars(visualElapsed);}else startStars();
  }
  reducedMotion.addEventListener('change',updateMotionPreference);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(frame); frame=0; previousVisualTime=0; } else startStars();
  });
  if ('ResizeObserver' in window) new ResizeObserver(sizeStars).observe(hero); else window.addEventListener('resize', sizeStars);
  sizeStars(); updateMotionPreference();


  if('IntersectionObserver'in window){
    new IntersectionObserver(([entry])=>{
      visibleHero=entry.isIntersecting;
      if(visibleHero)startStars();else{cancelAnimationFrame(frame);frame=0;previousVisualTime=0;}
    }).observe(hero);
    const stageObserver=new IntersectionObserver(entries=>entries.forEach(entry=>entry.target.classList.toggle('section-onstage',entry.isIntersecting)),{threshold:.12});
    $$('main>section').forEach(section=>stageObserver.observe(section));
  }
  const dataCycle=[['vegetacao',2015],['vegetacao',2024],['solo'],['relevo']];
  const handoffLoader=$('.handoff-loader'),handoffRing=$('.handoff-ring-progress');
  const handoffNodes=$$('.handoff-node'),handoffPercentage=$('.handoff-percentage');
  function paintHandoff(progress){
    const percent=Math.round(progress*100);
    handoffLoader.setAttribute('aria-valuenow',String(percent));
    handoffRing.setAttribute('stroke-dashoffset',String(100-percent));
    handoffPercentage.textContent=percent+'%';
    handoffNodes.forEach((node,index)=>node.classList.toggle('is-linked',progress>=.1+index*.18));
    handoffLoader.dataset.state=progress>=.88?'ready':'loading';
  }
  const stages=[
    {id:'inicio',selector:'#inicio',duration:5000},
    {id:'risco',selector:'#risco',duration:7000},
    {id:'missao',selector:'#missao',duration:5000},
    {id:'caderno',selector:'#caderno',duration:6000},
    {id:'indicadores',selector:'#exploracao',duration:5000,onEnter:()=>{
      if(!reducedMotion.matches){$$('.signal-value>strong').forEach(element=>{element.dataset.current='0';delete element.dataset.target;});refreshSignals();}
    }},
    ...dataCycle.map(([layer,year])=>({
      id:'camadas-'+(year||layer),selector:'#dados-mapa',duration:3000,
      onEnter:()=>{if(year)yearInput.value=String(year);selectLayer(layerTabs.find(tab=>tab.dataset.layer===layer));}
    })),
    ...['talhao','historico','prioridades','rotacoes'].map((id,index)=>({id,selector:'#jornada',duration:5000,onEnter:()=>story.select(index)})),
    {id:'resultado',selector:'#resultado',duration:7000},
    {id:'ciencia',selector:'#ciencia',duration:6000},
    {id:'encerramento',selector:'#encerramento',duration:3200,onFrame:paintHandoff}
  ];
  tour=window.createRotareTour({
    stages,reducedMotion,
    onRunning:running=>$('#layer-details').setAttribute('aria-live',running?'off':'polite'),
    onComplete:()=>{try{fadeTo(0,400);}catch(e){}location.assign(platformURL);}
  });
  const intro=window.createRotareIntro?.({asset,globeFactory:window.createRotareGlobe,reducedMotion:reducedMotion.matches,onActive:active=>{
    introPlaying=active;previousVisualTime=0;
    if(active){cancelAnimationFrame(frame);frame=0;}else startStars();
  }});
  function begin(){document.documentElement.classList.remove('intro-pending');tour.start();}
  if(intro)intro.finished.then(begin);else begin();

  // Trilha de fundo (Pixabay, Viacheslav Starostin). O navegador pode bloquear som automático:
  // nesse caso o primeiro clique/tecla/toque liga o som (sem pausar) e o botão de som fica sempre visível.
  const MUSIC_VOLUME=.32,MUSIC_DUCKED=.1;
  const music=new Audio(new URL('landing/assets/rotare-ambient.mp3',location.href).href);
  music.loop=true;music.preload='auto';music.volume=0;
  let soundOn=true,musicStarted=false,fadeRaf=0;
  try{if(localStorage.getItem('rotare.sound')==='off')soundOn=false;}catch(e){}
  const soundButton=document.createElement('button');
  soundButton.type='button';soundButton.className='sound-toggle';
  document.body.appendChild(soundButton);
  function fadeTo(target,ms=900){
    cancelAnimationFrame(fadeRaf);const from=music.volume,t0=performance.now();
    const step=now=>{const p=Math.min(1,(now-t0)/ms);music.volume=from+(target-from)*p*p*(3-2*p);
      if(p<1)fadeRaf=requestAnimationFrame(step);else if(target===0)music.pause();};
    fadeRaf=requestAnimationFrame(step);
  }
  function musicTarget(){return presentationPaused?MUSIC_DUCKED:MUSIC_VOLUME;}
  function renderSound(){
    const blocked=soundOn&&!musicStarted;
    soundButton.dataset.state=!soundOn?'off':blocked?'blocked':'on';
    soundButton.setAttribute('aria-pressed',String(soundOn&&musicStarted));
    soundButton.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/>${soundOn&&musicStarted?'<path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>':'<path d="m16 9 5 6m0-6-5 6"/>'}</svg><span>${!soundOn?'Sound off':blocked?'Click for sound':'Sound on'}</span>`;
    soundButton.setAttribute('aria-label',!soundOn?'Turn background music on':'Turn background music off');
  }
  function startMusic(){
    if(!soundOn||musicStarted)return Promise.resolve(musicStarted);
    return music.play().then(()=>{musicStarted=true;fadeTo(musicTarget(),2200);renderSound();return true;}).catch(()=>{renderSound();return false;});
  }
  soundButton.addEventListener('click',()=>{
    if(!soundOn||!musicStarted){soundOn=true;startMusic();}
    else{soundOn=false;musicStarted=false;fadeTo(0,500);}
    try{localStorage.setItem('rotare.sound',soundOn?'on':'off');}catch(e){}
    renderSound();
  });
  renderSound();startMusic();
  ['keydown','touchstart','pointerdown'].forEach(type=>window.addEventListener(type,event=>{
    if(event.target.closest?.('.sound-toggle'))return;startMusic();
  },{capture:true,passive:true}));
  window.addEventListener('pagehide',()=>{music.pause();});

  // Toque/clique em qualquer área livre pausa e retoma (intro e cenas). Controles continuam funcionando normalmente.
  const pauseBadge=document.createElement('div');
  pauseBadge.className='pause-badge';pauseBadge.setAttribute('role','status');pauseBadge.setAttribute('aria-live','polite');pauseBadge.hidden=true;
  pauseBadge.innerHTML='<span class="pause-icon" aria-hidden="true"><i></i><i></i></span><b>Paused</b><small>Click or tap to resume</small>';
  document.body.appendChild(pauseBadge);
  let presentationPaused=false;
  function setPresentationPaused(value){
    presentationPaused=value;
    const introPlaying=document.documentElement.classList.contains('intro-playing');
    if(introPlaying&&intro?.setPaused)intro.setPaused(value);else tour.setPaused?.(value);
    document.documentElement.classList.toggle('presentation-paused',value);
    pauseBadge.hidden=!value;
    if(musicStarted&&soundOn)fadeTo(musicTarget(),600);
  }
  intro?.finished.then(()=>{if(presentationPaused){tour.setPaused?.(true);}});
  let soundUnlockClick=false;
  window.addEventListener('pointerdown',()=>{soundUnlockClick=soundOn&&!musicStarted;},{capture:true,passive:true});
  document.addEventListener('click',event=>{
    if(event.button!==0||event.defaultPrevented)return;
    if(soundUnlockClick){soundUnlockClick=false;return;}
    if(event.target.closest('a,button,input,select,textarea,label,dialog,[role="tab"],[role="tablist"],.layer-panel,.year-control,[contenteditable]'))return;
    if(document.documentElement.dataset.presentationState==='complete')return;
    setPresentationPaused(!presentationPaused);
  });
})();
