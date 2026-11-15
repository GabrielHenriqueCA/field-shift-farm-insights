// Apresentação em cenas, com dados e capturas reais. Aviso de SI: assistência de IA.
(() => {
  'use strict';
  const $=selector=>document.querySelector(selector),$$=selector=>[...document.querySelectorAll(selector)];
  const script=document.currentScript||document.querySelector('script[data-landing]');
  const assetRoot=script?.src?new URL('assets/',script.src).href:'';
  const assets=window.ROTARE_LANDING_ASSETS||{},asset=name=>assets[name]||assetRoot+name;
  const regional=window.ROTARE_LANDING_STATS,reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const counterFrames=new Map();
  // A plataforma é o index.html da mesma pasta ("./" em servidor, arquivo explícito em file://).
  const platformURL=new URL(location.protocol==='file:'?'index.html':'./',location.href).href;
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
    vegetacao: { title: 'O verde também conta histórias.', description: 'O NDVI indica o vigor da vegetação. A variação ao longo do tempo ajuda a reconhecer ciclos de cultivo; a cultura inferida precisa ser confirmada pelo agricultor.', source: 'NASA MODIS · 250 m', badgeSource: 'NASA MODIS', badge: 'Vegetação vista do espaço', min: 'Menor vigor', max: 'Maior vigor', gradient: 'linear-gradient(90deg,#b88445,#d7c06b,#8cad62,#367d55,#163f38)', note: 'Máximo mensal de fevereiro. Mesma área em todos os anos. Resolução de aproximadamente 250 m, sem detalhe de linhas de plantio.' },
    solo: { title: 'A base de toda próxima safra.', description: 'A proporção de argila ajuda a caracterizar o solo e entra na estimativa de retenção de água. Este mapa é uma estimativa regional e pode ser complementado por um laudo de campo.', source: 'ISRIC SoilGrids 2.0 · 250 m', badgeSource: 'ISRIC SOILGRIDS', badge: 'Teor de argila · camada de 0–30 cm', min: '0% de argila', max: '70% de argila', image: 'solo.webp', gradient: 'linear-gradient(90deg,#d9cb9b,#ae8e57,#8b5e34,#583a2d)', note: 'Média ponderada de 0–30 cm. Estimativa espacial do SoilGrids 2.0, sem análise laboratorial do talhão. As cores usam uma escala fixa de 0 a 70% de argila.' },
    relevo: { title: 'Cada inclinação muda o contexto.', description: 'A declividade mostra como o terreno se inclina. Com a cobertura do solo, ela ajuda a discutir escoamento e suscetibilidade à erosão nas alternativas de manejo.', source: 'NASA SRTM GL1 v003 · grade de ~90 m', badgeSource: 'NASA SRTM', badge: 'Declividade do terreno', min: '0% · mais plano', max: '10% ou mais', image: 'relevo.webp', gradient: 'linear-gradient(90deg,#283e43,#738676,#d2c68b,#e9c46a,#b16c4f)', note: 'SRTM original de 30 m agregado na preparação para aproximadamente 90 m. A declividade é codificada em % no pacote do projeto; não equivale a um levantamento topográfico.' }
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
  function numberText(value,digits){return Number(value).toLocaleString('pt-BR',{minimumFractionDigits:digits,maximumFractionDigits:digits});}
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
    $('#signal-date').textContent=`FEV. ${year}`;
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
    layerImage.alt = selectedLayer === 'vegetacao' ? `NDVI regional de Sorriso em fevereiro de ${year}, derivado de observações NASA MODIS.` : selectedLayer === 'solo' ? 'Mapa regional da proporção estimada de argila em Sorriso, derivado do SoilGrids 2.0.' : 'Mapa regional da declividade de Sorriso, derivado do NASA SRTM.';
    $('#year-output').value = year;
    $('#year-output').textContent = year;
    $('#map-badge-label').textContent = selectedLayer === 'vegetacao' ? `Vigor da vegetação · fev. ${year}` : layer.badge;
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
    {id:'missao',selector:'#missao',duration:5000},
    {id:'indicadores',selector:'#exploracao',duration:5000,onEnter:()=>{
      if(!reducedMotion.matches){$$('.signal-value>strong').forEach(element=>{element.dataset.current='0';delete element.dataset.target;});refreshSignals();}
    }},
    ...dataCycle.map(([layer,year])=>({
      id:'camadas-'+(year||layer),selector:'#dados-mapa',duration:3000,
      onEnter:()=>{if(year)yearInput.value=String(year);selectLayer(layerTabs.find(tab=>tab.dataset.layer===layer));}
    })),
    ...['talhao','historico','prioridades','rotacoes'].map((id,index)=>({id,selector:'#jornada',duration:5000,onEnter:()=>story.select(index)})),
    {id:'ciencia',selector:'#ciencia',duration:6000},
    {id:'encerramento',selector:'#encerramento',duration:3200,onFrame:paintHandoff}
  ];
  tour=window.createRotareTour({
    stages,reducedMotion,
    onRunning:running=>$('#layer-details').setAttribute('aria-live',running?'off':'polite'),
    onComplete:()=>location.assign(platformURL)
  });
  const intro=window.createRotareIntro?.({asset,globeFactory:window.createRotareGlobe,reducedMotion:reducedMotion.matches,onActive:active=>{
    introPlaying=active;previousVisualTime=0;
    if(active){cancelAnimationFrame(frame);frame=0;}else startStars();
  }});
  function begin(){document.documentElement.classList.remove('intro-pending');tour.start();}
  if(intro)intro.finished.then(begin);else begin();
})();
