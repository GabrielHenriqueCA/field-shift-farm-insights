// Behavioral checks for manual/automatic scene parity, input handling and the final handoff.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

class Classes {
  values=new Set();
  add(...names){names.forEach(name=>this.values.add(name));}
  remove(...names){names.forEach(name=>this.values.delete(name));}
  contains(name){return this.values.has(name);}
  toggle(name,on){if(on)this.add(name);else this.remove(name);}
}
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function harness({holdAnimations=false}={}){
  const sections=['inicio','dados-mapa','jornada','encerramento'].map(id=>({id,tagName:'SECTION',classList:new Classes(),inert:false,setAttribute(){},querySelectorAll:()=>[]}));
  const root={classList:new Classes(),dataset:{}},handlers={},callbacks=new Map(),animations=[];
  let now=0,serial=0,completed=0;const entered=[],finalFrames=[];
  const isolated=()=>assert.equal(sections.filter(node=>node.classList.contains('deck-current')).length,1);
  const main={clientHeight:700,children:sections,classList:new Classes(),addEventListener(){},animate(){
    isolated();let resolve;
    const finished=holdAnimations?new Promise(done=>{resolve=done;}):Promise.resolve();
    if(resolve)animations.push(resolve);return {finished,cancel(){}};
  }};
  const document={documentElement:root,hidden:false,querySelector:selector=>selector==='main'?main:sections.find(node=>'#'+node.id===selector),addEventListener(){}};
  const sandboxWindow={scrollTo(){},addEventListener(type,callback){handlers[type]=callback;}};
  vm.runInNewContext(readFileSync(new URL('autoplay.js',import.meta.url),'utf8'),{
    window:sandboxWindow,
    document,performance:{now:()=>now},requestAnimationFrame:callback=>{callbacks.set(++serial,callback);return serial;},cancelAnimationFrame:id=>callbacks.delete(id)
  });
  const definitions=[
    ['inicio','#inicio'],['vegetacao-2015','#dados-mapa'],['vegetacao-2024','#dados-mapa'],
    ['solo','#dados-mapa'],['relevo','#dados-mapa'],['tela-1','#jornada'],['tela-2','#jornada'],['fim','#encerramento']
  ];
  const stages=definitions.map(([id,selector])=>({id,selector,duration:id==='fim'?1000:100,
    onEnter:()=>entered.push(id),onFrame:id==='fim'?p=>finalFrames.push(p):undefined}));
  const tour=sandboxWindow.createRotareTour({stages,reducedMotion:false,onComplete:()=>completed++});
  // Obtain the factory from the sandbox without exposing test methods to the product.
  async function advance(ms){
    now+=ms;const pending=[...callbacks.values()];callbacks.clear();pending.forEach(callback=>callback(now));await flush();isolated();
  }
  const target={closest:()=>false};
  const wheel=(deltaY=100,extra={})=>handlers.wheel({ctrlKey:false,target,preventDefault(){},deltaY,deltaMode:0,...extra});
  const key=(key,shiftKey=false)=>handlers.keydown({target,key,shiftKey,preventDefault(){}});
  return {root,tour,entered,finalFrames,handlers,animations,wheel,key,target,advance,flush,isolated,get completed(){return completed;}};
}

const expected=['inicio','vegetacao-2015','vegetacao-2024','solo','relevo','tela-1','tela-2','fim'];
const automatic=harness();automatic.tour.start();await automatic.advance(1);
for(let guard=0;!automatic.completed&&guard<30;guard++)await automatic.advance(1001);
assert.deepEqual(automatic.entered,expected);assert.equal(automatic.completed,1);
await automatic.advance(2000);assert.equal(automatic.completed,1);

const manual=harness();manual.tour.start();await manual.advance(1);
assert.equal(typeof manual.tour.setPaused,'function','Click-to-pause is available.');
{const paused=harness();paused.tour.start();await paused.advance(1);paused.tour.setPaused(true);
 for(let i=0;i<5;i++)await paused.advance(500);
 assert.equal(paused.root.dataset.deckScene,'inicio','A paused presentation does not advance on its own.');
 assert.equal(paused.root.dataset.presentationState,'paused');
 paused.tour.setPaused(false);for(let i=0;i<3;i++)await paused.advance(101);
 assert.notEqual(paused.root.dataset.deckScene,'inicio','Resuming continues the timer.');}
manual.tour.defer(8000);
for(const delta of [3,7,8,8])manual.wheel(delta);
await manual.flush();assert.equal(manual.root.dataset.deckScene,'vegetacao-2015','Trackpad deltas advance without waiting for the timer.');
manual.wheel(100,{target:{closest:()=>true}});await manual.flush();assert.equal(manual.entered.length,2,'Controls retain native input.');
manual.key(' ');await manual.flush();assert.equal(manual.root.dataset.deckScene,'vegetacao-2024','Space advances instead of pausing.');
for(let i=0;i<5;i++){manual.wheel();await manual.flush();}
assert.equal(manual.root.dataset.deckScene,'fim');assert.equal(manual.completed,0);
manual.wheel();await manual.advance(1);await manual.advance(350);
assert.equal(manual.completed,0,'Manual navigation still plays the final loading animation.');
assert.ok(manual.finalFrames.at(-1)>0&&manual.finalFrames.at(-1)<1);
manual.wheel();await manual.advance(351);assert.equal(manual.completed,1,'Continued scrolling does not restart the loading clock.');assert.equal(manual.finalFrames.at(-1),1);
assert.deepEqual(manual.entered,automatic.entered,'Manual and automatic navigation execute the same data-layer and screen sequence.');

