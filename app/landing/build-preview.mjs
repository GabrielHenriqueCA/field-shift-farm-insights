// Build the public, self-contained presentation inside app/ from its source template.
// Aviso de SI: script criado com assistência de IA para Datanauts Brasil.
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (path) => readFileSync(resolve(here, path), 'utf8');
const mime = (name) => name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.jpg') ? 'image/jpeg' : 'image/webp';
const dataUrl = (name) => `data:${mime(name)};base64,${readFileSync(resolve(here, name)).toString('base64')}`;
const assets = {};
for (const name of [...Array.from({length:10},(_,i)=>`ndvi-${2015+i}.webp`),'solo.webp','relevo.webp','earth-day.jpg','sorriso-orbital.jpg',...['local','raiox','prioridades','rotacoes'].map(name=>`screen-${name}.webp`)]) assets[name]=dataUrl(`assets/${name}`);
let html = read('apresentacao.template.html')
  .replace('<html lang="pt-BR">','<html lang="pt-BR" data-standalone="true">')
  .replace(/<link\b[^>]*(?:fonts\.googleapis|fonts\.gstatic)[^>]*>/g,'')
  .replace('<link rel="stylesheet" href="landing/landing.css">',()=>`<style>\n${read('landing.css')}\n</style>`)
  .replace('<link rel="stylesheet" href="landing/cinema.css">',()=>`<style>\n${read('cinema.css')}\n</style>`)
  .replace('<link rel="stylesheet" href="landing/flight.css">',()=>`<style>\n${read('flight.css')}\n</style>`)
  .replace('<link rel="stylesheet" href="landing/story.css">',()=>`<style>\n${read('story.css')}\n</style>`)
  .replace('<link rel="stylesheet" href="landing/deck.css">',()=>`<style>\n${read('deck.css')}\n</style>`)
  .replace('<script defer src="landing/earth.js"></script>','')
  .replace('<script defer src="landing/regional-data.js"></script>','')
  .replace('<script defer src="landing/flight.js"></script>','')
  .replace('<script defer src="landing/autoplay.js"></script>','')
  .replace('<script defer src="landing/story.js"></script>','')
  .replace('<script defer src="landing/landing.js"></script>',()=>`<script>window.ROTARE_LANDING_ASSETS=${JSON.stringify(assets)};</script>`)
  .replaceAll('href="img/favicon.svg"',`href="${dataUrl('../img/favicon.svg')}"`)
  .replaceAll('src="img/rotare-simbolo.svg"',`src="${dataUrl('../img/rotare-simbolo.svg')}"`)
  .replace('src="landing/assets/earth.svg"',`src="${dataUrl('assets/earth.svg')}"`)
  .replace('src="landing/assets/ndvi-2024.webp"',`src="${assets['ndvi-2024.webp']}"`)
  .replace(/src="landing\/assets\/(screen-[^"]+)"/g,(_,name)=>`src="${assets[name]}"`)
  .replace('</body>',()=>`<script>\n${read('regional-data.js')}\n${read('earth.js')}\n${read('flight.js')}\n${read('autoplay.js')}\n${read('story.js')}\n</script>\n<script data-landing>\n${read('landing.js')}\n</script>\n</body>`);
writeFileSync(resolve(here,'../apresentacao.html'),html);
console.log('Created app/apresentacao.html: self-contained; original app logo; platform in the same folder.');
