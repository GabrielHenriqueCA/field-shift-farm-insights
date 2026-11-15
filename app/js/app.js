// Aviso de SI: arquivo escrito com ajuda de IA (Claude), sob direção do time Datanauts Brasil.
// Jornada: coordenada → fazenda no satélite → talhão → Raio-X → preferências → rotações → simulação → mapa.
(function (R) {
  "use strict";
  const { CULTURAS, SEGUNDA_SAFRA } = R.catalogo;
  const C_PADRAO = globalThis.ROTARE_CLIMA, T = globalThis.ROTARE_TALHOES || [];
  let C = C_PADRAO;          // troca para o pacote ao vivo quando o talhão está fora da região pré-processada
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const fmt = (x, d = 0) => (x === null || x === undefined || Number.isNaN(x) ? "–" : x.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const pct = (x, d = 0) => `${fmt(x * 100, d)}%`;
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ICO = R.icones;

  const PASSOS = [
    { id: "local", nome: "Local" }, { id: "talhao", nome: "Talhão" }, { id: "raiox", nome: "Raio-X" },
    { id: "prefs", nome: "Preferências" }, { id: "rotacoes", nome: "Rotações" }, { id: "mapa", nome: "Mapa" },
  ];
  const S = {
    passo: "local", alcancado: new Set(["local", "talhao"]),
    anel: [], met: null, cob: null, demo: null, local: null,
    raiox: null, safras: null, atual: null, atualConfirmada: false,
    prefs: { pesos: { solo: 50, risco: 50, agua: 50, renda: 50 }, irrigado: false,
             maquinario: new Set(Object.keys(CULTURAS)), excluir: new Set(), texto: "" },
    cen: { chuva: 0, temp: 0, elNino: false }, res: null, fixas: null, posRef: {}, sel: null, mesNdvi: null,
    camadas: { esri: true, nasa: false, limites: true, ndvi: false, declividade: false, risco: false, atencao: false },
    gibsData: "2026-08-03", servidor: null, aoVivo: false, imagensLive: null, forcar: false, modo: null,
  };
  S.camadas.uso = false;

  let map, editor;

  // ===================================================================== início
  function iniciar() {
    map = R.mapa.criarMapa("mapa");
    map.on("load", () => {
      R.mapa.instalarCamadas(map);
      editor = new R.EditorTalhao(map, { onChange: aoMudarTalhao });
      map.getSource("demos").setData({ type: "FeatureCollection", features: T.map((t) => ({ type: "Feature", properties: { id: t.id, nome: t.nome }, geometry: { type: "Polygon", coordinates: [t.geometria] } })) });
      map.on("click", "demos-fill", (e) => { if (S.passo === "local" || (S.passo === "talhao" && !S.anel.length)) carregarDemo(e.features[0].properties.id); });
      map.on("mouseenter", "demos-fill", () => { if (S.passo === "local") map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "demos-fill", () => { if (S.passo === "local") map.getCanvas().style.cursor = ""; });
      map.on("click", "ed-fill", (e) => { if (S.res && editor.modo !== "editar") popupTalhao(e.lngLat); });
      instalarMenuContexto();
      renderCamadas();
    });
    $("#btn-como").onclick = () => modal(comoCalculamos());
    $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal" || e.target.closest(".fechar")) fecharModal(); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") fecharModal();
      if (S.passo !== "talhao" || !editor) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? editor.refazer() : editor.desfazer(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); editor.refazer(); }
      if (e.key === "Enter" && editor.modo === "poligono") editor.fechar();
    });
    if (window.innerWidth < 860) $("#camadas").classList.add("recolhida");
    // ao girar o celular ou estreitar a janela, o painel de camadas recolhe para não cobrir o conteúdo
    matchMedia("(max-width: 859px)").addEventListener("change", (ev) => { if (ev.matches) { $("#camadas").classList.add("recolhida"); renderCamadas(); } });
    fetch("api/status").then((r) => r.json()).then((j) => { S.servidor = !!j.earth_engine; })
      .catch(() => { S.servidor = false; }).finally(() => { if (S.passo === "talhao") atualizarTalhao(); });
    irPara("local");
  }

  // ===================================================================== navegação
  function renderPassos() {
    $("#passos").innerHTML = PASSOS.map((p, i) => {
      const atual = p.id === S.passo, feito = S.alcancado.has(p.id) && !atual && PASSOS.findIndex((x) => x.id === S.passo) > i;
      return `<button type="button" data-p="${p.id}" class="${atual ? "ativo" : ""} ${feito ? "feito" : ""}" ${S.alcancado.has(p.id) ? "" : "disabled"}><i>${feito ? "✓" : i + 1}</i><span>${p.nome}</span></button>`;
    }).join("");
    $$("#passos button").forEach((b) => (b.onclick = () => irPara(b.dataset.p)));
  }
  function irPara(passo) {
    S.passo = passo; S.alcancado.add(passo);
    const painel = $("#painel");
    painel.className = "painel " + ({ raiox: "medio", rotacoes: "largo" }[passo] || "");
    $("#ferramentas").classList.toggle("oculto", passo !== "talhao");
    $("#dica-mapa").classList.toggle("oculto", passo !== "talhao");
    $("#painel-rodape").classList.add("oculto");
    if (editor) editor.travar(passo !== "talhao");
    if (map && map.getLayer("demos")) { R.mapa.mostrar(map, "demos", passo === "local" || passo === "talhao"); R.mapa.mostrar(map, "demos-fill", passo === "local" || passo === "talhao"); }
    const corpo = $("#painel-corpo");
    corpo.scrollTop = 0;
    ({ local: renderLocal, talhao: renderTalhao, raiox: renderRaiox, prefs: renderPrefs, rotacoes: renderRotacoes, mapa: renderMapa }[passo])();
    renderPassos(); renderCamadas();
    $("#camadas").classList.toggle("oculto", passo === "rotacoes");
    if (["raiox", "mapa", "prefs"].includes(passo) && S.met) enquadrar();
  }
  function rodape(html) { const r = $("#painel-rodape"); r.innerHTML = html; r.classList.remove("oculto"); }
  function enquadrar() {
    const largura = $("#painel").getBoundingClientRect().width;
    const movel = window.innerWidth < 860;
    const pad = movel ? { top: 70, bottom: window.innerHeight * 0.62 + 20, left: 30, right: 30 }
      : { top: 90, bottom: 60, left: Math.min(largura + 50, window.innerWidth - 300), right: 290 };
    try { map.fitBounds(S.met.bbox, { padding: pad, duration: 1200, maxZoom: 15.5 }); } catch (e) { /* tela pequena demais */ }
  }
  function toast(t, ms = 2600) { const el = $("#toast"); el.textContent = t; el.classList.add("on"); clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove("on"), ms); }
  function modal(html) { const m = $("#modal"); m.innerHTML = `<div class="modal-caixa"><button class="fechar" aria-label="Fechar">×</button>${html}</div>`; m.classList.remove("oculto"); }
  function fecharModal() { $("#modal").classList.add("oculto"); }

  // ===================================================================== 1. local
  function renderLocal() {
    const G = R.zonal.regiao();
    $("#painel-corpo").innerHTML = `<section>
      <div class="sobre">Etapa 1 · Localização</div>
      <h2>Sua fazenda vista do espaço</h2>
      <p class="lead">Informe onde está a propriedade. O Rotare aproxima o satélite até ela para você delimitar o talhão.</p>
      <div class="busca"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
        <input class="campo" id="busca" placeholder="Município, fazenda ou “-12.62, -55.97”" autocomplete="off"></div>
      <div class="sugestoes oculto" id="sugestoes"></div>
      <div class="rotulo">Ou digite as coordenadas (graus decimais, WGS84)</div>
      <div class="linha-campos">
        <input class="campo num" id="lat" type="number" step="0.0001" placeholder="Latitude" value="-12.6000">
        <input class="campo num" id="lon" type="number" step="0.0001" placeholder="Longitude" value="-55.9500">
        <button class="btn ouro" id="ir" type="button">Ir</button>
      </div>
      <div class="rotulo">Propriedades de demonstração <span class="chip ceu">dados reais pré-processados</span></div>
      <div class="demos">${T.map((t) => {
        const img = t.imagens && t.imagens.itens.find((x) => x.ano === 2023 && x.fase === "soja" && x.arquivo);
        const ha = R.geo.metricas(t.geometria.slice(0, -1)).areaHa;
        return `<button class="demo" type="button" data-demo="${t.id}">${img ? `<img src="data/${img.arquivo}" alt="">` : "<img alt=''>"}
          <div><b>${esc(t.nome)}</b><small>${esc(t.fazenda)} · Sorriso, MT</small><div style="margin-top:5px;display:flex;gap:4px"><span class="chip num">${fmt(ha, 0)} ha</span>${t.irrigado ? '<span class="chip ceu">irrigado</span>' : ""}</div></div>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" opacity=".5"><path d="M9 6l6 6-6 6"/></svg></button>`;
      }).join("")}</div>
      <div class="aviso">Na região de demonstração ${G ? `(${esc(R.zonal.regiaoPadrao().nome)}, retângulo tracejado azul)` : ""} os dados já estão prontos. Em qualquer outro lugar, o Rotare busca ao vivo NDVI, solo, relevo, uso do solo, chuva e temperatura para o seu talhão (cerca de 20 s na primeira vez).</div>
      <div class="aviso dica-ctx"><b>Dica:</b> clique com o botão direito em qualquer ponto do mapa (ou toque longo no celular) para marcar um talhão de 25, 100 ou 400 ha ali, ou começar a desenhar a partir dele.</div>
    </section>`;
    $("#ir").onclick = () => irParaCoordenada(+$("#lat").value, +$("#lon").value);
    $$("[data-demo]").forEach((b) => (b.onclick = () => carregarDemo(b.dataset.demo)));
    const busca = $("#busca");
    let t0;
    busca.addEventListener("input", () => { clearTimeout(t0); t0 = setTimeout(() => buscar(busca.value), 450); });
    busca.addEventListener("keydown", (e) => { if (e.key === "Enter") { clearTimeout(t0); buscar(busca.value, true); } });
  }

  async function buscar(q, imediato) {
    const box = $("#sugestoes");
    q = q.trim();
    if (q.length < 3) { box.classList.add("oculto"); return; }
    const m = q.match(/^\s*(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)\s*$/);
    if (m) {
      const lat = +m[1].replace(",", "."), lon = +m[2].replace(",", ".");
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) { box.classList.add("oculto"); $("#lat").value = lat; $("#lon").value = lon; if (imediato) irParaCoordenada(lat, lon); return; }
    }
    const demos = T.filter((t) => (t.nome + " " + t.fazenda).toLowerCase().includes(q.toLowerCase()))
      .map((t) => ({ nome: `${t.nome} · ${t.fazenda}`, demo: t.id }));
    let lugares = [];
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&accept-language=pt-BR&q=${encodeURIComponent(q)}`);
      lugares = (await r.json()).map((x) => ({ nome: x.display_name, lat: +x.lat, lon: +x.lon }));
    } catch (e) { /* busca é opcional; coordenadas continuam funcionando */ }
    const itens = [...demos, ...lugares];
    if (!itens.length) { box.innerHTML = `<button type="button" disabled>Nada encontrado. Tente “Sorriso, MT” ou coordenadas.</button>`; box.classList.remove("oculto"); return; }
    box.innerHTML = itens.map((x, i) => `<button type="button" data-i="${i}">${esc(x.nome)}</button>`).join("");
    box.classList.remove("oculto");
    $$("button", box).forEach((b) => (b.onclick = () => {
      const x = itens[+b.dataset.i]; box.classList.add("oculto");
      if (x.demo) carregarDemo(x.demo); else { $("#lat").value = x.lat.toFixed(5); $("#lon").value = x.lon.toFixed(5); irParaCoordenada(x.lat, x.lon, x.nome); }
    }));
    if (imediato && itens.length === 1) $$("button", box)[0].click();
  }

  // ===================================================================== menu do botão direito
  // Clique direito no mapa (ou toque longo no celular): escolher o lugar e já marcar ou desenhar o talhão ali.
  function instalarMenuContexto() {
    let desce = null, toque = null;
    map.getCanvas().addEventListener("mousedown", (e) => { if (e.button === 2) desce = [e.clientX, e.clientY]; });
    map.on("contextmenu", (e) => {
      const o = e.originalEvent;
      o.preventDefault();
      if (desce && Math.hypot(o.clientX - desce[0], o.clientY - desce[1]) > 5) { desce = null; return; } // foi arraste para girar o mapa
      desce = null;
      abrirMenuContexto(e.lngLat, o.clientX, o.clientY);
    });
    map.on("touchstart", (e) => {
      clearTimeout(toque);
      if (!e.points || e.points.length !== 1) return;
      const ll = e.lngLat, t = e.originalEvent.touches[0];
      toque = setTimeout(() => abrirMenuContexto(ll, t.clientX, t.clientY), 650);
    });
    for (const ev of ["touchmove", "touchend", "movestart"]) map.on(ev, () => clearTimeout(toque));
    document.addEventListener("mousedown", (e) => { if (!e.target.closest("#menu-ctx")) fecharMenuContexto(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharMenuContexto(); });
    map.on("movestart", fecharMenuContexto);
  }
  function fecharMenuContexto() { const m = $("#menu-ctx"); if (m) m.remove(); }
  const TAMANHOS = [[25, 500], [100, 1000], [400, 2000]]; // ha, lado do quadrado em metros
  function quadradoEm(lon, lat, lado) {
    const dLat = lado / 2 / 111320, dLon = lado / 2 / (111320 * Math.cos((lat * Math.PI) / 180));
    return [[lon - dLon, lat + dLat], [lon + dLon, lat + dLat], [lon + dLon, lat - dLat], [lon - dLon, lat - dLat]];
  }
  function pontoNoAnel(p, anel) {
    let dentro = false;
    for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
      const [xi, yi] = anel[i], [xj, yj] = anel[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
  }
  const IC = {
    ret: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="6" width="16" height="12" rx="1"/></svg>',
    pol: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 8l7-4 8 5-2 10H7z"/></svg>',
    lupa: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    mira: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
    copiar: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
  };
  function abrirMenuContexto(ll, x, y) {
    fecharMenuContexto();
    if (!editor) return;
    const lat = ll.lat, lon = ll.lng, txt = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    const dentro = S.anel.length >= 3 && pontoNoAnel([lon, lat], S.anel);
    const menu = document.createElement("div");
    menu.id = "menu-ctx"; menu.className = "menu-ctx"; menu.setAttribute("role", "menu");
    menu.innerHTML = `<div class="mc-topo"><b id="mc-nome">Este ponto</b><code>${txt}</code></div>
      <div class="mc-rot">Marcar talhão aqui</div>
      <div class="mc-tam">${TAMANHOS.map(([ha, l]) => `<button type="button" role="menuitem" data-a="quad" data-l="${l}"><b>${ha} ha</b><small>${l >= 1000 ? l / 1000 + " km" : l + " m"} de lado</small></button>`).join("")}</div>
      <div class="mc-rot">Desenhar a partir daqui</div>
      <button type="button" role="menuitem" data-a="ret">${IC.ret}Retângulo (clique no canto oposto)</button>
      <button type="button" role="menuitem" data-a="pol">${IC.pol}Polígono (este é o 1º vértice)</button>
      <div class="mc-sep"></div>
      ${dentro && S.passo === "talhao" ? `<button type="button" role="menuitem" data-a="analisar">${IC.lupa}Analisar este talhão</button>` : ""}
      <button type="button" role="menuitem" data-a="voar">${IC.mira}Aproximar aqui</button>
      <button type="button" role="menuitem" data-a="copiar">${IC.copiar}Copiar coordenadas</button>`;
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
    $$("button", menu).forEach((b) => (b.onclick = () => { fecharMenuContexto(); acaoMenu(b.dataset.a, lon, lat, +b.dataset.l, txt); }));
    // nome do lugar (mesmo serviço da busca); se falhar, fica só a coordenada
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&accept-language=pt-BR&lat=${lat}&lon=${lon}`)
      .then((res) => res.json())
      .then((j) => {
        const el = $("#mc-nome"), a = j && j.address;
        if (el && a) el.textContent = [a.city || a.town || a.village || a.municipality || a.county, a.state].filter(Boolean).join(", ") || "Este ponto";
      })
      .catch(() => {});
  }
  async function acaoMenu(a, lon, lat, lado, txt) {
    if (a === "copiar") { try { await navigator.clipboard.writeText(txt); toast(`Copiado: ${txt}`); } catch (e) { toast(txt, 5000); } return; }
    if (a === "analisar") { const b = $("#analisar"); if (b && !b.disabled) b.click(); return; }
    if (a === "voar") {
      if ($("#lat")) { $("#lat").value = lat.toFixed(5); $("#lon").value = lon.toFixed(5); }
      return irParaCoordenada(lat, lon);
    }
    S.demo = null;
    if (S.passo !== "talhao") irPara("talhao");
    if (map.getZoom() < 12) await voarPara(lat, lon, 14.2);
    if (marcador) { marcador.remove(); marcador = null; }
    if (a === "quad") {
      editor.definir(quadradoEm(lon, lat, lado), { retangulo: true });
      editor.travar(false);
      toast("Talhão marcado. Arraste os cantos para ajustar ao limite real da lavoura.", 4000);
    } else if (a === "ret") {
      editor.iniciarRetanguloEm([lon, lat]);
      toast("Mova o mouse e clique no canto oposto do talhão.", 4000);
    } else if (a === "pol") {
      editor.iniciarPoligonoEm([lon, lat]);
      toast("Clique nos próximos vértices. Duplo clique ou Enter fecha o polígono.", 4500);
    }
  }

  let marcador;
  function voarPara(lat, lon, zoom = 14.2) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { toast("Coordenadas inválidas"); return Promise.resolve(); }
    if (marcador) marcador.remove();
    const el = document.createElement("div");
    el.innerHTML = `<svg width="46" height="46" viewBox="0 0 46 46"><circle cx="23" cy="23" r="6" fill="#E9C46A"/><circle cx="23" cy="23" r="6" fill="none" stroke="#E9C46A" stroke-width="2"><animate attributeName="r" from="6" to="22" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" from="1" to="0" dur="1.6s" repeatCount="indefinite"/></circle></svg>`;
    marcador = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(map);
    return new Promise((ok) => {
      map.once("moveend", ok);
      map.flyTo({ center: [lon, lat], zoom, speed: 0.7, curve: 1.6, essential: true, padding: paddingLateral() });
    });
  }
  async function irParaCoordenada(lat, lon, nome) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { toast("Coordenadas inválidas"); return; }
    toast(`${nome ? nome.split(",")[0] + " · " : ""}${lat.toFixed(5)}, ${lon.toFixed(5)}`, 4000);
    S.demo = null;
    await voarPara(lat, lon);
    irPara("talhao");
    toast("Agora desenhe o talhão: clique e arraste sobre a área", 3500);
  }
  function paddingLateral() { return window.innerWidth < 860 ? { bottom: window.innerHeight * 0.5 } : { left: 440 }; }

  async function carregarDemo(id) {
    const t = T.find((x) => x.id === id);
    if (!t) return;
    S.demo = t; S.prefs.irrigado = !!t.irrigado;
    const c = R.geo.metricas(t.geometria.slice(0, -1)).centroide;
    if (S.passo !== "talhao") irPara("talhao");
    await voarPara(c[1], c[0], 14.3);
    if (marcador) { marcador.remove(); marcador = null; }
    editor.definir(t.geometria, { retangulo: false });
    editor.travar(false);
    toast(`${t.nome} carregado. Ajuste os vértices se quiser.`);
  }

  // ===================================================================== 2. talhão
  function renderTalhao() {
    $("#ferramentas").innerHTML = `
      <button type="button" data-f="retangulo" title="Desenhar retângulo"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="6" width="16" height="12" rx="1"/></svg><span>Retângulo</span></button>
      <button type="button" data-f="poligono" title="Desenhar polígono"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 8l7-4 8 5-2 10H7z"/></svg><span>Polígono</span></button>
      <button type="button" data-f="livre" title="Ajustar vértices individualmente"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="7" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="17" cy="19" r="2"/><path d="M7 7l10-2M18 7l-1 10"/></svg><span>Vértices livres</span></button>
      <div class="sep"></div>
      <button type="button" data-f="desfazer" title="Desfazer (Ctrl+Z)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg></button>
      <button type="button" data-f="refazer" title="Refazer (Ctrl+Y)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/></svg></button>
      <button type="button" data-f="limpar" title="Limpar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg><span>Limpar</span></button>`;
    $$("#ferramentas button").forEach((b) => (b.onclick = () => ferramenta(b.dataset.f)));
    if (editor && editor.anel.length < 3 && editor.modo === "nenhum") editor.iniciar("retangulo");
    atualizarTalhao();
  }
  function ferramenta(f) {
    if (["retangulo", "poligono", "limpar"].includes(f)) S.demo = null;
    if (f === "retangulo" || f === "poligono") editor.iniciar(f);
    else if (f === "livre") { editor.liberarVertices(); toast("Agora cada vértice se move sozinho. Arraste os pontos médios para criar novos vértices."); }
    else if (f === "desfazer") editor.desfazer();
    else if (f === "refazer") editor.refazer();
    else if (f === "limpar") { editor.limpar(); editor.iniciar("retangulo"); }
  }
  // De onde vêm os dados do talhão: região pré-processada, pacote ao vivo já carregado, ou buscar ao vivo
  function modoDados(anel) {
    const P = R.zonal.regiaoPadrao();
    if (P && R.zonal.cobertura(anel, { bbox: P.bbox }) === "total") return "padrao";
    const A = R.zonal.regiao();
    if (A && A.aoVivo && R.zonal.cobertura(anel, A) === "total") return "aovivo_pronto";
    return "aovivo";
  }
  let rafTalhao = 0;
  function aoMudarTalhao(ev) {
    S.anel = ev.anel.map((p) => [...p]); S.met = ev.metricas;
    if (!ev.arrastando && S.res) { S.res = null; S.fixas = null; S.raiox = null; ["raiox", "prefs", "rotacoes", "mapa"].forEach((p) => S.alcancado.delete(p)); renderPassos(); }
    if (S.passo !== "talhao") return;
    cancelAnimationFrame(rafTalhao);
    rafTalhao = requestAnimationFrame(atualizarTalhao);
  }
  function localizacao(met) {
    if (!met) return "–";
    const G = R.zonal.regiao(), cob = R.zonal.cobertura(met.anel);
    if (cob === "total") return G.nome;
    const k = met.centroide.map((x) => x.toFixed(2)).join(",");
    if (S.local && S.local.k === k) return S.local.nome;
    S.local = { k, nome: "Buscando localização…" };
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&accept-language=pt-BR&lat=${met.centroide[1]}&lon=${met.centroide[0]}`)
      .then((r) => r.json()).then((j) => {
        const a = j.address || {};
        S.local = { k, nome: [a.city || a.town || a.village || a.municipality || a.county, a.state, a.country].filter(Boolean).join(", ") || "Local sem nome" };
        if (S.passo === "talhao") atualizarTalhao();
      }).catch(() => { S.local = { k, nome: "Localização indisponível offline" }; });
    return S.local.nome;
  }
  function atualizarTalhao() {
    if (!editor) return;
    const m = S.met, modo = editor.modo;
    $$("#ferramentas button").forEach((b) => {
      const f = b.dataset.f;
      b.classList.toggle("on", f === modo || (f === "livre" && m && !editor.retangulo && modo === "editar"));
      if (f === "desfazer") b.disabled = !editor.podeDesfazer;
      if (f === "refazer") b.disabled = !editor.podeRefazer;
      if (f === "livre") b.disabled = !m;
    });
    $("#dica-mapa").textContent = {
      retangulo: "Clique e arraste sobre a lavoura para desenhar o retângulo. Botão direito no mapa: marcar um talhão pronto ali",
      poligono: "Clique para cada vértice. Feche no primeiro ponto, com duplo clique ou Enter",
      editar: editor.retangulo ? "Arraste os cantos para redimensionar, o centro para mover, os pontos médios para novos vértices"
        : "Arraste vértices e pontos médios. Duplo clique num vértice remove. Arraste o interior para mover",
      nenhum: "Escolha Retângulo ou Polígono, ou use o botão direito no mapa",
    }[modo];
    S.modo = m ? modoDados(m.anel) : null;
    const semServidor = S.modo === "aovivo" && S.servidor === false;
    const coberturaTxt = { padrao: ["broto", "Região pré-processada"], aovivo_pronto: ["ceu", "Dados ao vivo já carregados"],
      aovivo: semServidor ? ["seca", "Servidor de dados desligado"] : ["ceu", "Dados buscados ao vivo (~20 s)"] };
    const [cc, ct] = m ? coberturaTxt[S.modo] : ["", ""];
    $("#painel-corpo").innerHTML = `<section>
      <div class="sobre">Etapa 2 · Delimitação</div>
      <h2>${S.demo && m ? esc(S.demo.nome) : "Desenhe seu talhão"}</h2>
      <p class="lead">${m ? "A área é calculada sobre o elipsoide WGS84 enquanto você edita." : "Use as ferramentas no topo do mapa. O desenho usa coordenadas geográficas reais."}</p>
      ${m ? `<div class="metricas">
        <div class="metrica destaque"><small>Área total</small><span class="num">${fmt(m.areaHa, 1)}<em>ha</em></span></div>
        <div class="metrica"><small>Área</small><span class="num">${fmt(m.areaM2, 0)}</span> <small style="display:inline">m²</small></div>
        <div class="metrica"><small>Perímetro</small><span class="num">${fmt(m.perimetroKm, 2)}</span> <small style="display:inline">km</small></div>
        <div class="metrica"><small>Centro (lat, lon)</small><span class="num" style="font-size:13px">${m.centroide[1].toFixed(5)}, ${m.centroide[0].toFixed(5)}</span></div>
        <div class="metrica"><small>Vértices</small><span class="num">${m.vertices}</span></div>
      </div>
      <div class="rotulo">Localização <span class="chip ${cc}">${ct}</span></div>
      <div style="color:var(--papel-2)">${esc(localizacao(m))}</div>
      ${m.autoIntersecao ? `<div class="aviso seca">O polígono se cruza. Mova os vértices para desfazer o cruzamento antes de analisar.</div>` : ""}
      ${m.pequeno ? `<div class="aviso seca">Área menor que 0,5 ha: pequena demais para as grades de satélite.</div>` : ""}
      ${S.modo === "aovivo" && !semServidor ? `<div class="aviso">Fora da região pré-processada: ao analisar, o Rotare busca no Google Earth Engine e na NASA POWER os mesmos dados (NDVI, uso do solo, solo, relevo, chuva e temperatura) para este polígono.</div>` : ""}
      ${semServidor ? `<div class="aviso seca">Para analisar fora de Sorriso, o servidor de dados precisa estar ligado: na pasta <code>rotare/app</code>, rode <code>python servidor.py</code> com o ambiente que tem o Earth Engine. Na versão publicada (sem servidor) só a região de demonstração é analisada.</div>` : ""}
      <details><summary>Coordenadas dos vértices (${m.vertices})</summary><div class="coords">${m.anel.slice(0, -1).map((p, i) => `${i + 1}. ${p[1].toFixed(6)}, ${p[0].toFixed(6)}`).join("<br>")}</div></details>`
      : `<div class="aviso">Dica: clique em um talhão de demonstração (contorno azul) para carregar uma lavoura real de Sorriso.</div>`}
    </section>`;
    rodape(`<button class="btn ouro grande" id="analisar" ${m && m.valido && !semServidor ? "" : "disabled"}>ANALISAR MEU TALHÃO</button>`);
    $("#analisar").onclick = analisar;
  }

  // ===================================================================== 3. análise
  async function buscarAoVivo() {
    const [w, s, e, n] = S.met.bbox;
    const r = await fetch(`api/pacote?w=${w}&s=${s}&e=${e}&n=${n}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.erro || "falha ao buscar dados");
    j.regiao.aoVivo = true;
    if (S.local && S.local.nome && !S.local.nome.startsWith("Buscando")) j.regiao.nome = S.local.nome;
    R.zonal.definirRegiao(j.regiao); R.mapa.trocarRegiaoMapa(map);
    C = { ...j.clima, enso_safra: C_PADRAO.enso_safra };
    S.imagensLive = j.imagens; S.aoVivo = true;
    return `${j.segundos ? fmt(j.segundos, 0) + " s no Earth Engine" : "do cache local"} · NDVI, uso do solo, solo, relevo, chuva e temperatura`;
  }
  async function analisar() {
    const ov = $("#analise");
    const modo = modoDados(S.anel);
    if (modo === "padrao") {
      if (R.zonal.regiao().aoVivo) { R.zonal.definirRegiao(R.zonal.regiaoPadrao()); R.mapa.trocarRegiaoMapa(map); }
      C = C_PADRAO; S.aoVivo = false; S.imagensLive = null;
    }
    S.forcar = false;
    const etapas = [
      ["Identificando a área selecionada", () => `${fmt(S.met.areaHa, 1)} ha · ${S.met.vertices} vértices · ${modo === "padrao" ? "região pré-processada" : "fora da região pré-processada"}`],
      ...(modo === "aovivo" ? [["Buscando dados de satélite desta área ao vivo", buscarAoVivo]] : []),
      ["Consultando histórico de satélite e uso do solo", () => {
        const n = R.zonal.serieNdvi(S.anel), u = R.zonal.usoTerra(S.anel), a = R.zonal.usoAtual(S.anel);
        S.raiox = { ndvi: n, uso: u, usoAtual: a };
        return `NDVI MODIS: ${n.celulas} células × ${n.serie.length} meses${u ? ` · MapBiomas ${u[0].ano}–${u[u.length - 1].ano}` : ""}${a ? ` · WorldCover: ${Math.round(a.agricola * 100)}% agrícola, ${Math.round(a.urbano * 100)}% construções` : ""}`;
      }],
      ["Analisando precipitação e clima", () => { S.raiox.clima = resumoClima(); return `${S.raiox.clima.nAnos} safras de chuva diária CHIRPS · temperatura NASA POWER`; }],
      ["Consultando características do solo", () => { S.raiox.solo = R.zonal.solo(S.anel); S.raiox.relevo = R.zonal.relevo(S.anel); if (!S.raiox.solo) return `SoilGrids: nenhum solo mapeado na área (cidade ou água) · SRTM: ${S.raiox.relevo.celulas} células`; return `SoilGrids: ${S.raiox.solo.vizinho ? "célula vizinha a " + fmt(S.raiox.solo.vizinho.distanciaKm, 1) + " km" : S.raiox.solo.celulas + " células"} · SRTM: ${S.raiox.relevo.celulas} células de 90 m`; }],
      ["Calculando indicadores ambientais", () => { S.raiox.agua = resumoAgua(); if (!S.raiox.solo) return `SMAP ${S.raiox.agua.nMeses} meses · sem solo, sem água disponível`; return `Água disponível ${fmt(S.raiox.solo.cad, 0)} mm/m · SMAP ${S.raiox.agua.nMeses} meses`; }],
      ["Preparando as estratégias de rotação", () => {
        S.safras = R.historico.inferirSafras(S.raiox.ndvi.serie, S.raiox.uso);
        S.atual = R.historico.rotacaoAtual(S.safras); S.atualConfirmada = false;
        if (!S.raiox.solo) { S.raiox.ref = null; return `${S.safras.length} safras lidas · rotações não calculadas: não há solo agrícola mapeado`; }
        S.raiox.ref = R.rotacao.resumirOpcoes(R.rotacao.simularOpcoes(C, soloMotor(), S.prefs.irrigado, null));
        return `${S.safras.length} safras inferidas · ${R.rotacao.ANOS_REFERENCIA} anos × 7 opções simulados dia a dia`;
      }],
    ];
    ov.innerHTML = `<div class="analise-caixa"><div class="sobre">Raio-X do talhão</div><h3>Analisando ${fmt(S.met.areaHa, 1)} ha</h3>
      <p>Cada etapa abaixo roda de verdade sobre os dados do seu polígono.</p>
      <ol class="etapas">${etapas.map(([t], i) => `<li data-i="${i}"><span class="ico"></span><div>${t}<small></small></div></li>`).join("")}</ol></div>`;
    ov.classList.remove("oculto");
    try {
      for (let i = 0; i < etapas.length; i++) {
        const li = $(`li[data-i="${i}"]`, ov);
        li.classList.add("ativa");
        await espera(380);
        const t0 = performance.now();
        const txt = await etapas[i][1]();
        $("small", li).textContent = `${txt} · ${fmt(performance.now() - t0, 0)} ms`;
        li.classList.replace("ativa", "ok");
        await espera(170);
      }
      await espera(450);
    } catch (e) {
      console.error(e);
      ov.classList.add("oculto"); modal(`<h3>Não foi possível analisar</h3><p>${esc(e.message)}</p><p>Se a área estiver fora de Sorriso, confira se o servidor (<code>python servidor.py</code>) está ligado e com acesso ao Earth Engine.</p>`); return;
    }
    ov.classList.add("oculto");
    S.res = null; S.fixas = null;
    S.alcancado.add("raiox"); S.alcancado.add("prefs");
    irPara("raiox");
  }
  function soloMotor() { return { cad: S.raiox.solo.cad, declividade: S.raiox.relevo.declividade }; }

  function resumoClima() {
    const anos = R.rotacao.anosAnalise(C, null), B = R.balanco;
    let chuva = 0, ini = 0, fim = 0, tmed = 0;
    const mensal = new Array(12).fill(0);
    for (const y of anos) {
      const a = B.anoClimatico(C, y, null);
      chuva += a.p.reduce((s, v) => s + v, 0);
      ini += B.inicioChuvas(a).dia; fim += B.fimChuvas(a);
      let t = 0; for (let d = 0; d < 365; d++) t += (a.tmax[d] + a.tmin[d]) / 2; tmed += t / 365;
      for (let d = 0; d < 365; d++) { const m = new Date(Date.UTC(y, 8, 1 + d)).getUTCMonth(); mensal[(m + 4) % 12] += a.p[d]; }
    }
    const n = anos.length;
    const dataMedia = (dia) => new Date(Date.UTC(2001, 8, 1 + Math.round(dia))).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" });
    // validação: CHIRPS x IMERG nos anos civis completos em comum
    const anosImerg = {}; for (const [m, v] of Object.entries(C.imerg_mensal)) { const y = m.slice(0, 4); anosImerg[y] = anosImerg[y] || []; anosImerg[y].push(v); }
    const comuns = Object.keys(anosImerg).filter((y) => anosImerg[y].length === 12 && `${y}-12-31` <= B.dataDe(C, C.chuva.length - 1));
    let sI = 0, sC = 0;
    for (const y of comuns) { sI += anosImerg[y].reduce((s, v) => s + v, 0); const i0 = B.indiceDe(C, `${y}-01-01`), i1 = B.indiceDe(C, `${y}-12-31`); for (let i = i0; i <= i1; i++) sC += C.chuva[i]; }
    return { anos, nAnos: n, chuvaAnual: chuva / n, tmed: tmed / n, inicio: dataMedia(ini / n), fim: dataMedia(fim / n), mensal: mensal.map((v) => v / n),
             imerg: comuns.length ? { anos: comuns, imerg: sI / comuns.length, chirps: sC / comuns.length } : null };
  }
  function resumoAgua() {
    const sm = C.smap_mensal, meses = Object.keys(sm).sort();
    const clim = {}; for (const m of meses) { const k = m.slice(5); clim[k] = clim[k] || []; clim[k].push(sm[m][1]); }
    const media = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    const ult = meses.slice(-12);
    const anom = media(ult.map((m) => sm[m][1] / media(clim[m.slice(5)]) - 1));
    const sazonal = Object.keys(clim).sort().map((k) => ({ mes: +k, raiz: media(clim[k]) }));
    return { nMeses: meses.length, anomalia: anom, periodoAnom: `${ult[0]} a ${ult[ult.length - 1]}`, sazonal, inicio: meses[0], fim: meses[meses.length - 1] };
  }

  // ===================================================================== 4. raio-x
  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  function ensoDe(ano) { return C.enso_safra[ano] ? C.enso_safra[ano].fase : null; }
  function renderRaiox() {
    const X = S.raiox, m = S.met;
    if (!X) { irPara("talhao"); return; }
    const so = X.solo, rel = X.relevo, cl = X.clima, ag = X.agua;
    const nativa = X.uso ? X.uso[X.uso.length - 1].fracaoNativa : 0;
    const UA = X.usoAtual;
    const milhoFalha = X.ref ? X.ref.milho.falha : null;
    const opcoes = Object.entries(SEGUNDA_SAFRA).map(([k, v]) => `<option value="${k}">Soja + ${v.nome}</option>`).join("");
    const ult3 = S.safras.filter((s) => s.opcao).slice(-3);
    const imgs = S.demo && S.demo.imagens ? S.demo.imagens.itens.filter((x) => x.arquivo)
      : (S.aoVivo && S.imagensLive ? S.imagensLive.itens : []);
    $("#painel-corpo").innerHTML = `<section>
      <div class="sobre">Etapa 3 · Raio-X do talhão</div>
      <h2>${S.demo ? esc(S.demo.nome) : "Seu talhão"} · <span class="num">${fmt(m.areaHa, 1)} ha</span></h2>
      <p class="lead">${esc(R.zonal.regiao().nome)} · ${m.centroide[1].toFixed(4)}, ${m.centroide[0].toFixed(4)}. Cada número traz a fonte, a resolução e o nível de confiança.${S.aoVivo ? ' <span class="chip ceu">dados ao vivo</span>' : ""}</p>
      ${UA ? `<div class="card" style="margin-bottom:10px;${UA.bloqueio ? "border-color:var(--seca)" : ""}">
        <h4><span class="ponto" style="background:${UA.bloqueio ? "var(--seca)" : "var(--broto)"}"></span>O que existe neste polígono hoje</h4>
        <div class="barra-pesos" style="height:14px;margin:0 0 10px">${UA.classes.map((c) => `<div title="${esc(c.nome)} ${Math.round(c.fracao * 100)}%" style="flex:${c.fracao};background:${c.cor}"></div>`).join("")}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--papel-2)">${UA.classes.filter((c) => c.fracao >= 0.01).map((c) => `<span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${c.cor};margin-right:5px"></span>${esc(c.nome)} <b class="num">${Math.round(c.fracao * 100)}%</b></span>`).join("")}</div>
        ${UA.alertas.map((a) => `<div class="aviso ${a.nivel === "bloqueio" ? "seca" : "ouro"}">${esc(a.texto)}</div>`).join("")}
        ${UA.naoAgricola ? `<div class="aviso seca"><b>Esta área não parece lavoura:</b> só ${Math.round(UA.agricola * 100)}% do polígono é lavoura, pastagem ou solo exposto. Recomendações de rotação não fazem sentido para casas, mata ou água. Redesenhe o talhão sobre a parte agrícola.</div>` : ""}
        <div class="fonte"><span>${esc(UA.fonte)} · ${UA.celulas} células${X.uso ? ` · MapBiomas ${X.uso[X.uso.length - 1].ano}: ${esc(X.uso[X.uso.length - 1].nome)} (${Math.round(X.uso[X.uso.length - 1].fracao * 100)}%)` : ""}</span><span class="conf alta">observado</span><span>Camada “Uso do solo hoje” no mapa.</span></div>
      </div>` : ""}

      <div class="card">
        <h4><span class="ponto" style="background:var(--ceu)"></span>Histórico agrícola · últimos 10+ anos vistos do espaço</h4>
        ${graficoNdvi(X.ndvi.serie)}
        <div class="fonte"><span>NDVI: ${esc(X.ndvi.fonte)} · média de ${X.ndvi.celulas} células (~270 m)${X.ndvi.aproximado ? " · talhão menor que a célula: valor da célula mais próxima" : ""}</span><span class="conf media">confiança média</span><span>Clique num mês para ver o NDVI no mapa.</span></div>
        <div class="safras">${S.safras.map((s) => `<div class="safra ${ensoDe(s.ano) === "el_nino_forte" ? "elnino" : ""}">
          <b>${s.safra}</b> ${ensoDe(s.ano) === "el_nino_forte" ? '<span class="chip seca" style="font-size:9px;padding:1px 5px">El Niño forte</span>' : ""}
          <p>${esc(s.texto)}</p><p style="color:var(--papel-3);font-size:11px">pico verão ${fmt(s.verao, 2)} · 2ª safra ${fmt(s.segunda, 2)}${s.mapbiomas ? ` · MapBiomas: ${esc(s.mapbiomas)}` : ""}</p></div>`).join("")}</div>
        ${imgs.length ? `<div class="rotulo">O talhão visto de cima (NASA HLS 30 m), pico da soja e da safrinha</div>
          <div class="tira">${imgs.map((x) => `<figure class="${ensoDe(x.ano) === "el_nino_forte" ? "elnino" : ""}"><img loading="lazy" src="${x.url || "data/" + x.arquivo}" alt="${x.fase} ${x.ano}"><figcaption><span>${String(x.ano).slice(2)}/${String(x.ano + 1).slice(2)}</span><span>${x.fase}</span></figcaption></figure>`).join("")}</div>
          <div class="fonte"><span>NASA HLS v2.0 (HLSL30 + HLSS30), mediana sem nuvem, via Google Earth Engine. Borda laranja: El Niño forte.</span></div>` : ""}
      </div>

      <div class="card" style="margin-top:10px">
        <h4><span class="ponto" style="background:var(--palha)"></span>Confirme sua rotação atual</h4>
        <p style="color:var(--papel-2);margin:0 0 10px;font-size:13px">O satélite sugere o que foi plantado nas 3 últimas safras. É inferência: corrija se não estiver certo. Esta será a “Sua rotação atual” na comparação.</p>
        <div class="confirma">${S.atual.map((o, i) => `<label>${ult3[i] ? ult3[i].safra : `ano ${i + 1}`}<select data-ano="${i}">${opcoes}</select></label>`).join("")}</div>
        <div style="margin-top:10px;display:flex;gap:8px;align-items:center"><button class="btn mini ${S.atualConfirmada ? "on" : ""}" id="confirmar">${S.atualConfirmada ? "✓ Confirmada" : "Confirmo este histórico"}</button><span style="font-size:11px;color:var(--papel-3)">NDVI de 250 m não separa milho, sorgo e milheto.</span></div>
      </div>

      <div class="rotulo" style="margin-top:20px">Indicadores ambientais do talhão</div>
      <div class="grade-cards">
        ${!so ? `<div class="card" style="border-color:var(--seca)"><h4><span class="ponto" style="background:var(--seca)"></span>Solo</h4>
          <p style="color:var(--papel-2);font-size:13px;margin:0">Não há solo agrícola mapeado nesta área: o SoilGrids não estima solo sob cidades, construções e água. Por isso o Rotare não calcula rotações aqui.</p>
          <div class="fonte"><span>ISRIC SoilGrids 2.0 · 250 m</span><span class="conf alta">sem solo</span></div></div>` : `<div class="card"><h4><span class="ponto" style="background:var(--terra)"></span>Solo</h4><div class="kv">
          <span>Textura (0–30 cm)</span><b>${so.textura}</b>
          <span>Areia · argila</span><b>${fmt(so.areia, 0)}% · ${fmt(so.argila, 0)}%</b>
          <span>Carbono orgânico</span><b>${fmt(so.carbono, 1)} g/kg</b>
          <span>Água disponível</span><b>${fmt(so.cad, 0)} mm/m</b>
          <span>Nutrientes (N, P, K)</span><b style="color:var(--papel-3)">sem laudo</b></div>
          <div class="fonte"><span>ISRIC SoilGrids 2.0 · 250 m · ${so.vizinho ? `sem estimativa dentro do polígono (cidade ou água): usada a célula com dado mais próxima, a ${fmt(so.vizinho.distanciaKm, 1)} km` : `${so.celulas} células`} · água disponível por Saxton & Rawls (2006)</span><span class="conf baixa">estimativa</span></div></div>`}
        <div class="card"><h4><span class="ponto" style="background:var(--ceu)"></span>Clima</h4><div class="kv">
          <span>Chuva média anual</span><b>${fmt(cl.chuvaAnual, 0)} mm</b>
          <span>Temperatura média</span><b>${fmt(cl.tmed, 1)} °C</b>
          <span>Início das chuvas (média)</span><b>${cl.inicio}</b>
          <span>Fim das chuvas (média)</span><b>${cl.fim}</b></div>
          ${barrasMensais(cl.mensal)}
          <div class="fonte"><span>CHIRPS diário (~5 km) · NASA POWER (~55 km) · ${cl.nAnos} safras (${cl.anos[0]}/${String(cl.anos[0] + 1).slice(2)} a ${cl.anos[cl.anos.length - 1]}/${String(cl.anos[cl.anos.length - 1] + 1).slice(2)})${cl.imerg ? ` · validação NASA IMERG ${cl.imerg.anos[0]}–${cl.imerg.anos[cl.imerg.anos.length - 1]}: ${fmt(cl.imerg.imerg, 0)} mm/ano contra ${fmt(cl.imerg.chirps, 0)} do CHIRPS` : ""}</span><span class="conf media">regional</span></div></div>
        <div class="card"><h4><span class="ponto" style="background:var(--ceu)"></span>Água</h4><div class="kv">
          <span>Umidade na zona de raízes</span><b>${ag.anomalia >= 0 ? "+" : ""}${pct(ag.anomalia, 0)} vs. média</b>
          <span>Período da anomalia</span><b style="font-size:11px">${ag.periodoAnom}</b>
          ${milhoFalha === null ? "" : `<span>Quebra do milho safrinha</span><b style="color:${milhoFalha > 0.2 ? "var(--seca)" : milhoFalha > 0.08 ? "var(--palha)" : "var(--broto)"}">${pct(milhoFalha)} dos anos</b>`}
          <span>Irrigação</span><b>${S.prefs.irrigado ? "sim (informado)" : "não informado"}</b></div>
          ${sazonalSmap(ag.sazonal)}
          <div class="fonte"><span>NASA SMAP L4 (9 km, ${ag.inicio} a ${ag.fim}) · quebra = produtividade relativa &lt; 80% no balanço hídrico FAO-56 com o solo deste talhão</span><span class="conf media">modelo</span></div></div>
        <div class="card"><h4><span class="ponto" style="background:#D2A57A"></span>Relevo</h4><div class="kv">
          <span>Altitude média</span><b>${fmt(rel.altitude, 0)} m</b>
          <span>Variação</span><b>${fmt(rel.altMin, 0)}–${fmt(rel.altMax, 0)} m</b>
          <span>Declividade média</span><b>${fmt(rel.declividade, 1)}%</b>
          <span>Declividade máxima</span><b>${fmt(rel.declMax, 1)}%</b>
          <span>Atenção para erosão</span><b style="color:${rel.fracaoAtencao > 0.1 ? "var(--seca)" : "var(--broto)"}">${rel.fracaoAtencao > 0 ? pct(rel.fracaoAtencao) + " da área > 8%" : "baixa"}</b>
          <span>Vegetação nativa no polígono</span><b style="color:${nativa > 0 ? "var(--seca)" : "var(--broto)"}">${nativa > 0 ? pct(nativa) : "não detectada"}</b></div>
          <div class="fonte"><span>NASA SRTM 30 m → ~90 m · ${rel.celulas} células${X.uso ? ` · nativa: MapBiomas ${X.uso[X.uso.length - 1].ano}` : " · MapBiomas só cobre o Brasil"}</span><span class="conf alta">alta</span></div></div>
      </div>
      ${nativa > 0 ? `<div class="aviso seca">${pct(nativa)} do polígono aparece como vegetação nativa no MapBiomas. Essa parte não entra no cultivo: veja a camada “Áreas de atenção” no mapa.</div>` : ""}
    </section>`;
    $$(".confirma select").forEach((s) => { s.value = S.atual[+s.dataset.ano]; s.onchange = () => { S.atual[+s.dataset.ano] = s.value; S.atualConfirmada = true; S.fixas = null; S.res = null; $("#confirmar").textContent = "✓ Confirmada"; $("#confirmar").classList.add("on"); }; });
    $("#confirmar").onclick = () => { S.atualConfirmada = true; $("#confirmar").textContent = "✓ Confirmada"; $("#confirmar").classList.add("on"); };
    $$(".ponto-ndvi").forEach((p) => (p.onclick = () => { verNdvi(+p.dataset.i); }));
    if (!so) {
      rodape(`<button class="btn ouro grande" id="redesenhar">Redesenhar o talhão sobre a área agrícola</button>`);
      $("#redesenhar").onclick = () => { irPara("talhao"); alternarCamada("uso", true); };
      S.alcancado.delete("prefs"); renderPassos();
    } else if (UA && UA.bloqueio && !S.forcar) {
      rodape(`<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button class="btn grande" id="redesenhar">Redesenhar o talhão</button><button class="btn grande" id="forcar" style="border-color:var(--seca);color:#F2A08A">Analisar mesmo assim</button></div>`);
      $("#redesenhar").onclick = () => { irPara("talhao"); alternarCamada("uso", true); };
      $("#forcar").onclick = () => { S.forcar = true; irPara("prefs"); };
    } else {
      rodape(`<button class="btn ouro grande" id="ir-prefs">Definir minhas prioridades →</button>`);
      $("#ir-prefs").onclick = () => irPara("prefs");
    }
    if (UA && UA.urbano + UA.agua + UA.mata > 0.05) { S.camadas.uso = true; R.mapa.atualizarUso(map, S.anel); R.mapa.mostrar(map, "uso", true); renderCamadas(); }
  }
  function verNdvi(i) {
    S.mesNdvi = i; S.camadas.ndvi = true;
    const mes = R.mapa.atualizarNdvi(map, i);
    R.mapa.mostrar(map, "ndvi", true); renderCamadas();
    toast(`NDVI de ${MESES[+mes.slice(5) - 1]}/${mes.slice(0, 4)} no mapa (MODIS ~270 m)`);
  }

  function graficoNdvi(serie) {
    const W = 680, H = 170, p = { l: 26, r: 6, t: 10, b: 30 }, n = serie.length;
    const x = (i) => p.l + (i / (n - 1)) * (W - p.l - p.r), y = (v) => p.t + (1 - (v - 0.1) / 0.9) * (H - p.t - p.b);
    let d = "", faixas = "", rot = "", pts = "";
    serie.forEach((s, i) => { if (s.ndvi === null) return; d += `${d ? "L" : "M"}${x(i).toFixed(1)},${y(s.ndvi).toFixed(1)}`; });
    for (let k = 0; k * 12 < n; k++) {
      const ano = +serie[k * 12].mes.slice(0, 4), x0 = x(k * 12), x1 = x(Math.min(n - 1, k * 12 + 11.99));
      const nino = ensoDe(ano) === "el_nino_forte";
      faixas += `<rect x="${x0}" y="${p.t}" width="${x1 - x0}" height="${H - p.t - p.b}" fill="${nino ? "rgba(231,111,81,.13)" : k % 2 ? "rgba(255,255,255,.025)" : "none"}"/>`;
      rot += `<text x="${(x0 + x1) / 2}" y="${H - 14}" text-anchor="middle">${String(ano).slice(2)}/${String(ano + 1).slice(2)}</text>`;
      if (nino) rot += `<text x="${(x0 + x1) / 2}" y="${H - 3}" text-anchor="middle" style="fill:#E76F51">El Niño</text>`;
    }
    serie.forEach((s, i) => { if (s.ndvi !== null) pts += `<circle class="ponto-ndvi" data-i="${i}" cx="${x(i)}" cy="${y(s.ndvi)}" r="5" fill="transparent"><title>${s.mes}: NDVI ${s.ndvi.toFixed(2)}</title></circle>`; });
    const grade = [0.2, 0.4, 0.6, 0.8, 1.0].map((v) => `<line x1="${p.l}" x2="${W - p.r}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,.06)"/><text x="${p.l - 4}" y="${y(v) + 3}" text-anchor="end">${v.toFixed(1)}</text>`).join("");
    return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Série de NDVI mensal">
      <defs><linearGradient id="gndvi" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3DBE7A" stop-opacity=".35"/><stop offset="1" stop-color="#3DBE7A" stop-opacity="0"/></linearGradient></defs>
      ${faixas}${grade}<path d="${d}L${x(n - 1)},${H - p.b}L${x(0)},${H - p.b}Z" fill="url(#gndvi)"/>
      <path d="${d}" fill="none" stroke="#3DBE7A" stroke-width="1.8"><animate attributeName="stroke-dasharray" from="0 3000" to="3000 0" dur="1.6s" fill="freeze"/></path>${rot}${pts}</svg>`;
  }
  function barrasMensais(v) {
    const W = 260, H = 70, mx = Math.max(...v), nomes = ["S", "O", "N", "D", "J", "F", "M", "A", "M", "J", "J", "A"], bw = W / 12;
    return `<svg class="grafico" viewBox="0 0 ${W} ${H}" style="margin-top:10px" role="img" aria-label="Chuva média mensal">${v.map((x, i) => {
      const h = (x / mx) * (H - 16);
      return `<rect x="${i * bw + 3}" y="${H - 12 - h}" width="${bw - 6}" height="${h}" rx="2" fill="#4C8DF6" opacity=".8"><title>${fmt(x, 0)} mm</title></rect><text x="${i * bw + bw / 2}" y="${H - 2}" text-anchor="middle">${nomes[i]}</text>`;
    }).join("")}</svg>`;
  }
  function sazonalSmap(s) {
    const W = 260, H = 60, vs = s.map((x) => x.raiz), mn = Math.min(...vs), mx = Math.max(...vs);
    const x = (i) => 8 + (i / 11) * (W - 16), y = (v) => 6 + (1 - (v - mn) / (mx - mn || 1)) * (H - 22);
    return `<svg class="grafico" viewBox="0 0 ${W} ${H}" style="margin-top:10px" role="img" aria-label="Umidade do solo média mensal"><path d="${s.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.raiz)}`).join("")}" fill="none" stroke="#4C8DF6" stroke-width="1.8"/>${s.map((p, i) => `<text x="${x(i)}" y="${H - 2}" text-anchor="middle">${MESES[p.mes - 1][0].toUpperCase()}</text>`).join("")}</svg>`;
  }

  // ===================================================================== 5. preferências
  const EIXOS = [
    { id: "solo", nome: "Proteção e recuperação do solo", cor: "#8B5E34", ico: "solo" },
    { id: "risco", nome: "Redução do risco climático", cor: "#E76F51", ico: "risco" },
    { id: "agua", nome: "Eficiência no uso da água", cor: "#4C8DF6", ico: "agua" },
    { id: "renda", nome: "Rentabilidade relativa", cor: "#E9C46A", ico: "renda" },
  ];
  function renderPrefs() {
    if (!S.raiox || !S.raiox.solo) { irPara(S.raiox ? "raiox" : "talhao"); return; }
    const P = S.prefs;
    $("#painel-corpo").innerHTML = `<section>
      <div class="sobre">Etapa 4 · Preferências</div>
      <h2>A decisão é sua</h2>
      <p class="lead">Diga o que importa nesta área. O motor transforma isso em pesos, que somam 100%.</p>
      <label class="rotulo" for="texto" style="margin-top:0">O que é mais importante para você nesta área? (opcional)</label>
      <textarea class="campo" id="texto" placeholder="Ex.: quero proteger o solo e ter menos risco de seca, sem perder muita renda">${esc(P.texto)}</textarea>
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px"><button class="btn mini" id="interpretar">Sugerir pesos a partir do texto</button><span id="interp" style="font-size:11px;color:var(--papel-3)"></span></div>
      <div id="sliders" style="margin-top:8px">${EIXOS.map((e) => `<div class="pref"><span class="ico" style="background:${e.cor}22">${ICO[e.ico]}</span>
        <div><b>${e.nome}</b><input type="range" min="0" max="100" step="1" value="${P.pesos[e.id]}" data-eixo="${e.id}" style="--cor:${e.cor}"></div>
        <span class="num" data-peso="${e.id}"></span></div>`).join("")}</div>
      <div class="barra-pesos" id="barra"></div>
      <div class="rotulo">A propriedade tem irrigação neste talhão?</div>
      <div class="alternar"><button class="btn mini ${P.irrigado ? "on" : ""}" data-irr="1">Sim</button><button class="btn mini ${!P.irrigado ? "on" : ""}" data-irr="0">Não</button></div>
      <div class="rotulo">Culturas que o maquinário permite</div>
      <div class="opcoes" id="maq">${Object.entries(CULTURAS).map(([k, c]) => `<label><input type="checkbox" value="${k}" ${P.maquinario.has(k) ? "checked" : ""} ${k === "soja" ? "disabled" : ""}><span>${c.nome}${k === "soja" ? " (verão)" : ""}</span></label>`).join("")}</div>
      <div class="rotulo">Alguma cultura que você não quer plantar?</div>
      <div class="opcoes excluir" id="exc">${Object.entries(CULTURAS).filter(([k]) => k !== "soja").map(([k, c]) => `<label><input type="checkbox" value="${k}" ${P.excluir.has(k) ? "checked" : ""}><span>${c.nome}</span></label>`).join("")}</div>
      <div class="aviso">Nesta versão a soja é a cultura de verão em todos os cenários (é o sistema dominante em Sorriso). O motor compara as segundas safras e as coberturas.</div>
    </section>`;
    const atualizarBarra = () => {
      const w = R.rotacao.normalizarPesos(P.pesos);
      EIXOS.forEach((e) => ($(`[data-peso="${e.id}"]`).textContent = `${Math.round(w[e.id] * 100)}%`));
      $("#barra").innerHTML = EIXOS.map((e) => `<div style="flex:${w[e.id]};background:${e.cor}"></div>`).join("");
    };
    $$("#sliders input").forEach((i) => (i.oninput = () => { P.pesos[i.dataset.eixo] = +i.value; atualizarBarra(); }));
    atualizarBarra();
    $("#texto").oninput = (e) => (P.texto = e.target.value);
    $("#interpretar").onclick = () => {
      const r = R.explica.interpretarPrioridades(P.texto);
      if (!r.reconheceu) { $("#interp").textContent = "Não reconheci prioridades no texto. Ajuste os controles."; return; }
      for (const e of EIXOS) { P.pesos[e.id] = Math.round(r.pesos[e.id] * 100); $(`[data-eixo="${e.id}"]`).value = P.pesos[e.id]; }
      atualizarBarra();
      const achados = Object.entries(r.achados).filter(([, v]) => v.length).map(([k, v]) => `${R.explica.NOMES_EIXO[k].toLowerCase()} (“${v.join("”, “")}”)`);
      $("#interp").textContent = `Interpretado por palavras-chave: ${achados.join("; ")}. Ajuste se quiser.`;
    };
    $$("[data-irr]").forEach((b) => (b.onclick = () => { P.irrigado = b.dataset.irr === "1"; $$("[data-irr]").forEach((x) => x.classList.toggle("on", x === b)); S.fixas = null; }));
    $$("#maq input").forEach((i) => (i.onchange = () => { i.checked ? P.maquinario.add(i.value) : P.maquinario.delete(i.value); S.fixas = null; }));
    $$("#exc input").forEach((i) => (i.onchange = () => { i.checked ? P.excluir.add(i.value) : P.excluir.delete(i.value); S.fixas = null; }));
    rodape(`<button class="btn ouro grande" id="gerar">Comparar rotações para os próximos 3 anos →</button>`);
    $("#gerar").onclick = () => { S.fixas = null; S.cen = { chuva: 0, temp: 0, elNino: false }; S.sel = null; S.alcancado.add("rotacoes"); S.alcancado.add("mapa"); irPara("rotacoes"); };
  }
  function permitidas() {
    const P = S.prefs, ok = new Set();
    for (const [k, op] of Object.entries(SEGUNDA_SAFRA)) {
      if (op.culturas.every((c) => P.maquinario.has(c) && !P.excluir.has(c))) ok.add(k);
    }
    return ok;
  }

  // ===================================================================== 6. rotações + simulador
  function calcular() {
    const ctx = { clima: C, solo: soloMotor(), irrigado: S.prefs.irrigado, atual: S.atual, permitidas: permitidas(), pesos: S.prefs.pesos, cenario: S.cen };
    const t0 = performance.now();
    const r = R.rotacao.analisar(ctx, S.fixas);
    r.ms = performance.now() - t0;
    if (!S.fixas) {
      S.fixas = r.cartoes.map((c) => ({ id: c.id, titulo: c.titulo, seq: c.seq }));
      S.posRef = Object.fromEntries(r.cartoes.map((c) => [c.id, c.posicao]));
    }
    S.res = r;
    if (!S.sel || !r.cartoes.some((c) => c.id === S.sel)) S.sel = r.cartoes[0].id;
    return r;
  }
  function renderRotacoes() {
    if (!S.raiox || !S.raiox.solo) { irPara(S.raiox ? "raiox" : "talhao"); return; }
    calcular();
    const cl = S.raiox.clima;
    const analogos = R.rotacao.anosAnalise(C, { elNino: true });
    $("#painel-corpo").innerHTML = `<section>
      <div class="res-topo"><div>
        <div class="sobre">Etapa 5 · Rotações para os próximos 3 anos</div>
        <h2>O que plantar nesta área até ${new Date().getFullYear() + 3}?</h2>
        <p class="lead" style="margin:0">${S.res.nSequencias} combinações avaliadas contra ${cl.nAnos} anos de clima real (${cl.anos[0]}/${String(cl.anos[0] + 1).slice(2)} a ${cl.anos[cl.anos.length - 1]}/${String(cl.anos[cl.anos.length - 1] + 1).slice(2)}), dia a dia, com o solo deste talhão. <span id="ms" class="num" style="color:var(--papel-3)"></span></p></div>
        <div style="display:flex;gap:8px"><button class="btn mini" id="como2">Como calculamos?</button><button class="btn mini" id="ver-mapa">Ver no mapa</button></div></div>

      ${S.aoVivo ? `<div class="aviso ouro" style="margin:0 0 12px">Dados buscados ao vivo para esta área. O motor usa o calendário soja + 2ª safra do Brasil Central (início das chuvas a partir de 15/set): fora desse sistema, trate os resultados como indicativos.</div>` : ""}
      ${S.forcar ? `<div class="aviso seca" style="margin:0 0 12px">Você pediu para analisar um polígono que não parece lavoura: ${esc((S.raiox.usoAtual.alertas[0] || { texto: "pouca área agrícola" }).texto)}</div>` : ""}
      <div class="simulador">
        <h3>${ICO.clima.replace("<svg", '<svg width="20" height="20"')} Simulador de cenários climáticos</h3>
        <div class="sim-grade">
          <div class="sim-ctrl"><label>Chuva <span class="num" id="v-chuva"></span></label><input type="range" id="s-chuva" min="-40" max="20" step="5" value="${S.cen.chuva * 100}" style="--cor:#4C8DF6"><div class="escala"><span>−40%</span><span>0</span><span>+20%</span></div></div>
          <div class="sim-ctrl"><label>Temperatura <span class="num" id="v-temp"></span></label><input type="range" id="s-temp" min="0" max="3" step="0.5" value="${S.cen.temp}" style="--cor:#E76F51"><div class="escala"><span>+0 °C</span><span>+1,5</span><span>+3 °C</span></div></div>
          <button class="elnino-btn ${S.cen.elNino ? "on" : ""}" id="s-nino" type="button"><b>Modo El Niño</b><small>${analogos.length} anos análogos: ${analogos.map((y) => `${String(y).slice(2)}/${String(y + 1).slice(2)}`).join(", ")}</small></button>
        </div>
        <div class="condicional"><span class="chip ceu">simulação condicional</span><span id="cen-txt"></span><button class="btn mini fantasma" id="s-reset">Voltar ao clima de referência</button></div>
      </div>
      <div id="otima"></div>
      <div class="cartoes" id="cartoes"></div>
      <div id="explica"></div>
    </section>`;
    $("#como2").onclick = () => modal(comoCalculamos());
    $("#ver-mapa").onclick = () => irPara("mapa");
    let raf = 0;
    const aoMexer = () => {
      S.cen.chuva = +$("#s-chuva").value / 100; S.cen.temp = +$("#s-temp").value;
      cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { calcular(); atualizarResultados(true); });
      rotulosSim();
    };
    $("#s-chuva").oninput = aoMexer; $("#s-temp").oninput = aoMexer;
    $("#s-nino").onclick = () => { S.cen.elNino = !S.cen.elNino; $("#s-nino").classList.toggle("on", S.cen.elNino); calcular(); atualizarResultados(true); rotulosSim(); };
    $("#s-reset").onclick = () => { S.cen = { chuva: 0, temp: 0, elNino: false }; $("#s-chuva").value = 0; $("#s-temp").value = 0; $("#s-nino").classList.remove("on"); calcular(); atualizarResultados(true); rotulosSim(); };
    rotulosSim(); atualizarResultados(false);
    $("#painel-rodape").classList.add("oculto");
  }
  function rotulosSim() {
    const c = S.cen;
    $("#v-chuva").textContent = `${c.chuva > 0 ? "+" : ""}${Math.round(c.chuva * 100)}%`;
    $("#v-temp").textContent = `+${fmt(c.temp, 1)} °C`;
    const partes = [];
    if (c.elNino) partes.push(`clima dos ${S.res.anos.length} anos de El Niño forte (${S.res.anos.map((y) => `${y}/${String(y + 1).slice(2)}`).join(", ")}), mostrando a dispersão entre eles`);
    if (c.chuva) partes.push(`chuva diária ${c.chuva > 0 ? "aumentada" : "reduzida"} em ${Math.abs(Math.round(c.chuva * 100))}%`);
    if (c.temp) partes.push(`temperatura +${fmt(c.temp, 1)} °C (ET0 e dias de calor recalculados)`);
    $("#cen-txt").textContent = partes.length ? `“E se” ${partes.join(" + ")}. Não é previsão do tempo.` : `Clima de referência: as ${S.res.anos.length} últimas safras reais. Não é previsão do tempo.`;
  }

  function atualizarResultados(animar) {
    const r = S.res;
    $("#ms").textContent = `· recalculado em ${fmt(r.ms, 0)} ms`;
    // FLIP: guarda posições antes de reordenar
    const antes = {};
    if (animar) $$("#cartoes .cartao").forEach((el) => (antes[el.dataset.id] = el.getBoundingClientRect()));
    $("#cartoes").innerHTML = r.cartoes.map(cartaoHtml).join("");
    if (animar) {
      $$("#cartoes .cartao").forEach((el) => {
        const a = antes[el.dataset.id]; if (!a) return;
        const b = el.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
        if (!dx && !dy) return;
        el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: "none" }], { duration: 650, easing: "cubic-bezier(.2,.8,.2,1)" });
      });
    }
    $$("#cartoes .cartao").forEach((el) => (el.onclick = () => { S.sel = el.dataset.id; $$("#cartoes .cartao").forEach((x) => x.classList.toggle("sel", x === el)); renderExplica(); }));
    if (r.otimaFora) {
      const o = r.otimaFora, w = R.rotacao.pontuar(o.notas, S.prefs.pesos);
      $("#otima").innerHTML = `<div class="aviso ouro otima" style="margin:0 0 12px">Neste cenário o motor encontrou uma sequência melhor que todas as da tela para os seus pesos: <b>${o.seq.map((x) => SEGUNDA_SAFRA[x].nome).join(" → ")}</b> (${fmt(w, 0)} pontos). <button class="btn mini" id="add-otima">Adicionar à comparação</button></div>`;
      $("#add-otima").onclick = () => {
        S.fixas = S.fixas.filter((f) => f.id !== "otima").concat([{ id: "otima", titulo: "Melhor neste cenário", seq: o.seq }]);
        calcular(); atualizarResultados(true);
      };
    } else $("#otima").innerHTML = "";
    renderExplica();
    atualizarMapaRisco();
  }

  function cartaoHtml(c) {
    const m = c.metricas, n = c.notas, ref = S.posRef[c.id];
    const temCen = S.cen.elNino || S.cen.chuva || S.cen.temp;
    const mov = temCen && ref && ref !== c.posicao ? `<span class="mov ${ref > c.posicao ? "sobe" : "desce"}">${ref > c.posicao ? "▲" : "▼"}${Math.abs(ref - c.posicao)}</span>` : "";
    const cr = R.mapa.classeRisco(m.risco);
    const tipo = { atual: "Identificada pelo satélite, confirmada por você", equilibrio: "Equilibra os 4 objetivos", conservacao: "Prioriza cobertura e ciclagem", resiliencia: "Prioriza água e risco climático", sobmedida: "Ótima para os seus pesos", otima: "Melhor sequência neste cenário" }[c.id] || "";
    const anos = c.seq.map((o, i) => {
      const op = SEGUNDA_SAFRA[o];
      return `<div class="ano"><small>ANO ${i + 1}</small><div class="cult">${ICO.soja}<span>Soja</span></div><div class="mais">+</div><div class="cult">${ICO[op.icone]}<span>${op.nome}</span></div></div>`;
    }).join("");
    const barra = (v, cor) => `<div class="trilho"><i style="width:${Math.max(2, v)}%;background:${cor}"></i></div>`;
    let nino = "";
    if (S.cen.elNino) {
      const rendas = c.porAno.map((a) => a.renda), todos = S.res.cartoes.flatMap((x) => x.porAno.map((a) => a.renda));
      const lo = Math.min(...todos), hi = Math.max(...todos), esc2 = (v) => (100 * (v - lo)) / (hi - lo || 1);
      nino = `<div><small style="font-size:10.5px;color:var(--papel-3)">Quebras por ano análogo (de 3 safras de 2ª safra + soja)</small>
        <div class="anos-elnino">${c.porAno.map((a) => `<span class="q${Math.min(2, a.quebras)}" title="${a.quebras} quebra(s) se os 3 anos fossem como ${a.ano}/${String(a.ano + 1).slice(2)}">${String(a.ano).slice(2)}/${String(a.ano + 1).slice(2)} ${a.quebras ? "✗".repeat(Math.min(3, a.quebras)) : "✓"}</span>`).join("")}</div>
        <small style="font-size:10.5px;color:var(--papel-3);display:block;margin-top:6px">Renda relativa: pior e melhor ano análogo (não é média)</small>
        <div class="disp"><div class="faixa" style="left:${esc2(Math.min(...rendas))}%;width:${Math.max(1, esc2(Math.max(...rendas)) - esc2(Math.min(...rendas)))}%"></div>${rendas.map((v) => `<div class="marca" style="left:${esc2(v)}%"></div>`).join("")}</div>
        <div class="disp-legenda"><span>${fmt(Math.min(...rendas), 2)}</span><span>${fmt(Math.max(...rendas), 2)}</span></div></div>`;
    }
    return `<article class="cartao ${c.recomendada ? "recomendada" : ""} ${S.sel === c.id ? "sel" : ""}" data-id="${c.id}">
      ${c.recomendada ? '<span class="selo">Recomendada pelo Rotare</span>' : ""}
      <div class="cartao-topo"><div><h4>${esc(c.titulo)}${mov}</h4><div class="tipo">${tipo}</div></div><span class="pos">${c.posicao}º</span></div>
      <div class="seq">${anos}</div>
      <div class="indic">
        <div><small>Saúde relativa do solo</small><div class="val"><span class="num">${fmt(n.solo, 0)}</span><em>/100</em></div>${barra(n.solo, "linear-gradient(90deg,#8B5E34,#3DBE7A)")}</div>
        <div><small>Risco climático</small><div class="val"><span class="num" style="color:${cr.cor}">${pct(m.risco)}</span><em>quebra/ano</em></div>${barra(m.risco * 100 * 2, cr.cor)}</div>
        <div><small>Eficiência hídrica</small><div class="val"><span class="num">${fmt(n.agua, 0)}</span><em>/100 · ${pct(m.agua)} da chuva</em></div>${barra(n.agua, "#4C8DF6")}</div>
        <div><small>Renda relativa</small><div class="val"><span class="num">${fmt(n.renda, 0)}</span><em>/100 · índice ${fmt(m.renda, 2)}</em></div>${barra(n.renda, "#E9C46A")}</div>
      </div>
      <div style="font-size:10.5px;color:var(--papel-3)">Solo: nutrientes ${fmt(m.solo.nutrientes * 100, 0)} · pragas ${fmt(m.solo.pragas * 100, 0)} · erosão ${fmt(m.solo.erosao * 100, 0)} · matéria orgânica ${fmt(m.solo.materiaOrganica * 100, 0)}${m.irrigacao > 1 ? ` · irrigação ${fmt(m.irrigacao, 0)} mm/ano` : ""}</div>
      ${nino}
      <div class="pontuacao"><span>Pontuação com os seus pesos</span><span class="num">${fmt(c.pontuacao, 0)}</span></div>
    </article>`;
  }

  function contextoExplica() {
    return { cartoes: S.res.cartoes, pesos: S.res.pesos, anos: S.res.anos, resumo: S.res.resumo, cobertura: "total", laudo: false,
             aoVivo: S.aoVivo, alertasUso: S.raiox.usoAtual ? S.raiox.usoAtual.alertas.map((a) => a.texto) : [] };
  }
  function renderExplica() {
    const c = S.res.cartoes.find((x) => x.id === S.sel);
    if (!c) return;
    const e = R.explica.explicar(c, contextoExplica());
    $("#explica").innerHTML = `<div class="rotulo" style="margin-top:20px">Por que o Rotare ${c.recomendada ? "recomendou" : "avaliou assim"}: <b style="color:var(--papel)">${esc(c.titulo)}</b> <span style="font-size:11px">textos gerados por regras a partir dos números do motor</span></div>
      <div class="explica">
        <div class="bloco porque"><h4>Por quê?</h4><p>${esc(e.porque)}</p></div>
        <div class="bloco benef"><h4>Benefícios</h4><ul>${e.beneficios.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
        <div class="bloco riscos"><h4>Riscos</h4><ul>${e.riscos.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
        <div class="bloco naosabe"><h4>O que não sabemos</h4><ul>${e.naoSabemos.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
      </div>
      <div class="aviso">O Rotare apoia a decisão e não substitui o agricultor nem o agrônomo. Leve esta comparação para a conversa com a sua assistência técnica.</div>`;
  }

  // ===================================================================== 7. mapa inteligente
  function atualizarMapaRisco() {
    if (!S.res || !map.getSource("risco")) return;
    const rec = S.res.cartoes[0];
    R.mapa.atualizarRisco(map, S.anel, rec.metricas.risco);
  }
  function renderMapa() {
    if (!S.res) { irPara(S.raiox ? "prefs" : "talhao"); return; }
    const rec = S.res.cartoes[0], cr = R.mapa.classeRisco(rec.metricas.risco);
    const at = R.mapa.atualizarAtencao(map, S.anel);
    R.mapa.atualizarDeclividade(map);
    if (S.mesNdvi === null) S.mesNdvi = R.zonal.regiao().ndvi.meses.indexOf("2025-01");
    R.mapa.atualizarNdvi(map, S.mesNdvi);
    Object.assign(S.camadas, { risco: true, atencao: true });
    R.mapa.mostrar(map, "risco", true); R.mapa.mostrar(map, "atencao", true);
    atualizarMapaRisco();
    const nDecl = at.filter((f) => f.properties.cor === R.mapa.CORES.amarelo).length, nNat = at.length - nDecl;
    $("#painel-corpo").innerHTML = `<section>
      <div class="sobre">Etapa 6 · Mapa inteligente</div>
      <h2>A recomendação no seu terreno</h2>
      <p class="lead">Ligue e desligue as camadas no canto do mapa. Clique no talhão para ver a recomendação.</p>
      <div class="card" style="border-color:var(--palha)"><h4><span class="ponto" style="background:var(--palha)"></span>${esc(rec.titulo)}</h4>
        <div style="color:var(--papel-2);font-size:13px">${rec.seq.map((o, i) => `Ano ${i + 1}: soja + ${SEGUNDA_SAFRA[o].nome.toLowerCase()}`).join("<br>")}</div>
        <div class="kv" style="margin-top:10px"><span>Risco climático (talhão inteiro, ${S.cen.elNino || S.cen.chuva || S.cen.temp ? "no cenário do simulador" : "clima de referência"})</span><b style="color:${cr.cor}">${cr.nome} · ${pct(rec.metricas.risco)}</b><span>Saúde do solo</span><b>${fmt(rec.notas.solo, 0)}/100</b></div></div>
      <div class="rotulo">Áreas de atenção dentro do talhão</div>
      <div class="kv"><span>Células de ~90 m com declividade &gt; 8%</span><b>${nDecl}</b><span>Células de ~270 m com vegetação nativa (MapBiomas)</span><b>${nNat}</b></div>
      <div class="aviso">O clima tem resolução de 5 a 55 km, então o risco climático vale para o polígono inteiro: o Rotare não inventa zonas dentro do talhão. Só a declividade (90 m) e o uso da terra (270 m) aparecem por célula.</div>
    </section>`;
    rodape(`<button class="btn grande" id="volta-rot">← Voltar às rotações</button>`);
    $("#volta-rot").onclick = () => irPara("rotacoes");
    renderCamadas();
  }
  function popupTalhao(lngLat) {
    const rec = S.res.cartoes[0], cr = R.mapa.classeRisco(rec.metricas.risco);
    const e = R.explica.explicar(rec, contextoExplica());
    new maplibregl.Popup({ maxWidth: "300px" }).setLngLat(lngLat).setHTML(`<div class="popup"><div class="sobre">Recomendada pelo Rotare</div>
      <h4>${esc(rec.titulo)}</h4><p>${rec.seq.map((o) => SEGUNDA_SAFRA[o].nome).join(" → ")} (após a soja)</p>
      <p><b style="color:${cr.cor}">${cr.nome}</b>: quebra em ${pct(rec.metricas.risco)} dos anos · solo ${fmt(rec.notas.solo, 0)}/100 · ${pct(rec.metricas.agua)} da chuva aproveitada</p>
      <p>${esc(e.beneficios[0])}</p></div>`).addTo(map);
  }

  // ----- painel de camadas -----
  function renderCamadas() {
    const el = $("#camadas"), tem = !!S.raiox, L = S.camadas;
    const mes = S.mesNdvi !== null && R.zonal.regiao() ? R.zonal.regiao().ndvi.meses[S.mesNdvi] : null;
    const item = (k, nome, cor, ok = true, extra = "") => `<label class="${ok ? "" : "desab"}"><input type="checkbox" data-c="${k}" ${L[k] ? "checked" : ""} ${ok ? "" : "disabled"}><span class="sw" style="background:${cor}"></span>${nome}${extra}</label>`;
    let leg = "";
    if (L.uso && tem) leg += Object.values(R.zonal.WORLDCOVER).filter((c) => ["urbano", "agua", "mata"].includes(c[2]) && c[0] !== "Mangue").map((c) => `<div><span class="sw" style="background:${c[1]}"></span>${c[0]}</div>`).join("") + `<div><span class="sw" style="background:rgba(233,196,106,.4)"></span>Lavoura, pastagem, solo</div>`;
    if (L.ndvi && tem) leg += `<div>NDVI ${mes ? mes : ""}<span class="rampa" style="background:linear-gradient(90deg,#8B5E34,#E9C46A,#3DBE7A,#126e40)"></span></div>`;
    if (L.declividade && tem) leg += R.mapa.CLASSES_DECL.map((c) => `<div><span class="sw" style="background:rgba(${c[1].slice(0, 3).join(",")},${c[1][3] / 255})"></span>${c[2]}</div>`).join("");
    if (L.risco && S.res) leg += `<div><span class="sw" style="background:#3DBE7A"></span>Favorável (&lt;10% dos anos)</div><div><span class="sw" style="background:#E9C46A"></span>Atenção (10–25%)</div><div><span class="sw" style="background:#E76F51"></span>Risco elevado (&gt;25%)</div>`;
    if (L.atencao && S.res) leg += `<div><span class="sw" style="background:#E9C46A"></span>Declividade &gt; 8%</div><div><span class="sw" style="background:#E76F51"></span>Vegetação nativa</div>`;
    el.innerHTML = `<h4>Camadas <button type="button" id="rec-cam" aria-label="Recolher">${el.classList.contains("recolhida") ? "+" : "−"}</button></h4><div class="corpo">
      ${item("esri", "Imagem de satélite", "#4C8DF6")}
      ${item("nasa", "NASA HLS 30 m (GIBS)", "#4C8DF6", true, L.nasa ? ` <input type="date" id="gibs-data" value="${S.gibsData}" class="sel" style="padding:2px 4px;font-size:10px;margin-left:auto">` : "")}
      ${item("limites", "Limites do talhão", "#E9C46A", S.anel.length >= 3)}
      ${item("uso", "Uso do solo hoje (WorldCover)", "#E76F51", tem && !!R.zonal.regiao().worldcover)}
      ${item("ndvi", "Histórico de vegetação (NDVI)", "#3DBE7A", tem)}
      ${item("declividade", "Relevo e declividade", "#D2A57A", tem)}
      ${item("risco", "Risco climático", "#E76F51", !!S.res)}
      ${item("atencao", "Áreas que demandam atenção", "#E9C46A", !!S.res)}
      ${leg ? `<div class="legenda">${leg}</div>` : ""}
      ${L.nasa ? `<div class="legenda">HLS: passagem a cada 2 a 5 dias; troque a data se vier vazio ou com nuvem.</div>` : ""}</div>`;
    $("#rec-cam").onclick = () => { el.classList.toggle("recolhida"); renderCamadas(); };
    $$("input[data-c]", el).forEach((i) => (i.onchange = () => alternarCamada(i.dataset.c, i.checked)));
    const gd = $("#gibs-data");
    if (gd) gd.onchange = () => { S.gibsData = gd.value; R.mapa.definirGibs(map, "HLS_S30_Nadir_BRDF_Adjusted_Reflectance|12", S.gibsData); };
  }
  function alternarCamada(k, on) {
    S.camadas[k] = on;
    if (k === "esri") R.mapa.mostrar(map, "esri", on);
    if (k === "nasa") R.mapa.definirGibs(map, on ? "HLS_S30_Nadir_BRDF_Adjusted_Reflectance|12" : null, S.gibsData);
    if (k === "limites") editor.visivel(on);
    if (k === "uso") { if (on) R.mapa.atualizarUso(map, S.anel); R.mapa.mostrar(map, "uso", on); }
    if (k === "ndvi") { if (on) { if (S.mesNdvi === null) S.mesNdvi = R.zonal.regiao().ndvi.meses.indexOf("2025-01"); R.mapa.atualizarNdvi(map, S.mesNdvi); } R.mapa.mostrar(map, "ndvi", on); }
    if (k === "declividade") { if (on) R.mapa.atualizarDeclividade(map); R.mapa.mostrar(map, "declividade", on); }
    if (k === "risco") { atualizarMapaRisco(); R.mapa.mostrar(map, "risco", on); }
    if (k === "atencao") { if (on) R.mapa.atualizarAtencao(map, S.anel); R.mapa.mostrar(map, "atencao", on); }
    renderCamadas();
  }

  // ===================================================================== como calculamos
  function comoCalculamos() {
    const cat = Object.values(CULTURAS);
    return `<h3>Como o Rotare calcula</h3><p>Tudo abaixo é determinístico: os mesmos dados e parâmetros dão sempre o mesmo resultado. Nenhuma IA gera números.</p>
      <h4>1. Dados e resolução</h4><table><tr><th>Dado</th><th>Fonte</th><th>Resolução</th><th>Uso</th></tr>
      <tr><td>Vegetação (NDVI)</td><td>NASA MODIS MOD13Q1 + MYD13Q1</td><td>250 m, 16 dias</td><td>histórico de safras</td></tr>
      <tr><td>Imagem do talhão</td><td>NASA HLS (Landsat + Sentinel-2)</td><td>30 m</td><td>visualização</td></tr>
      <tr><td>Chuva diária</td><td>CHIRPS v2.0 · validada com NASA GPM IMERG</td><td>~5 km · 11 km</td><td>balanço hídrico</td></tr>
      <tr><td>Temperatura</td><td>NASA POWER</td><td>~55 km</td><td>ET0, calor, geada</td></tr>
      <tr><td>Umidade do solo</td><td>NASA SMAP L4</td><td>9 km</td><td>contexto (anomalia)</td></tr>
      <tr><td>Solo</td><td>ISRIC SoilGrids 2.0</td><td>250 m</td><td>água disponível</td></tr>
      <tr><td>Relevo</td><td>NASA SRTM</td><td>30 m → 90 m</td><td>declividade, erosão</td></tr>
      <tr><td>Uso da terra</td><td>MapBiomas Coleção 9</td><td>30 m → 270 m</td><td>validação, vegetação nativa</td></tr>
      <tr><td>El Niño</td><td>NOAA CPC ONI</td><td>índice</td><td>anos análogos (ONI ≥ 1,5)</td></tr></table>
      <p>As grades são agregadas ao polígono por estatística zonal (média das células cujo centro cai dentro dele). O clima é regional: vale para o talhão inteiro.</p>
      <h4>2. Balanço hídrico diário (FAO-56)</h4>
      <p>Para cada ano agrícola (1/set a 31/ago) e cada opção: soja semeada no <b>início das chuvas</b> calculado nos dados (≥ 20 mm em 3 dias sem veranico de 10 dias depois, a partir de 15/set) e a 2ª safra logo após a colheita, se couber na janela. Reservatório do solo com <code>CAD = água disponível (mm/m) × profundidade da raiz</code>; <code>ETc = Kc × ET0</code>; <code>Ks = (CAD − Dr) / ((1 − p) CAD)</code> quando a depleção passa de <code>p × CAD</code>; <code>ETa = Ks × ETc</code>.</p>
      <h4>3. Produtividade relativa e risco</h4>
      <p><code>Yr = 1 − Ky (1 − ETa/ETc)</code> (FAO-33). Uma safra comercial “quebra” quando <code>Yr &lt; 0,8</code> ou quando não cabe na janela de plantio. <b>Risco climático</b> = chance média, por ano, de quebrar a soja ou a 2ª safra comercial, nos 30 anos de referência ou nos anos de El Niño.</p>
      <h4>4. Indicadores</h4><ul>
      <li><b>Eficiência hídrica</b>: fração da chuva do ano (mais irrigação) que vira evapotranspiração das culturas. Como essa fração sobe quando chove menos, no simulador a nota compara as combinações dentro do mesmo clima.</li>
      <li><b>Saúde do solo</b> (estrutura do Soil Conditioning Index do USDA-NRCS): média de matéria orgânica (palhada × Yr, em 3 anos, sobre 37,5 t/ha), nutrientes (fixação da soja + ciclagem da 2ª safra), erosão (dias de solo descoberto × fator de declividade) e pragas (alternância de culturas e anos com cobertura).</li>
      <li><b>Renda relativa</b>: índice de margem por cultura (soja = 1) × Yr, somado em 3 anos. Não é preço nem reais.</li></ul>
      <h4>5. Notas de 0 a 100 e ranking</h4>
      <p>Cada nota é a posição entre a pior e a melhor de todas as combinações válidas no clima de referência. Por isso, quando você muda o clima, as notas se movem contra a mesma régua. <code>Pontuação = Σ peso × nota</code> (risco entra como 100 − nota). Os pesos vêm dos seus controles, normalizados para somar 100%.</p>
      <h4>6. Simulador</h4>
      <p>Chuva diária × (1 + Δ); temperatura + ΔT, com <code>ET0 × (Tmed + ΔT + 17,8)/(Tmed + 17,8)</code> (Hargreaves). Tudo é recalculado do zero: início das chuvas, janelas, balanço e notas. No modo El Niño, o motor usa só os anos análogos e mostra cada um separadamente.</p>
      <h4>7. Catálogo agronômico (rascunho a revisar)</h4><table><tr><th>Cultura</th><th>Ciclo</th><th>Kc ini/med/fim</th><th>Ky</th><th>Palhada t/ha</th><th>Janela até</th></tr>
      ${cat.map((c) => `<tr><td>${c.nome}</td><td>${c.fases.reduce((a, b) => a + b, 0)} d</td><td>${c.kc.join(" / ")}</td><td>${c.ky}</td><td>${c.palhada}</td><td>${c.plantioAte ? c.plantioAte.split("-").reverse().join("/") : "–"}</td></tr>`).join("")}</table>
      <p>${esc(R.catalogo.FONTES.kc)} · ${esc(R.catalogo.FONTES.ky)} · ${esc(R.catalogo.FONTES.renda)}</p>
      <h4>8. Limitações</h4><ul><li>Sem laudo, o solo é estimado. Sem histórico de pragas, o índice de pragas é estrutural.</li><li>Os anos são simulados de forma independente (a água não passa de um ano para o outro, pois a seca do inverno esvazia o perfil).</li><li>Os cenários são condicionais (“e se”), não previsões.</li></ul>`;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})(globalThis.Rotare = globalThis.Rotare || {});