const queued=harness({holdAnimations:true});queued.tour.start();await queued.advance(1);
queued.wheel();queued.wheel();
for(let i=0;i<4;i++){assert.ok(queued.animations.length);queued.animations.shift()();await queued.flush();queued.isolated();}
assert.deepEqual(queued.entered,expected.slice(0,3),'A gesture during a transition is remembered, without overlapping sections.');

const touch=harness();touch.tour.start();
touch.handlers.touchstart({target:touch.target,touches:[{clientY:500}]});
touch.handlers.touchend({target:touch.target,changedTouches:[{clientY:100}]});
await touch.flush();assert.equal(touch.root.dataset.deckScene,'vegetacao-2015');
touch.key(' ',true);await touch.flush();assert.equal(touch.root.dataset.deckScene,'inicio');
touch.tour.setSuspended(true);await touch.advance(1000);touch.wheel();await touch.flush();
assert.equal(touch.root.dataset.deckScene,'inicio','An enlarged screenshot keeps its own scrolling.');
touch.tour.setSuspended(false);touch.wheel();await touch.flush();assert.equal(touch.root.dataset.deckScene,'vegetacao-2015');

const html=readFileSync(new URL('../apresentacao.html',import.meta.url),'utf8');
assert.ok(!html.includes('flight-skip'));assert.ok(!html.includes('motion-toggle'));assert.ok(!html.includes('Pressione Espaço para pausar'));
// Folder entry works on plain static hosts, without relying on Vercel rewrites.
assert.ok(html.includes('class="header-platform"'));
for(const name of ['landing','story','flight'])new vm.Script(readFileSync(new URL(name+'.js',import.meta.url),'utf8'));

const entry=readFileSync(new URL('../index.html',import.meta.url),'utf8');
assert.ok(!entry.includes('id="mapa"'),'index.html must open the presentation before the platform');
assert.ok(entry.includes('content="0;url=apresentacao.html"'),'The folder entry also redirects without JavaScript');
const platform=readFileSync(new URL('../plataforma.html',import.meta.url),'utf8');
assert.ok(platform.includes('id="mapa"'),'plataforma.html contains the actual platform');
assert.ok(platform.includes('href="apresentacao.html"'),'platform links back to the presentation');
const entryScript=entry.match(/<script>([\s\S]*?)<\/script>/)[1];
for(const [href,expected] of [
  ['http://127.0.0.1:5500/app/','http://127.0.0.1:5500/app/apresentacao.html'],
  ['http://localhost/app/index.html?source=nav#inicio','http://localhost/app/apresentacao.html?source=nav#inicio'],
  ['http://localhost/','http://localhost/apresentacao.html'],
  ['file:///C:/project/app/index.html','file:///C:/project/app/apresentacao.html']
]){
  let redirected;const url=new URL(href);
  vm.runInNewContext(entryScript,{URL,window:{location:{href,search:url.search,hash:url.hash,replace:value=>{redirected=value;}}}});
  assert.equal(redirected,expected);
}
const landing=readFileSync(new URL('landing.js',import.meta.url),'utf8');
const routing=landing.match(/  const platformURL=.*?;/)[0];
for(const [href,expected] of [
  ['http://127.0.0.1:5500/app/apresentacao.html','http://127.0.0.1:5500/app/plataforma.html'],
  ['http://localhost/app/apresentacao.html','http://localhost/app/plataforma.html'],
  ['http://localhost/apresentacao.html','http://localhost/plataforma.html'],
  ['http://localhost/apresentacao','http://localhost/explorar'],
  ['https://rotare.vercel.app/','https://rotare.vercel.app/explorar'],
  ['https://rotare.vercel.app/?utm_source=spaceapps#inicio','https://rotare.vercel.app/explorar'],
  ['https://rotare.vercel.app/apresentacao','https://rotare.vercel.app/explorar'],
  ['https://example.org/','https://example.org/explorar'],
  ['file:///C:/project/app/apresentacao.html','file:///C:/project/app/plataforma.html']
]){
  const url=new URL(href),context={URL,location:{href,pathname:url.pathname,protocol:url.protocol}};
  vm.runInNewContext(routing+'\nresult=platformURL;',context);
  assert.equal(context.result,expected);
}
for(const path of ['../vercel.json','../../vercel.json']){
  const config=JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
  const rewrites=config.rewrites;
  assert.ok(Object.hasOwn(config,'framework'),'Explicitly select Other instead of Python framework auto-detection.');
  assert.equal(config.framework,null);
  assert.equal(config.outputDirectory,'.');
  assert.equal(config.buildCommand,path==='../vercel.json'?'node landing/build-preview.mjs':'node app/landing/build-preview.mjs');
  assert.equal(config.cleanUrls,false,'Explicit HTML destinations must not redirect back to the presentation root.');
  assert.equal(config.trailingSlash,false,'Public routes keep relative assets at the app root.');
  assert.ok(rewrites.find(route=>route.source==='/explorar').destination.endsWith('/plataforma.html'));
  assert.ok(rewrites.find(route=>route.source==='/').destination.endsWith('/apresentacao.html'));
  assert.ok(rewrites.find(route=>route.source==='/apresentacao').destination.endsWith('/apresentacao.html'));
}
console.log('PASS: manual/automatic scene parity, trackpad, touch, queued gestures, final animation, click-to-pause and entry/platform routes.');
