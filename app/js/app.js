// Aviso de SI: arquivo escrito com ajuda de IA (Claude), sob direção do time Datanauts Brasil.
// Jornada: coordenada → fazenda no satélite → talhão → Raio-X → preferências → rotações → simulação → mapa.
(function (R) {
  "use strict";
  const { CULTURAS, SEGUNDA_SAFRA } = R.catalogo;
  const C_PADRAO = globalThis.ROTARE_CLIMA, T = globalThis.ROTARE_TALHOES || [];
  let C = C_PADRAO;          // troca para o pacote ao vivo quando o talhão está fora da região pré-processada
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const fmt = (x, d = 0) => (x === null || x === undefined || Number.isNaN(x) ? "–" : x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const pct = (x, d = 0) => `${fmt(x * 100, d)}%`;
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ICO = R.icones;

  const PASSOS = [
    { id: "local", nome: "Location" }, { id: "talhao", nome: "Field" }, { id: "raiox", nome: "X-Ray" },
    { id: "prefs", nome: "Preferences" }, { id: "rotacoes", nome: "Rotations" }, { id: "mapa", nome: "Map" },
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
    tec: new Set(), // seções de "detalhes técnicos" abertas (sobrevivem aos re-renders)
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
      map.addSource("decisoes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "decisoes-linha", type: "line", source: "decisoes", paint: { "line-color": "#E9C46A", "line-width": 2, "line-dasharray": [2, 1.5], "line-opacity": 0.9 } });
      desenharDecisoes(limparDecisoes());
      renderCamadas();
    });
    $("#btn-decisoes").onclick = abrirDecisoes;
    limparDecisoes();
    setInterval(() => { const antes = lerDecisoes().length, depois = limparDecisoes(); if (depois.length !== antes) desenharDecisoes(depois); }, 60 * 1000);
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
    instalarTecnico();
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
  function modal(html) { const m = $("#modal"); m.innerHTML = `<div class="modal-caixa"><button class="fechar" aria-label="Close">×</button>${html}</div>`; m.classList.remove("oculto"); }
  function fecharModal() { $("#modal").classList.add("oculto"); }

  // ===================================================================== 1. local
  function renderLocal() {
    const G = R.zonal.regiao();
    $("#painel-corpo").innerHTML = `<section>
      <div class="sobre">Step 1 · Location</div>
      <h2>Your farm seen from space</h2>
      <p class="lead">Tell us where the farm is. Rotare zooms the satellite in so you can outline your field.</p>
      <div class="busca"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
        <input class="campo" id="busca" placeholder="Town, farm or “-12.62, -55.97”" autocomplete="off"></div>
      <div class="sugestoes oculto" id="sugestoes"></div>
      <div class="rotulo">Or type the coordinates (decimal degrees, WGS84)</div>
      <div class="linha-campos">
        <input class="campo num" id="lat" type="number" step="0.0001" placeholder="Latitude" value="-12.6000">
        <input class="campo num" id="lon" type="number" step="0.0001" placeholder="Longitude" value="-55.9500">
        <button class="btn ouro" id="ir" type="button">Go</button>
      </div>
      <div class="rotulo">Demo farms <span class="chip ceu">real preprocessed data</span></div>
      <div class="demos">${T.map((t) => {
        const img = t.imagens && t.imagens.itens.find((x) => x.ano === 2023 && x.fase === "soja" && x.arquivo);
        const ha = R.geo.metricas(t.geometria.slice(0, -1)).areaHa;
        return `<button class="demo" type="button" data-demo="${t.id}">${img ? `<img src="data/${img.arquivo}" alt="">` : "<img alt=''>"}
          <div><b>${esc(t.nome)}</b><small>${esc(t.fazenda)} · Sorriso, MT</small><div style="margin-top:5px;display:flex;gap:4px"><span class="chip num">${fmt(ha, 0)} ha</span>${t.irrigado ? '<span class="chip ceu">irrigated</span>' : ""}</div></div>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" opacity=".5"><path d="M9 6l6 6-6 6"/></svg></button>`;
      }).join("")}</div>
      <div class="aviso">In the demo region ${G ? `(${esc(R.zonal.regiaoPadrao().nome)}, dashed blue rectangle)` : ""} the data is ready. Anywhere else, Rotare fetches NDVI, soil, terrain, land use, rain and temperature live for your field (about 20 s the first time).</div>
      <div class="aviso dica-ctx"><b>Tip:</b> right-click anywhere on the map (or long-press on mobile) to drop a 25, 100 or 400 ha field there, or start drawing from that point.</div>
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
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&accept-language=en&q=${encodeURIComponent(q)}`);
      lugares = (await r.json()).map((x) => ({ nome: x.display_name, lat: +x.lat, lon: +x.lon }));
    } catch (e) { /* busca é opcional; coordenadas continuam funcionando */ }
    const itens = [...demos, ...lugares];
    if (!itens.length) { box.innerHTML = `<button type="button" disabled>Nothing found. Try “Sorriso, MT” or coordinates.</button>`; box.classList.remove("oculto"); return; }
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
    menu.innerHTML = `<div class="mc-topo"><b id="mc-nome">This point</b><code>${txt}</code></div>
      <div class="mc-rot">Drop a field here</div>
      <div class="mc-tam">${TAMANHOS.map(([ha, l]) => `<button type="button" role="menuitem" data-a="quad" data-l="${l}"><b>${ha} ha</b><small>${l >= 1000 ? l / 1000 + " km" : l + " m"} per side</small></button>`).join("")}</div>
      <div class="mc-rot">Draw from here</div>
      <button type="button" role="menuitem" data-a="ret">${IC.ret}Rectangle (click the opposite corner)</button>
      <button type="button" role="menuitem" data-a="pol">${IC.pol}Polygon (this is the 1st vertex)</button>
      <div class="mc-sep"></div>
      ${dentro && S.passo === "talhao" ? `<button type="button" role="menuitem" data-a="analisar">${IC.lupa}Analyze this field</button>` : ""}
      <button type="button" role="menuitem" data-a="voar">${IC.mira}Zoom in here</button>
      <button type="button" role="menuitem" data-a="copiar">${IC.copiar}Copy coordinates</button>`;
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
    $$("button", menu).forEach((b) => (b.onclick = () => { fecharMenuContexto(); acaoMenu(b.dataset.a, lon, lat, +b.dataset.l, txt); }));
    // nome do lugar (mesmo serviço da busca); se falhar, fica só a coordenada
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&accept-language=en&lat=${lat}&lon=${lon}`)
      .then((res) => res.json())
      .then((j) => {
        const el = $("#mc-nome"), a = j && j.address;
        if (el && a) el.textContent = [a.city || a.town || a.village || a.municipality || a.county, a.state].filter(Boolean).join(", ") || "This point";
      })
      .catch(() => {});
  }
  async function acaoMenu(a, lon, lat, lado, txt) {
    if (a === "copiar") { try { await navigator.clipboard.writeText(txt); toast(`Copied: ${txt}`); } catch (e) { toast(txt, 5000); } return; }
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
      toast("Field placed. Drag the corners to match the real field edge.", 4000);
    } else if (a === "ret") {
      editor.iniciarRetanguloEm([lon, lat]);
      toast("Move the mouse and click the opposite corner of the field.", 4000);
    } else if (a === "pol") {
      editor.iniciarPoligonoEm([lon, lat]);
      toast("Click the next vertices. Double-click or Enter closes the polygon.", 4500);
    }
  }

  let marcador;
  // Mesmo voo suave do restante do app (flyTo), enquadrando uma área inteira.
  function voarParaArea(bbox) {
    const movel = window.innerWidth < 860;
    const padding = movel ? { top: 70, bottom: window.innerHeight * 0.62 + 20, left: 30, right: 30 } : { top: 90, bottom: 60, left: 480, right: 290 };
    let cam;
    try { cam = map.cameraForBounds(bbox, { padding, maxZoom: 15 }); } catch (e) { cam = null; }
    if (!cam) return;
    map.flyTo({ center: cam.center, zoom: cam.zoom, bearing: 0, pitch: 0, speed: 0.7, curve: 1.6, essential: true });
  }
  function voarPara(lat, lon, zoom = 14.2) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { toast("Invalid coordinates"); return Promise.resolve(); }
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
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { toast("Invalid coordinates"); return; }
    toast(`${nome ? nome.split(",")[0] + " · " : ""}${lat.toFixed(5)}, ${lon.toFixed(5)}`, 4000);
    S.demo = null;
    await voarPara(lat, lon);
    irPara("talhao");
    toast("Now draw the field: click and drag over the area", 3500);
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
    toast(`${t.nome} loaded. Adjust the vertices if you like.`);
  }

  // ===================================================================== 2. talhão
  function renderTalhao() {
    $("#ferramentas").innerHTML = `
      <button type="button" data-f="retangulo" title="Draw rectangle"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="6" width="16" height="12" rx="1"/></svg><span>Rectangle</span></button>
      <button type="button" data-f="poligono" title="Draw polygon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 8l7-4 8 5-2 10H7z"/></svg><span>Polygon</span></button>
      <button type="button" data-f="livre" title="Adjust vertices one by one"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="7" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="17" cy="19" r="2"/><path d="M7 7l10-2M18 7l-1 10"/></svg><span>Free vertices</span></button>
      <div class="sep"></div>
      <button type="button" data-f="desfazer" title="Undo (Ctrl+Z)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg></button>
      <button type="button" data-f="refazer" title="Redo (Ctrl+Y)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/></svg></button>
      <button type="button" data-f="limpar" title="Clear"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg><span>Clear</span></button>`;
    $$("#ferramentas button").forEach((b) => (b.onclick = () => ferramenta(b.dataset.f)));
    if (editor && editor.anel.length < 3 && editor.modo === "nenhum") editor.iniciar("retangulo");
    atualizarTalhao();
  }
  function ferramenta(f) {
    if (["retangulo", "poligono", "limpar"].includes(f)) S.demo = null;
    if (f === "retangulo" || f === "poligono") editor.iniciar(f);
    else if (f === "livre") { editor.liberarVertices(); toast("Now each vertex moves on its own. Drag the midpoints to add new vertices."); }
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
    S.local = { k, nome: "Looking up location…" };
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&accept-language=en&lat=${met.centroide[1]}&lon=${met.centroide[0]}`)
      .then((r) => r.json()).then((j) => {
        const a = j.address || {};
        S.local = { k, nome: [a.city || a.town || a.village || a.municipality || a.county, a.state, a.country].filter(Boolean).join(", ") || "Unnamed place" };
        if (S.passo === "talhao") atualizarTalhao();
      }).catch(() => { S.local = { k, nome: "Location unavailable offline" }; });
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
      retangulo: "Click and drag over the crop area to draw the rectangle. Right-click the map: drop a ready-made field there",
      poligono: "Click for each vertex. Close on the first point, with a double-click or Enter",
      editar: editor.retangulo ? "Drag the corners to resize, the center to move, the midpoints for new vertices"
        : "Drag vertices and midpoints. Double-click a vertex to remove it. Drag the inside to move",
      nenhum: "Choose Rectangle or Polygon, or right-click the map",
    }[modo];
    S.modo = m ? modoDados(m.anel) : null;
    const semServidor = S.modo === "aovivo" && S.servidor === false;
    const coberturaTxt = { padrao: ["broto", "Preprocessed region"], aovivo_pronto: ["ceu", "Live data already loaded"],
      aovivo: semServidor ? ["seca", "Data server is off"] : ["ceu", "Data fetched live (~20 s)"] };
    const [cc, ct] = m ? coberturaTxt[S.modo] : ["", ""];
    $("#painel-corpo").innerHTML = `<section>
      <div class="sobre">Step 2 · Field outline</div>
      <h2>${S.demo && m ? esc(S.demo.nome) : "Draw your field"}</h2>
      <p class="lead">${m ? "The area is calculated on the WGS84 ellipsoid as you edit." : "Use the tools at the top of the map. Drawing uses real geographic coordinates."}</p>
      ${m ? `<div class="metricas">
        <div class="metrica destaque"><small>Total area</small><span class="num">${fmt(m.areaHa, 1)}<em>ha</em></span></div>
        <div class="metrica"><small>Area</small><span class="num">${fmt(m.areaM2, 0)}</span> <small style="display:inline">m²</small></div>
        <div class="metrica"><small>Perimeter</small><span class="num">${fmt(m.perimetroKm, 2)}</span> <small style="display:inline">km</small></div>
        <div class="metrica"><small>Center (lat, lon)</small><span class="num" style="font-size:13px">${m.centroide[1].toFixed(5)}, ${m.centroide[0].toFixed(5)}</span></div>
        <div class="metrica"><small>Vertices</small><span class="num">${m.vertices}</span></div>
      </div>
      <div class="rotulo">Location <span class="chip ${cc}">${ct}</span></div>
      <div style="color:var(--papel-2)">${esc(localizacao(m))}</div>
      ${m.autoIntersecao ? `<div class="aviso seca">The polygon crosses itself. Move the vertices to undo the crossing before analyzing.</div>` : ""}
      ${m.pequeno ? `<div class="aviso seca">Area under 0.5 ha: too small for the satellite grids.</div>` : ""}
      ${S.modo === "aovivo" && !semServidor ? `<div class="aviso">Outside the preprocessed region: when you analyze, Rotare fetches the same data (NDVI, land use, soil, terrain, rain and temperature) for this polygon from Google Earth Engine and NASA POWER.</div>` : ""}
      ${semServidor ? `<div class="aviso seca">To analyze outside Sorriso, the data server must be running: in the <code>rotare/app</code> folder, run <code>python servidor.py</code> in the environment that has Earth Engine. The published version (no server) only analyzes the demo region.</div>` : ""}
      <details><summary>Vertex coordinates (${m.vertices})</summary><div class="coords">${m.anel.slice(0, -1).map((p, i) => `${i + 1}. ${p[1].toFixed(6)}, ${p[0].toFixed(6)}`).join("<br>")}</div></details>`
      : `<div class="aviso">Tip: click a demo field (blue outline) to load a real field in Sorriso.</div>`}
    </section>`;
    rodape(`<button class="btn ouro grande" id="analisar" ${m && m.valido && !semServidor ? "" : "disabled"}>ANALYZE MY FIELD</button>`);
    $("#analisar").onclick = analisar;
  }

  // ===================================================================== 3. análise
  async function buscarAoVivo() {
    const [w, s, e, n] = S.met.bbox;
    const r = await fetch(`api/pacote?w=${w}&s=${s}&e=${e}&n=${n}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.erro || "failed to fetch data");
    j.regiao.aoVivo = true;
    if (S.local && S.local.nome && !S.local.nome.startsWith("Looking up")) j.regiao.nome = S.local.nome;
    R.zonal.definirRegiao(j.regiao); R.mapa.trocarRegiaoMapa(map);
    C = { ...j.clima, enso_safra: C_PADRAO.enso_safra };
    S.imagensLive = j.imagens; S.aoVivo = true;
    return `${j.segundos ? fmt(j.segundos, 0) + " s on Earth Engine" : "from local cache"} · NDVI, land use, soil, terrain, rain and temperature`;
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
      ["Identifying the selected area", () => `${fmt(S.met.areaHa, 1)} ha · ${S.met.vertices} vertices · ${modo === "padrao" ? "preprocessed region" : "outside the preprocessed region"}`],
      ...(modo === "aovivo" ? [["Fetching satellite data for this area live", buscarAoVivo]] : []),
      ["Reading satellite history and land use", () => {
        const n = R.zonal.serieNdvi(S.anel), u = R.zonal.usoTerra(S.anel), a = R.zonal.usoAtual(S.anel);
        S.raiox = { ndvi: n, uso: u, usoAtual: a };
        return `NDVI MODIS: ${n.celulas} cells × ${n.serie.length} months${u ? ` · MapBiomas ${u[0].ano}–${u[u.length - 1].ano}` : ""}${a ? ` · WorldCover: ${Math.round(a.agricola * 100)}% farmland, ${Math.round(a.urbano * 100)}% built-up` : ""}`;
      }],
      ["Analyzing rainfall and climate", () => { S.raiox.clima = resumoClima(); return `${S.raiox.clima.nAnos} seasons of CHIRPS daily rain · NASA POWER temperature`; }],
      ["Reading soil properties", () => { S.raiox.solo = R.zonal.solo(S.anel); S.raiox.relevo = R.zonal.relevo(S.anel); if (!S.raiox.solo) return `SoilGrids: no soil mapped in the area (city or water) · SRTM: ${S.raiox.relevo.celulas} cells`; return `SoilGrids: ${S.raiox.solo.vizinho ? "neighboring cell " + fmt(S.raiox.solo.vizinho.distanciaKm, 1) + " km away" : S.raiox.solo.celulas + " cells"} · SRTM: ${S.raiox.relevo.celulas} cells of 90 m`; }],
      ["Calculating environmental indicators", () => { S.raiox.agua = resumoAgua(); if (!S.raiox.solo) return `SMAP ${S.raiox.agua.nMeses} months · no soil, no available water`; return `Available water ${fmt(S.raiox.solo.cad, 0)} mm/m · SMAP ${S.raiox.agua.nMeses} months`; }],
      ["Preparing the rotation strategies", () => {
        S.safras = R.historico.inferirSafras(S.raiox.ndvi.serie, S.raiox.uso);
        S.atual = R.historico.rotacaoAtual(S.safras); S.atualConfirmada = false;
        if (!S.raiox.solo) { S.raiox.ref = null; return `${S.safras.length} seasons read · rotations not calculated: no farmland soil mapped`; }
        S.raiox.ref = R.rotacao.resumirOpcoes(R.rotacao.simularOpcoes(C, soloMotor(), S.prefs.irrigado, null));
        return `${S.safras.length} seasons inferred · ${R.rotacao.ANOS_REFERENCIA} years × 7 options simulated day by day`;
      }],
    ];
    ov.innerHTML = `<div class="analise-caixa"><div class="sobre">Field X-Ray</div><h3>Analyzing ${fmt(S.met.areaHa, 1)} ha</h3>
      <p>Every step below really runs on your polygon's data.</p>
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
      ov.classList.add("oculto"); modal(`<h3>Could not analyze</h3><p>${esc(e.message)}</p><p>If the area is outside Sorriso, check that the server (<code>python servidor.py</code>) is running and has Earth Engine access.</p>`); return;
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
    const dataMedia = (dia) => new Date(Date.UTC(2001, 8, 1 + Math.round(dia))).toLocaleDateString("en-US", { day: "2-digit", month: "short", timeZone: "UTC" });
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
    return { nMeses: meses.length, anomalia: anom, periodoAnom: `${ult[0]} to ${ult[ult.length - 1]}`, sazonal, inicio: meses[0], fim: meses[meses.length - 1] };
  }

  // ===================================================================== detalhes técnicos (expandir)
  // Resumo simples sempre visível; fontes, métricas e métodos ficam atrás de "Ver detalhes técnicos".
  function tecnico(k, rotulo, html) {
    return `<details class="tecnico" data-k="${k}" ${S.tec.has(k) ? "open" : ""}><summary><span>${rotulo}</span></summary><div class="tecnico-corpo">${html}</div></details>`;
  }
  function instalarTecnico() {
    document.addEventListener("toggle", (ev) => {
      const d = ev.target;
      if (!d.matches || !d.matches("details.tecnico")) return;
      if (d.open) S.tec.add(d.dataset.k); else S.tec.delete(d.dataset.k);
      // os detalhes dos cartões abrem e fecham juntos, para os cartões ficarem com a mesma altura
      if (d.dataset.k === "cartoes") $$('details.tecnico[data-k="cartoes"]').forEach((x) => { if (x.open !== d.open) x.open = d.open; });
      atualizarBotaoTec();
    }, true);
  }
  const botaoTec = () => `<button class="btn mini tec-todos" id="tec-todos" type="button" aria-pressed="false"></button>`;
  function ligarBotaoTec() {
    const b = $("#tec-todos"); if (!b) return;
    b.onclick = () => { const ds = $$("#painel-corpo details.tecnico"), abrir = ds.some((d) => !d.open); ds.forEach((d) => { d.open = abrir; }); };
    atualizarBotaoTec();
  }
  function atualizarBotaoTec() {
    const b = $("#tec-todos"); if (!b) return;
    const ds = $$("#painel-corpo details.tecnico"), todos = ds.length > 0 && ds.every((d) => d.open);
    b.textContent = todos ? "Hide technical details" : "Show all technical details";
    b.setAttribute("aria-pressed", String(todos));
  }
  function resumoItem(cor, rotulo, valor, frase, estado) {
    return `<div class="resumo-item ${estado || ""}"><span class="resumo-rot"><i style="background:${cor}"></i>${rotulo}</span><b>${valor}</b><p>${frase}</p></div>`;
  }

  // ===================================================================== 4. raio-x
  const MESES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function ensoDe(ano) { return C.enso_safra[ano] ? C.enso_safra[ano].fase : null; }
  function renderRaiox() {
    const X = S.raiox, m = S.met;
    if (!X) { irPara("talhao"); return; }
    const so = X.solo, rel = X.relevo, cl = X.clima, ag = X.agua;
    const nativa = X.uso ? X.uso[X.uso.length - 1].fracaoNativa : 0;
    const UA = X.usoAtual;
    const milhoFalha = X.ref ? X.ref.milho.falha : null;
    const opcoes = Object.entries(SEGUNDA_SAFRA).map(([k, v]) => `<option value="${k}">Soybean + ${v.nome}</option>`).join("");
    const ult3 = S.safras.filter((s) => s.opcao).slice(-3);
    const imgs = S.demo && S.demo.imagens ? S.demo.imagens.itens.filter((x) => x.arquivo)
      : (S.aoVivo && S.imagensLive ? S.imagensLive.itens : []);
    // resumo em linguagem simples (os números completos ficam nos detalhes técnicos)
    const resumo = [];
    if (so) {
      const [frase, est] = so.cad >= 130 ? ["Holds rainwater well", "bom"] : so.cad >= 90 ? ["Holds water moderately", "atencao"] : ["Holds little water: drought hits harder", "ruim"];
      resumo.push(resumoItem("var(--terra)", "Soil", esc(so.textura), frase, est));
    } else resumo.push(resumoItem("var(--terra)", "Soil", "No farmland soil", "No cropland soil is mapped in this area", "ruim"));
    resumo.push(resumoItem("var(--ceu)", "Rain", `${fmt(cl.chuvaAnual, 0)} mm/year`, `On average it rains from ${cl.inicio} to ${cl.fim}`, ""));
    if (milhoFalha !== null) {
      const est = milhoFalha > 0.2 ? "ruim" : milhoFalha > 0.08 ? "atencao" : "bom";
      resumo.push(resumoItem("var(--seca)", "Drought in second-crop corn", `${pct(milhoFalha)} of years`, { ruim: "High risk of second-crop failure", atencao: "Moderate risk of second-crop failure", bom: "Low risk of second-crop failure" }[est], est));
    } else {
      const seco = ag.anomalia < -0.1;
      resumo.push(resumoItem("var(--ceu)", "Soil moisture", `${ag.anomalia >= 0 ? "+" : ""}${pct(ag.anomalia, 0)}`, seco ? "Drier than normal over the last year" : "Close to normal over the last year", seco ? "atencao" : "bom"));
    }
    const forma = rel.declividade < 3 ? "Flat" : rel.declividade < 8 ? "Gently rolling" : "Rolling";
    resumo.push(resumoItem("#D2A57A", "Terrain", forma, rel.fracaoAtencao > 0.1 ? `Erosion caution on ${pct(rel.fracaoAtencao)} of the area` : "Low erosion risk", rel.fracaoAtencao > 0.1 ? "atencao" : "bom"));
    const ult = X.uso ? X.uso[X.uso.length - 1] : null;
    $("#painel-corpo").innerHTML = `<section>
      <div class="cab-etapa"><div>
        <div class="sobre">Step 3 · Field X-Ray</div>
        <h2>${S.demo ? esc(S.demo.nome) : "Your field"} · <span class="num">${fmt(m.areaHa, 1)} ha</span></h2>
        <p class="lead">${esc(R.zonal.regiao().nome)}. A summary of what satellites show about this area.${S.aoVivo ? ' <span class="chip ceu">live data</span>' : ""}</p>
      </div>${botaoTec()}</div>

      ${UA ? `<div class="card" style="margin-bottom:10px;${UA.bloqueio ? "border-color:var(--seca)" : ""}">
        <h4><span class="ponto" style="background:${UA.bloqueio ? "var(--seca)" : "var(--broto)"}"></span>What is in this area today</h4>
        <div class="barra-pesos" style="height:14px;margin:0 0 10px">${UA.classes.map((c) => `<div title="${esc(c.nome)} ${Math.round(c.fracao * 100)}%" style="flex:${c.fracao};background:${c.cor}"></div>`).join("")}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13px;color:var(--papel-2)">${UA.classes.filter((c) => c.fracao >= 0.01).map((c) => `<span><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${c.cor};margin-right:5px"></span>${esc(c.nome)} <b class="num">${Math.round(c.fracao * 100)}%</b></span>`).join("")}</div>
        ${UA.alertas.map((a) => `<div class="aviso ${a.nivel === "bloqueio" ? "seca" : "ouro"}">${esc(a.texto)}</div>`).join("")}
        ${UA.naoAgricola ? `<div class="aviso seca"><b>This area does not look like cropland:</b> only ${Math.round(UA.agricola * 100)}% of the polygon is cropland, pasture or bare soil. Rotation advice makes no sense for houses, forest or water. Redraw the field over the farmed part.</div>` : ""}
        ${tecnico("uso", "See technical details", `<div class="fonte"><span>${esc(UA.fonte)} · ${UA.celulas} cells${ult ? ` · MapBiomas ${ult.ano}: ${esc(ult.nome)} (${Math.round(ult.fracao * 100)}%)` : ""}</span><span class="conf alta">observed</span><span>“Land use today” layer on the map.</span></div>`)}
      </div>` : ""}

      <div class="rotulo" style="margin-top:6px">Field summary</div>
      <div class="resumo-grade">${resumo.join("")}</div>
      ${nativa > 0 ? `<div class="aviso seca">${pct(nativa)} of the area shows as native vegetation. That part is not farmed: see the “Areas that need attention” layer on the map.</div>` : ""}
      ${tecnico("indicadores", "See technical numbers for soil, climate, water and terrain", `<div class="grade-cards">
        ${!so ? `<div class="card" style="border-color:var(--seca)"><h4><span class="ponto" style="background:var(--seca)"></span>Soil</h4>
          <p style="color:var(--papel-2);font-size:13px;margin:0">No farmland soil is mapped in this area: SoilGrids does not estimate soil under cities, buildings and water. That is why Rotare does not calculate rotations here.</p>
          <div class="fonte"><span>ISRIC SoilGrids 2.0 · 250 m</span><span class="conf alta">no soil</span></div></div>` : `<div class="card"><h4><span class="ponto" style="background:var(--terra)"></span>Soil</h4><div class="kv">
          <span>Texture (0–30 cm)</span><b>${so.textura}</b>
          <span>Sand · clay</span><b>${fmt(so.areia, 0)}% · ${fmt(so.argila, 0)}%</b>
          <span>Organic carbon</span><b>${fmt(so.carbono, 1)} g/kg</b>
          <span>Available water</span><b>${fmt(so.cad, 0)} mm/m</b>
          <span>Nutrients (N, P, K)</span><b style="color:var(--papel-3)">no soil test</b></div>
          <div class="fonte"><span>ISRIC SoilGrids 2.0 · 250 m · ${so.vizinho ? `no estimate inside the polygon (city or water): used the nearest cell with data, ${fmt(so.vizinho.distanciaKm, 1)} km away` : `${so.celulas} cells`} · available water by Saxton & Rawls (2006)</span><span class="conf baixa">estimate</span></div></div>`}
        <div class="card"><h4><span class="ponto" style="background:var(--ceu)"></span>Climate</h4><div class="kv">
          <span>Average annual rain</span><b>${fmt(cl.chuvaAnual, 0)} mm</b>
          <span>Average temperature</span><b>${fmt(cl.tmed, 1)} °C</b>
          <span>Rainy season start (avg.)</span><b>${cl.inicio}</b>
          <span>Rainy season end (avg.)</span><b>${cl.fim}</b></div>
          ${barrasMensais(cl.mensal)}
          <div class="fonte"><span>CHIRPS daily (~5 km) · NASA POWER (~55 km) · ${cl.nAnos} seasons (${cl.anos[0]}/${String(cl.anos[0] + 1).slice(2)} to ${cl.anos[cl.anos.length - 1]}/${String(cl.anos[cl.anos.length - 1] + 1).slice(2)})${cl.imerg ? ` · NASA IMERG check ${cl.imerg.anos[0]}–${cl.imerg.anos[cl.imerg.anos.length - 1]}: ${fmt(cl.imerg.imerg, 0)} mm/year vs. ${fmt(cl.imerg.chirps, 0)} from CHIRPS` : ""}</span><span class="conf media">regional</span></div></div>
        <div class="card"><h4><span class="ponto" style="background:var(--ceu)"></span>Water</h4><div class="kv">
          <span>Root-zone moisture</span><b>${ag.anomalia >= 0 ? "+" : ""}${pct(ag.anomalia, 0)} vs. average</b>
          <span>Anomaly period</span><b style="font-size:11px">${ag.periodoAnom}</b>
          ${milhoFalha === null ? "" : `<span>Second-crop corn failure</span><b style="color:${milhoFalha > 0.2 ? "var(--seca)" : milhoFalha > 0.08 ? "var(--palha)" : "var(--broto)"}">${pct(milhoFalha)} of years</b>`}
          <span>Irrigation</span><b>${S.prefs.irrigado ? "yes (reported)" : "not reported"}</b></div>
          ${sazonalSmap(ag.sazonal)}
          <div class="fonte"><span>NASA SMAP L4 (9 km, ${ag.inicio} to ${ag.fim}) · failure = relative yield &lt; 80% in the FAO-56 water balance with this field's soil</span><span class="conf media">model</span></div></div>
        <div class="card"><h4><span class="ponto" style="background:#D2A57A"></span>Terrain</h4><div class="kv">
          <span>Average elevation</span><b>${fmt(rel.altitude, 0)} m</b>
          <span>Range</span><b>${fmt(rel.altMin, 0)}–${fmt(rel.altMax, 0)} m</b>
          <span>Average slope</span><b>${fmt(rel.declividade, 1)}%</b>
          <span>Maximum slope</span><b>${fmt(rel.declMax, 1)}%</b>
          <span>Erosion caution</span><b style="color:${rel.fracaoAtencao > 0.1 ? "var(--seca)" : "var(--broto)"}">${rel.fracaoAtencao > 0 ? pct(rel.fracaoAtencao) + " of area > 8%" : "low"}</b>
          <span>Native vegetation in polygon</span><b style="color:${nativa > 0 ? "var(--seca)" : "var(--broto)"}">${nativa > 0 ? pct(nativa) : "not detected"}</b></div>
          <div class="fonte"><span>NASA SRTM 30 m → ~90 m · ${rel.celulas} cells${X.uso ? ` · native: MapBiomas ${X.uso[X.uso.length - 1].ano}` : " · MapBiomas only covers Brazil"}</span><span class="conf alta">high</span></div></div>
        <div class="card"><h4><span class="ponto" style="background:var(--papel-3)"></span>Location</h4><div class="kv">
          <span>Field center</span><b>${m.centroide[1].toFixed(4)}, ${m.centroide[0].toFixed(4)}</b>
          <span>Area</span><b>${fmt(m.areaHa, 1)} ha</b>
          <span>Vertices</span><b>${m.vertices}</b></div></div>
      </div>`)}

      <div class="card" style="margin-top:14px">
        <h4><span class="ponto" style="background:var(--ceu)"></span>The last 10 years seen from space</h4>
        <p class="explica-curta">Each green peak is a crop growing. Orange bands mark <b style="color:#F2A08A">strong El Niño</b> years. Tap a point on the chart to see that month on the map.</p>
        ${graficoNdvi(X.ndvi.serie)}
        ${tecnico("historico", "See season by season and satellite images", `
          <div class="fonte" style="margin-top:0;border-top:0;padding-top:0"><span>NDVI: ${esc(X.ndvi.fonte)} · average of ${X.ndvi.celulas} cells (~270 m)${X.ndvi.aproximado ? " · field smaller than a cell: nearest cell value" : ""}</span><span class="conf media">medium confidence</span></div>
          <div class="safras">${S.safras.map((s) => `<div class="safra ${ensoDe(s.ano) === "el_nino_forte" ? "elnino" : ""}">
            <b>${s.safra}</b> ${ensoDe(s.ano) === "el_nino_forte" ? '<span class="chip seca" style="font-size:9px;padding:1px 5px">Strong El Niño</span>' : ""}
            <p>${esc(s.texto)}</p><p style="color:var(--papel-3);font-size:11px">summer peak ${fmt(s.verao, 2)} · second crop ${fmt(s.segunda, 2)}${s.mapbiomas ? ` · MapBiomas: ${esc(s.mapbiomas)}` : ""}</p></div>`).join("")}</div>
          ${imgs.length ? `<div class="rotulo">The field from above (NASA HLS 30 m), soybean and second-crop peaks</div>
            <div class="tira">${imgs.map((x) => `<figure class="${ensoDe(x.ano) === "el_nino_forte" ? "elnino" : ""}"><img loading="lazy" src="${x.url || "data/" + x.arquivo}" alt="${{ soja: "soybean", safrinha: "second crop" }[x.fase] || x.fase} ${x.ano}"><figcaption><span>${String(x.ano).slice(2)}/${String(x.ano + 1).slice(2)}</span><span>${{ soja: "soybean", safrinha: "second crop" }[x.fase] || x.fase}</span></figcaption></figure>`).join("")}</div>
            <div class="fonte"><span>NASA HLS v2.0 (HLSL30 + HLSS30), cloud-free median, via Google Earth Engine. Orange border: strong El Niño.</span></div>` : ""}`)}
      </div>

      <div class="card" style="margin-top:10px">
        <h4><span class="ponto" style="background:var(--palha)"></span>Confirm what you planted</h4>
        <p class="explica-curta">According to the satellite, these were the last 3 seasons. Fix them if they are wrong: this becomes “Your current rotation” in the comparison.</p>
        <div class="confirma">${S.atual.map((o, i) => `<label>${ult3[i] ? ult3[i].safra : `year ${i + 1}`}<select data-ano="${i}">${opcoes}</select></label>`).join("")}</div>
        <div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn mini ${S.atualConfirmada ? "on" : ""}" id="confirmar">${S.atualConfirmada ? "✓ Confirmed" : "I confirm this history"}</button><span style="font-size:12px;color:var(--papel-3)">The satellite cannot tell corn, sorghum and millet apart.</span></div>
      </div>
    </section>`;
    ligarBotaoTec();
    $$(".confirma select").forEach((s) => { s.value = S.atual[+s.dataset.ano]; s.onchange = () => { S.atual[+s.dataset.ano] = s.value; S.atualConfirmada = true; S.fixas = null; S.res = null; $("#confirmar").textContent = "✓ Confirmed"; $("#confirmar").classList.add("on"); }; });
    $("#confirmar").onclick = () => { S.atualConfirmada = true; $("#confirmar").textContent = "✓ Confirmed"; $("#confirmar").classList.add("on"); };
    $$(".ponto-ndvi").forEach((p) => (p.onclick = () => { verNdvi(+p.dataset.i); }));
    if (!so) {
      rodape(`<button class="btn ouro grande" id="redesenhar">Redraw the field over the farmed area</button>`);
      $("#redesenhar").onclick = () => { irPara("talhao"); alternarCamada("uso", true); };
      S.alcancado.delete("prefs"); renderPassos();
    } else if (UA && UA.bloqueio && !S.forcar) {
      rodape(`<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button class="btn grande" id="redesenhar">Redraw the field</button><button class="btn grande" id="forcar" style="border-color:var(--seca);color:#F2A08A">Analyze anyway</button></div>`);
      $("#redesenhar").onclick = () => { irPara("talhao"); alternarCamada("uso", true); };
      $("#forcar").onclick = () => { S.forcar = true; irPara("prefs"); };
    } else {
      rodape(`<button class="btn ouro grande" id="ir-prefs">Set my priorities →</button>`);
      $("#ir-prefs").onclick = () => irPara("prefs");
    }
    if (UA && UA.urbano + UA.agua + UA.mata > 0.05) { S.camadas.uso = true; R.mapa.atualizarUso(map, S.anel); R.mapa.mostrar(map, "uso", true); renderCamadas(); }
  }
  function verNdvi(i) {
    S.mesNdvi = i; S.camadas.ndvi = true;
    const mes = R.mapa.atualizarNdvi(map, i);
    R.mapa.mostrar(map, "ndvi", true); renderCamadas();
    toast(`NDVI for ${MESES[+mes.slice(5) - 1]}/${mes.slice(0, 4)} on the map (MODIS ~270 m)`);
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
    return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly NDVI series">
      <defs><linearGradient id="gndvi" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3DBE7A" stop-opacity=".35"/><stop offset="1" stop-color="#3DBE7A" stop-opacity="0"/></linearGradient></defs>
      ${faixas}${grade}<path d="${d}L${x(n - 1)},${H - p.b}L${x(0)},${H - p.b}Z" fill="url(#gndvi)"/>
      <path d="${d}" fill="none" stroke="#3DBE7A" stroke-width="1.8"><animate attributeName="stroke-dasharray" from="0 3000" to="3000 0" dur="1.6s" fill="freeze"/></path>${rot}${pts}</svg>`;
  }
  function barrasMensais(v) {
    const W = 260, H = 70, mx = Math.max(...v), nomes = ["S", "O", "N", "D", "J", "F", "M", "A", "M", "J", "J", "A"], bw = W / 12;
    return `<svg class="grafico" viewBox="0 0 ${W} ${H}" style="margin-top:10px" role="img" aria-label="Average monthly rain">${v.map((x, i) => {
      const h = (x / mx) * (H - 16);
      return `<rect x="${i * bw + 3}" y="${H - 12 - h}" width="${bw - 6}" height="${h}" rx="2" fill="#4C8DF6" opacity=".8"><title>${fmt(x, 0)} mm</title></rect><text x="${i * bw + bw / 2}" y="${H - 2}" text-anchor="middle">${nomes[i]}</text>`;
    }).join("")}</svg>`;
  }
  function sazonalSmap(s) {
    const W = 260, H = 60, vs = s.map((x) => x.raiz), mn = Math.min(...vs), mx = Math.max(...vs);
    const x = (i) => 8 + (i / 11) * (W - 16), y = (v) => 6 + (1 - (v - mn) / (mx - mn || 1)) * (H - 22);
    return `<svg class="grafico" viewBox="0 0 ${W} ${H}" style="margin-top:10px" role="img" aria-label="Average monthly soil moisture"><path d="${s.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.raiz)}`).join("")}" fill="none" stroke="#4C8DF6" stroke-width="1.8"/>${s.map((p, i) => `<text x="${x(i)}" y="${H - 2}" text-anchor="middle">${MESES[p.mes - 1][0].toUpperCase()}</text>`).join("")}</svg>`;
  }

  // ===================================================================== 5. preferências
  const EIXOS = [
    { id: "solo", nome: "Soil protection and recovery", cor: "#8B5E34", ico: "solo" },
    { id: "risco", nome: "Lower climate risk", cor: "#E76F51", ico: "risco" },
    { id: "agua", nome: "Water use efficiency", cor: "#4C8DF6", ico: "agua" },
    { id: "renda", nome: "Relative profitability", cor: "#E9C46A", ico: "renda" },
  ];
  function renderPrefs() {
    if (!S.raiox || !S.raiox.solo) { irPara(S.raiox ? "raiox" : "talhao"); return; }
    const P = S.prefs;
    $("#painel-corpo").innerHTML = `<section>
      <div class="sobre">Step 4 · Preferences</div>
      <h2>The decision is yours</h2>
      <p class="lead">Tell us what matters on this field. The engine turns it into weights that add up to 100%.</p>
      <label class="rotulo" for="texto" style="margin-top:0">What matters most to you on this field? (optional)</label>
      <textarea class="campo" id="texto" placeholder="E.g.: I want to protect the soil and lower drought risk without losing much income">${esc(P.texto)}</textarea>
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px"><button class="btn mini" id="interpretar">Suggest weights from the text</button><span id="interp" style="font-size:11px;color:var(--papel-3)"></span></div>
      <div id="sliders" style="margin-top:8px">${EIXOS.map((e) => `<div class="pref"><span class="ico" style="background:${e.cor}22">${ICO[e.ico]}</span>
        <div><b>${e.nome}</b><input type="range" min="0" max="100" step="1" value="${P.pesos[e.id]}" data-eixo="${e.id}" style="--cor:${e.cor}"></div>
        <span class="num" data-peso="${e.id}"></span></div>`).join("")}</div>
      <div class="barra-pesos" id="barra"></div>
      <div class="rotulo">Is this field irrigated?</div>
      <div class="alternar"><button class="btn mini ${P.irrigado ? "on" : ""}" data-irr="1">Yes</button><button class="btn mini ${!P.irrigado ? "on" : ""}" data-irr="0">No</button></div>
      <div class="rotulo">Crops your machinery can handle</div>
      <div class="opcoes" id="maq">${Object.entries(CULTURAS).map(([k, c]) => `<label><input type="checkbox" value="${k}" ${P.maquinario.has(k) ? "checked" : ""} ${k === "soja" ? "disabled" : ""}><span>${c.nome}${k === "soja" ? " (summer)" : ""}</span></label>`).join("")}</div>
      <div class="rotulo">Any crop you don't want to plant?</div>
      <div class="opcoes excluir" id="exc">${Object.entries(CULTURAS).filter(([k]) => k !== "soja").map(([k, c]) => `<label><input type="checkbox" value="${k}" ${P.excluir.has(k) ? "checked" : ""}><span>${c.nome}</span></label>`).join("")}</div>
      <div class="aviso">In this version soybean is the summer crop in every scenario (the dominant system in Sorriso). The engine compares second crops and cover crops.</div>
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
      if (!r.reconheceu) { $("#interp").textContent = "No priorities recognized in the text. Adjust the sliders."; return; }
      for (const e of EIXOS) { P.pesos[e.id] = Math.round(r.pesos[e.id] * 100); $(`[data-eixo="${e.id}"]`).value = P.pesos[e.id]; }
      atualizarBarra();
      const achados = Object.entries(r.achados).filter(([, v]) => v.length).map(([k, v]) => `${R.explica.NOMES_EIXO[k].toLowerCase()} (“${v.join("”, “")}”)`);
      $("#interp").textContent = `Read from keywords: ${achados.join("; ")}. Adjust if you like.`;
    };
    $$("[data-irr]").forEach((b) => (b.onclick = () => { P.irrigado = b.dataset.irr === "1"; $$("[data-irr]").forEach((x) => x.classList.toggle("on", x === b)); S.fixas = null; }));
    $$("#maq input").forEach((i) => (i.onchange = () => { i.checked ? P.maquinario.add(i.value) : P.maquinario.delete(i.value); S.fixas = null; }));
    $$("#exc input").forEach((i) => (i.onchange = () => { i.checked ? P.excluir.add(i.value) : P.excluir.delete(i.value); S.fixas = null; }));
    rodape(`<button class="btn ouro grande" id="gerar">Compare rotations for the next 3 years →</button>`);
    $("#gerar").onclick = () => { S.salva = null; S.salvaId = null; S.fixas = null; S.cen = { chuva: 0, temp: 0, elNino: false }; S.sel = null; S.alcancado.add("rotacoes"); S.alcancado.add("mapa"); irPara("rotacoes"); };
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
    const curto = (y) => `${String(y).slice(2)}/${String(y + 1).slice(2)}`;
    $("#painel-corpo").innerHTML = `<section>
      <div class="res-topo"><div>
        <div class="sobre">Step 5 · Rotations for the next 3 years</div>
        <h2>What to plant here through ${new Date().getFullYear() + 3}?</h2>
        <p class="lead" style="margin:0">We tested ${S.res.nSequencias} crop combinations against the real climate of the last ${cl.nAnos} years on this field. The best one for your goals comes first.</p></div>
        <div class="res-acoes">${botaoTec()}<button class="btn mini" id="como2" type="button">How we calculate</button><button class="btn mini" id="ver-mapa" type="button">See on map</button></div></div>

      ${S.aoVivo ? `<div class="aviso ouro" style="margin:0 0 12px">Data fetched live. The calculation uses the Central Brazil soybean + second-crop calendar: outside that region, treat the results as indicative.</div>` : ""}
      ${S.forcar ? `<div class="aviso seca" style="margin:0 0 12px">You asked to analyze a polygon that does not look like cropland: ${esc((S.raiox.usoAtual.alertas[0] || { texto: "little farmland" }).texto)}</div>` : ""}
      <div class="simulador">
        <h3>${ICO.clima.replace("<svg", '<svg width="20" height="20"')} What if the weather is bad?</h3>
        <p class="sim-sub">Turn on El Niño Mode to see which rotations hold up best in a drought year.</p>
        <div class="sim-principal">
          <button class="elnino-btn ${S.cen.elNino ? "on" : ""}" id="s-nino" type="button" aria-pressed="${S.cen.elNino}"><b>El Niño Mode</b><small>Tests with the ${analogos.length} strong El Niño years</small></button>
          <p class="cen-txt" id="cen-txt" aria-live="polite"></p>
          <button class="btn mini fantasma" id="s-reset" type="button">Back to normal climate</button>
        </div>
        ${tecnico("sim", 'Adjust rain and temperature <span class="sim-resumo num" id="sim-resumo"></span>', `
          <div class="sim-grade dois">
            <div class="sim-ctrl"><label for="s-chuva">Rain <span class="num" id="v-chuva"></span></label><input type="range" id="s-chuva" min="-40" max="20" step="5" value="${S.cen.chuva * 100}" style="--cor:#4C8DF6"><div class="escala"><span>−40%</span><span>0</span><span>+20%</span></div></div>
            <div class="sim-ctrl"><label for="s-temp">Temperature <span class="num" id="v-temp"></span></label><input type="range" id="s-temp" min="0" max="3" step="0.5" value="${S.cen.temp}" style="--cor:#E76F51"><div class="escala"><span>+0 °C</span><span>+1.5</span><span>+3 °C</span></div></div>
          </div>
          <div class="fonte"><span>Strong El Niño years used (ONI ≥ 1.5): ${analogos.map(curto).join(", ")}</span><span>Reference climate: seasons ${curto(cl.anos[0])} to ${curto(cl.anos[cl.anos.length - 1])}, day by day, with this field's soil</span><span class="chip ceu">conditional simulation</span><span id="ms" class="num"></span></div>`)}
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
    rotulosSim(); atualizarResultados(false); ligarBotaoTec();
    rodape(`<div class="salvar-linha"><button class="btn ouro grande" id="salvar-safra" type="button"></button><small>Kept for 1 hour in this browser, with no account and no data sent anywhere.</small></div>`);
    $("#salvar-safra").onclick = salvarDecisao;
    rotuloSalvar();
  }
  function rotuloSalvar() {
    const b = $("#salvar-safra"), c = S.res && S.res.cartoes.find((x) => x.id === S.sel);
    if (b && c) b.textContent = `Save this plan: ${c.titulo} →`;
  }
  function rotulosSim() {
    const c = S.cen;
    $("#v-chuva").textContent = `${c.chuva > 0 ? "+" : ""}${Math.round(c.chuva * 100)}%`;
    $("#v-temp").textContent = `+${fmt(c.temp, 1)} °C`;
    const ajustes = [];
    if (c.chuva) ajustes.push(`rain ${c.chuva > 0 ? "+" : "−"}${Math.abs(Math.round(c.chuva * 100))}%`);
    if (c.temp) ajustes.push(`+${fmt(c.temp, 1)} °C`);
    $("#sim-resumo").textContent = ajustes.length ? `· ${ajustes.join(" · ")}` : "";
    const base = c.elNino ? `Simulating the ${S.res.anos.length} strong El Niño years` : `Normal climate: the last ${S.res.anos.length} real seasons`;
    $("#cen-txt").textContent = `${base}${ajustes.length ? `, with ${ajustes.join(" and ")}` : ""}. Not a weather forecast.`;
    $("#s-reset").hidden = !(c.elNino || c.chuva || c.temp);
    $("#s-nino").setAttribute("aria-pressed", String(!!c.elNino));
  }
  function atualizarResultados(animar) {
    const r = S.res;
    $("#ms").textContent = `· recalculated in ${fmt(r.ms, 0)} ms`;
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
      $("#otima").innerHTML = `<div class="aviso ouro otima" style="margin:0 0 12px">In this scenario there is an even better combination for your goals: <b>${o.seq.map((x) => SEGUNDA_SAFRA[x].nome).join(" → ")}</b> <span style="color:var(--papel-3)">(${fmt(w, 0)} points)</span>. <button class="btn mini" id="add-otima">Add to comparison</button></div>`;
      $("#add-otima").onclick = () => {
        S.fixas = S.fixas.filter((f) => f.id !== "otima").concat([{ id: "otima", titulo: "Best in this scenario", seq: o.seq }]);
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
    const tipo = { atual: "What you plant today", equilibrio: "Balances the 4 goals", conservacao: "Puts soil health first", resiliencia: "Puts water and lower risk first", sobmedida: "Built for your weights", otima: "Best sequence in this scenario" }[c.id] || "";
    const anos = c.seq.map((o, i) => {
      const op = SEGUNDA_SAFRA[o];
      return `<div class="ano"><small>YEAR ${i + 1}</small><div class="cult">${ICO.soja}<span>Soybean</span></div><div class="mais">+</div><div class="cult">${ICO[op.icone]}<span>${op.nome}</span></div></div>`;
    }).join("");
    const barra = (v, cor) => `<div class="trilho"><i style="width:${Math.max(2, v)}%;background:${cor}"></i></div>`;
    // Modo El Niño: uma frase simples no cartão; o ano a ano e a dispersão ficam nos detalhes técnicos
    let ninoResumo = "", ninoTec = "";
    if (S.cen.elNino) {
      const total = c.porAno.length, ruins = c.porAno.filter((a) => a.quebras > 0).length;
      const nivel = ruins === 0 ? "bom" : ruins / total <= 0.34 ? "atencao" : "ruim";
      ninoResumo = `<div class="nino-resumo ${nivel}">${ruins === 0 ? `Held up in all ${total} El Niño years` : `Failed in ${ruins} of ${total} El Niño years`}</div>`;
      const rendas = c.porAno.map((a) => a.renda), todos = S.res.cartoes.flatMap((x) => x.porAno.map((a) => a.renda));
      const lo = Math.min(...todos), hi = Math.max(...todos), esc2 = (v) => (100 * (v - lo)) / (hi - lo || 1);
      ninoTec = `<div class="rotulo" style="margin:10px 0 4px">Failures per El Niño year (3 soybean seasons + second crop)</div>
        <div class="anos-elnino">${c.porAno.map((a) => `<span class="q${Math.min(2, a.quebras)}" title="${a.quebras} failure(s) if all 3 years were like ${a.ano}/${String(a.ano + 1).slice(2)}">${String(a.ano).slice(2)}/${String(a.ano + 1).slice(2)} ${a.quebras ? "✗".repeat(Math.min(3, a.quebras)) : "✓"}</span>`).join("")}</div>
        <div class="rotulo" style="margin:10px 0 4px">Relative income: worst and best El Niño year (not an average)</div>
        <div class="disp"><div class="faixa" style="left:${esc2(Math.min(...rendas))}%;width:${Math.max(1, esc2(Math.max(...rendas)) - esc2(Math.min(...rendas)))}%"></div>${rendas.map((v) => `<div class="marca" style="left:${esc2(v)}%"></div>`).join("")}</div>
        <div class="disp-legenda"><span>${fmt(Math.min(...rendas), 2)}</span><span>${fmt(Math.max(...rendas), 2)}</span></div>`;
    }
    const tec = `<div class="kv">
        <span>Rain used</span><b>${pct(m.agua)}</b>
        <span>Income index</span><b>${fmt(m.renda, 2)}</b>
        <span>Nutrients</span><b>${fmt(m.solo.nutrientes * 100, 0)}</b>
        <span>Pest control</span><b>${fmt(m.solo.pragas * 100, 0)}</b>
        <span>Erosion protection</span><b>${fmt(m.solo.erosao * 100, 0)}</b>
        <span>Organic matter</span><b>${fmt(m.solo.materiaOrganica * 100, 0)}</b>
        ${m.irrigacao > 1 ? `<span>Irrigation</span><b>${fmt(m.irrigacao, 0)} mm/year</b>` : ""}
        <span>Score with your weights</span><b>${fmt(c.pontuacao, 0)}</b></div>${ninoTec}`;
    return `<article class="cartao ${c.recomendada ? "recomendada" : ""} ${S.sel === c.id ? "sel" : ""}" data-id="${c.id}">
      ${c.recomendada ? '<span class="selo">Recommended by Rotare</span>' : ""}
      <div class="cartao-topo"><div><h4>${esc(c.titulo)}${mov}</h4><div class="tipo">${tipo}</div></div><span class="pos" title="Ranking position">#${c.posicao}</span></div>
      <div class="seq">${anos}</div>
      ${ninoResumo}
      <div class="indic">
        <div><small>Soil health</small><div class="val"><span class="num">${fmt(n.solo, 0)}</span><em>of 100</em></div>${barra(n.solo, "linear-gradient(90deg,#8B5E34,#3DBE7A)")}</div>
        <div><small>Failure chance</small><div class="val"><span class="num" style="color:${cr.cor}">${pct(m.risco)}</span><em>per year</em></div>${barra(m.risco * 100 * 2, cr.cor)}</div>
        <div><small>Water use</small><div class="val"><span class="num">${fmt(n.agua, 0)}</span><em>of 100</em></div>${barra(n.agua, "#4C8DF6")}</div>
        <div><small>Income</small><div class="val"><span class="num">${fmt(n.renda, 0)}</span><em>of 100</em></div>${barra(n.renda, "#E9C46A")}</div>
      </div>
      ${tecnico("cartoes", "See technical details", tec)}
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
    $("#explica").innerHTML = `<div class="rotulo" style="margin-top:20px">Why Rotare ${c.recomendada ? "recommended" : "rated"}: <b style="color:var(--papel)">${esc(c.titulo)}</b> <span style="font-size:12px">tap another card to compare</span></div>
      <div class="bloco porque"><h4>In a few words</h4><p>${esc(e.porque)}</p></div>
      ${tecnico("explica", "See benefits, risks and what we don't know", `<div class="explica" style="margin-top:0">
        <div class="bloco benef"><h4>Benefits</h4><ul>${e.beneficios.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
        <div class="bloco riscos"><h4>Risks</h4><ul>${e.riscos.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
        <div class="bloco naosabe"><h4>What we don't know</h4><ul>${e.naoSabemos.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
      </div><div class="fonte"><span>Text built by rules from the engine's numbers (no generative AI).</span></div>`)}
      <div class="aviso">Rotare supports the decision and does not replace the farmer or the agronomist. Bring this comparison to the conversation with your technical advisor.</div>`;
    atualizarBotaoTec();
    rotuloSalvar();
  }

  // ===================================================================== safras salvas (sem conta)
  // Cada decisão fica só neste navegador e expira em 1 hora: não há conta para vincular os dados a alguém.
  const DECISOES_CHAVE = "rotare.decisoes.v1", DECISAO_TTL = 60 * 60 * 1000;
  function lerDecisoes() {
    try { const v = JSON.parse(localStorage.getItem(DECISOES_CHAVE) || "[]"); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function gravarDecisoes(lista) {
    try { lista.length ? localStorage.setItem(DECISOES_CHAVE, JSON.stringify(lista)) : localStorage.removeItem(DECISOES_CHAVE); return true; } catch (e) { return false; }
  }
  function limparDecisoes() {
    const agora = Date.now(), todas = lerDecisoes(), validas = todas.filter((d) => d && d.expiraEm > agora);
    if (validas.length !== todas.length) gravarDecisoes(validas);
    atualizarBotaoDecisoes(validas);
    return validas;
  }
  function atualizarBotaoDecisoes(lista = lerDecisoes()) {
    const b = $("#btn-decisoes");
    if (!b) return;
    b.hidden = !lista.length;
    $("#n-decisoes").textContent = String(lista.length);
  }
  function salvarDecisao() {
    const c = S.res && S.res.cartoes.find((x) => x.id === S.sel);
    if (!c || !S.anel.length) return;
    const agora = Date.now(), cen = S.cen;
    const d = {
      id: `${agora.toString(36)}-${Math.random().toString(36).slice(2, 7)}`, criadoEm: agora, expiraEm: agora + DECISAO_TTL,
      talhao: S.demo ? S.demo.nome : "Drawn field", areaHa: S.met.areaHa, anel: S.anel, bbox: S.met.bbox,
      local: S.aoVivo ? "Data fetched live" : "Sorriso, Mato Grosso",
      rotacao: { titulo: c.titulo, recomendada: !!c.recomendada, posicao: c.posicao, seq: c.seq.map((o) => SEGUNDA_SAFRA[o].nome),
                 solo: c.notas.solo, agua: c.notas.agua, renda: c.notas.renda, risco: c.metricas.risco },
      cenario: cen.elNino ? "El Niño Mode" : cen.chuva || cen.temp ? "Climate adjusted in the simulator" : "Normal climate",
      nota: (S.prefs.texto || "").trim().slice(0, 2000),
    };
    const lista = limparDecisoes().concat([d]);
    if (!gravarDecisoes(lista)) { toast("Could not save: the browser blocked local storage.", 4000); return; }
    S.salva = d; S.salvaId = c.id;
    atualizarBotaoDecisoes(lista); desenharDecisoes(lista);
    const b = $("#btn-decisoes"); b.classList.remove("pulsa"); void b.offsetWidth; b.classList.add("pulsa");
    toast(`Plan saved: ${c.titulo}. See it in "My crops".`, 3600);
    irPara("mapa");
  }
  function desenharDecisoes(lista = lerDecisoes()) {
    if (!map || !map.getSource("decisoes")) return;
    map.getSource("decisoes").setData({ type: "FeatureCollection", features: lista.map((d) => ({ type: "Feature", properties: { id: d.id, nome: d.talhao },
      geometry: { type: "Polygon", coordinates: [[...d.anel, d.anel[0]]] } })) });
  }
  function abrirDecisoes() {
    const lista = limparDecisoes();
    if (!lista.length) { fecharModal(); toast("Your saved plans have expired."); return; }
    modal(`<h3>My crops</h3>
      <p>Plans saved in this browser. Each one is deleted automatically 1 hour after saving.</p>
      <div class="decisoes">${lista.slice().reverse().map((d) => {
        const r = d.rotacao, cr = R.mapa.classeRisco(r.risco);
        return `<article class="decisao">
          <div class="decisao-topo"><b>${esc(d.talhao)} · <span class="num">${fmt(d.areaHa, 1)} ha</span></b></div>
          <div class="seq-txt">${esc(r.titulo)}${r.recomendada ? ' <span class="chip">recommended by Rotare</span>' : ""}<br>${r.seq.map((o, i) => `Year ${i + 1}: soybean + ${esc(o.toLowerCase())}`).join(" · ")}</div>
          <div class="kv"><span>Soil health</span><b>${fmt(r.solo, 0)}/100</b><span>Failure chance</span><b style="color:${cr.cor}">${pct(r.risco)} per year</b><span>Water use</span><b>${fmt(r.agua, 0)}/100</b><span>Relative income</span><b>${fmt(r.renda, 0)}/100</b><span>Scenario</span><b>${esc(d.cenario)}</b></div>
          ${d.nota ? `<div class="nota-salva" id="nota-${d.id}"><div><p><span>What matters most to you</span>${esc(d.nota)}</p></div></div>` : ""}
          <div class="acoes"><button class="btn mini" type="button" data-ver="${d.id}">See on map</button>${d.nota ? `<button class="btn mini fantasma" type="button" data-mais="${d.id}" aria-expanded="false" aria-controls="nota-${d.id}">Show more</button>` : ""}<button class="btn mini fantasma" type="button" data-apagar="${d.id}">Delete</button></div>
        </article>`;
      }).join("")}</div>`);
    $$("#modal [data-ver]").forEach((b) => (b.onclick = () => {
      const d = lerDecisoes().find((x) => x.id === b.dataset.ver);
      fecharModal();
      if (d) { desenharDecisoes(); requestAnimationFrame(() => voarParaArea(d.bbox)); }
    }));
    $$("#modal [data-mais]").forEach((b) => (b.onclick = () => {
      const aberto = b.getAttribute("aria-expanded") === "true";
      b.setAttribute("aria-expanded", String(!aberto)); b.textContent = aberto ? "Show more" : "Show less";
      $(`#nota-${b.dataset.mais}`).classList.toggle("aberta", !aberto);
    }));
    $$("#modal [data-apagar]").forEach((b) => (b.onclick = () => {
      const resto = lerDecisoes().filter((x) => x.id !== b.dataset.apagar);
      gravarDecisoes(resto); desenharDecisoes(resto); atualizarBotaoDecisoes(resto);
      if (S.salva && S.salva.id === b.dataset.apagar) S.salva = null;
      if (resto.length) abrirDecisoes(); else { fecharModal(); toast("Plan deleted."); }
    }));
  }

  // ===================================================================== 7. mapa inteligente
  function atualizarMapaRisco() {
    if (!S.res || !map.getSource("risco")) return;
    const rec = S.res.cartoes[0];
    R.mapa.atualizarRisco(map, S.anel, rec.metricas.risco);
  }
  function renderMapa() {
    if (!S.res) { irPara(S.raiox ? "prefs" : "talhao"); return; }
    const salva = S.salvaId && S.res.cartoes.find((x) => x.id === S.salvaId);
    const rec = salva || S.res.cartoes[0], cr = R.mapa.classeRisco(rec.metricas.risco);
    const at = R.mapa.atualizarAtencao(map, S.anel);
    R.mapa.atualizarDeclividade(map);
    if (S.mesNdvi === null) S.mesNdvi = R.zonal.regiao().ndvi.meses.indexOf("2025-01");
    R.mapa.atualizarNdvi(map, S.mesNdvi);
    Object.assign(S.camadas, { risco: true, atencao: true });
    R.mapa.mostrar(map, "risco", true); R.mapa.mostrar(map, "atencao", true);
    atualizarMapaRisco();
    const nDecl = at.filter((f) => f.properties.cor === R.mapa.CORES.amarelo).length, nNat = at.length - nDecl;
    $("#painel-corpo").innerHTML = `<section>
      <div class="sobre">Step 6 · Smart map</div>
      <h2>${salva ? "The plan you saved" : "The recommendation on your land"}</h2>
      ${salva ? `<div class="aviso ouro" style="margin:0 0 12px">Plan saved. It shows up in <b>My crops</b>, at the top, for 1 hour.</div>` : ""}
      <p class="lead">Turn layers on and off in the map corner. Click the field to see the recommendation.</p>
      <div class="card" style="border-color:var(--palha)"><h4><span class="ponto" style="background:var(--palha)"></span>${esc(rec.titulo)}</h4>
        <div style="color:var(--papel-2);font-size:13px">${rec.seq.map((o, i) => `Year ${i + 1}: soybean + ${SEGUNDA_SAFRA[o].nome.toLowerCase()}`).join("<br>")}</div>
        <div class="kv" style="margin-top:10px"><span>Climate risk (whole field, ${S.cen.elNino || S.cen.chuva || S.cen.temp ? "in the simulator scenario" : "reference climate"})</span><b style="color:${cr.cor}">${cr.nome} · ${pct(rec.metricas.risco)}</b><span>Soil health</span><b>${fmt(rec.notas.solo, 0)}/100</b></div></div>
      <div class="rotulo">Areas that need attention inside the field</div>
      <div class="kv"><span>~90 m cells with slope &gt; 8%</span><b>${nDecl}</b><span>~270 m cells with native vegetation (MapBiomas)</span><b>${nNat}</b></div>
      <div class="aviso">Climate data has a 5 to 55 km resolution, so climate risk applies to the whole polygon: Rotare does not invent zones inside the field. Only slope (90 m) and land use (270 m) are shown per cell.</div>
    </section>`;
    rodape(`<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button class="btn grande" id="volta-rot">← Back to rotations</button><button class="btn ouro grande" id="novo-talhao">Analyze another field</button></div>`);
    $("#volta-rot").onclick = () => irPara("rotacoes");
    $("#novo-talhao").onclick = novoTalhao;
    renderCamadas();
  }
  // Recomeça a jornada: limpa o contorno e a análise atuais (as safras salvas continuam em "Minhas safras").
  function novoTalhao() {
    S.demo = null; S.salva = null; S.salvaId = null; S.cen = { chuva: 0, temp: 0, elNino: false };
    if (editor) editor.limpar();
    S.anel = []; S.met = null; S.res = null; S.fixas = null; S.raiox = null; S.sel = null;
    ["raiox", "prefs", "rotacoes", "mapa"].forEach((p) => S.alcancado.delete(p));
    Object.assign(S.camadas, { risco: false, atencao: false });
    R.mapa.mostrar(map, "risco", false); R.mapa.mostrar(map, "atencao", false);
    irPara("local");
  }
  function popupTalhao(lngLat) {
    const salva = S.salvaId && S.res.cartoes.find((x) => x.id === S.salvaId);
    const rec = salva || S.res.cartoes[0], cr = R.mapa.classeRisco(rec.metricas.risco);
    const e = R.explica.explicar(rec, contextoExplica());
    new maplibregl.Popup({ maxWidth: "300px" }).setLngLat(lngLat).setHTML(`<div class="popup"><div class="sobre">${salva ? "Plan you saved" : "Recommended by Rotare"}</div>
      <h4>${esc(rec.titulo)}</h4><p>${rec.seq.map((o) => SEGUNDA_SAFRA[o].nome).join(" → ")} (after soybean)</p>
      <p><b style="color:${cr.cor}">${cr.nome}</b>: fails in ${pct(rec.metricas.risco)} of years · soil ${fmt(rec.notas.solo, 0)}/100 · ${pct(rec.metricas.agua)} of rain used</p>
      <p>${esc(e.beneficios[0])}</p></div>`).addTo(map);
  }

  // ----- painel de camadas -----
  function renderCamadas() {
    const el = $("#camadas"), tem = !!S.raiox, L = S.camadas;
    const mes = S.mesNdvi !== null && R.zonal.regiao() ? R.zonal.regiao().ndvi.meses[S.mesNdvi] : null;
    const item = (k, nome, cor, ok = true, extra = "") => `<label class="${ok ? "" : "desab"}"><input type="checkbox" data-c="${k}" ${L[k] ? "checked" : ""} ${ok ? "" : "disabled"}><span class="sw" style="background:${cor}"></span>${nome}${extra}</label>`;
    let leg = "";
    if (L.uso && tem) leg += Object.values(R.zonal.WORLDCOVER).filter((c) => ["urbano", "agua", "mata"].includes(c[2]) && c[0] !== "Mangrove").map((c) => `<div><span class="sw" style="background:${c[1]}"></span>${c[0]}</div>`).join("") + `<div><span class="sw" style="background:rgba(233,196,106,.4)"></span>Cropland, pasture, soil</div>`;
    if (L.ndvi && tem) leg += `<div>NDVI ${mes ? mes : ""}<span class="rampa" style="background:linear-gradient(90deg,#8B5E34,#E9C46A,#3DBE7A,#126e40)"></span></div>`;
    if (L.declividade && tem) leg += R.mapa.CLASSES_DECL.map((c) => `<div><span class="sw" style="background:rgba(${c[1].slice(0, 3).join(",")},${c[1][3] / 255})"></span>${c[2]}</div>`).join("");
    if (L.risco && S.res) leg += `<div><span class="sw" style="background:#3DBE7A"></span>Favorable (&lt;10% of years)</div><div><span class="sw" style="background:#E9C46A"></span>Caution (10–25%)</div><div><span class="sw" style="background:#E76F51"></span>High risk (&gt;25%)</div>`;
    if (L.atencao && S.res) leg += `<div><span class="sw" style="background:#E9C46A"></span>Slope &gt; 8%</div><div><span class="sw" style="background:#E76F51"></span>Native vegetation</div>`;
    el.innerHTML = `<h4>Layers <button type="button" id="rec-cam" aria-label="Collapse">${el.classList.contains("recolhida") ? "+" : "−"}</button></h4><div class="corpo">
      ${item("esri", "Satellite imagery", "#4C8DF6")}
      ${item("nasa", "NASA HLS 30 m (GIBS)", "#4C8DF6", true, L.nasa ? ` <input type="date" id="gibs-data" value="${S.gibsData}" class="sel" style="padding:2px 4px;font-size:10px;margin-left:auto">` : "")}
      ${item("limites", "Field boundary", "#E9C46A", S.anel.length >= 3)}
      ${item("uso", "Land use today (WorldCover)", "#E76F51", tem && !!R.zonal.regiao().worldcover)}
      ${item("ndvi", "Vegetation history (NDVI)", "#3DBE7A", tem)}
      ${item("declividade", "Terrain and slope", "#D2A57A", tem)}
      ${item("risco", "Climate risk", "#E76F51", !!S.res)}
      ${item("atencao", "Areas that need attention", "#E9C46A", !!S.res)}
      ${leg ? `<div class="legenda">${leg}</div>` : ""}
      ${L.nasa ? `<div class="legenda">HLS: a pass every 2 to 5 days; change the date if it is empty or cloudy.</div>` : ""}</div>`;
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
    return `<h3>How Rotare calculates</h3><p>Everything below is deterministic: the same data and parameters always give the same result. No AI generates numbers.</p>
      <h4>1. Data and resolution</h4><table><tr><th>Data</th><th>Source</th><th>Resolution</th><th>Use</th></tr>
      <tr><td>Vegetation (NDVI)</td><td>NASA MODIS MOD13Q1 + MYD13Q1</td><td>250 m, 16 days</td><td>crop history</td></tr>
      <tr><td>Field imagery</td><td>NASA HLS (Landsat + Sentinel-2)</td><td>30 m</td><td>visualization</td></tr>
      <tr><td>Daily rain</td><td>CHIRPS v2.0 · checked against NASA GPM IMERG</td><td>~5 km · 11 km</td><td>water balance</td></tr>
      <tr><td>Temperature</td><td>NASA POWER</td><td>~55 km</td><td>ET0, heat, frost</td></tr>
      <tr><td>Soil moisture</td><td>NASA SMAP L4</td><td>9 km</td><td>context (anomaly)</td></tr>
      <tr><td>Soil</td><td>ISRIC SoilGrids 2.0</td><td>250 m</td><td>available water</td></tr>
      <tr><td>Terrain</td><td>NASA SRTM</td><td>30 m → 90 m</td><td>slope, erosion</td></tr>
      <tr><td>Land use</td><td>MapBiomas Collection 9</td><td>30 m → 270 m</td><td>validation, native vegetation</td></tr>
      <tr><td>El Niño</td><td>NOAA CPC ONI</td><td>index</td><td>analog years (ONI ≥ 1.5)</td></tr></table>
      <p>Grids are aggregated to the polygon with zonal statistics (mean of the cells whose center falls inside it). Climate is regional: it applies to the whole field.</p>
      <h4>2. Daily water balance (FAO-56)</h4>
      <p>For each crop year (Sep 1 to Aug 31) and each option: soybean is sown at the <b>start of the rains</b> computed from the data (≥ 20 mm in 3 days with no 10-day dry spell afterwards, from Sep 15) and the second crop right after harvest, if it fits in the window. Soil reservoir with <code>TAW = available water (mm/m) × root depth</code>; <code>ETc = Kc × ET0</code>; <code>Ks = (TAW − Dr) / ((1 − p) TAW)</code> when depletion exceeds <code>p × TAW</code>; <code>ETa = Ks × ETc</code>.</p>
      <h4>3. Relative yield and risk</h4>
      <p><code>Yr = 1 − Ky (1 − ETa/ETc)</code> (FAO-33). A cash crop “fails” when <code>Yr &lt; 0.8</code> or when it does not fit in the planting window. <b>Climate risk</b> = average chance, per year, that the soybean or the commercial second crop fails, over the 30 reference years or the El Niño years.</p>
      <h4>4. Indicators</h4><ul>
      <li><b>Water efficiency</b>: share of the year's rain (plus irrigation) that becomes crop evapotranspiration. Since this share rises when it rains less, in the simulator the score compares combinations within the same climate.</li>
      <li><b>Soil health</b> (structure of the USDA-NRCS Soil Conditioning Index): average of organic matter (straw × Yr over 3 years, against 37.5 t/ha), nutrients (soybean fixation + second-crop cycling), erosion (bare-soil days × slope factor) and pests (crop alternation and years with cover).</li>
      <li><b>Relative income</b>: margin index per crop (soybean = 1) × Yr, summed over 3 years. Not a price or a money value.</li></ul>
      <h4>5. Scores from 0 to 100 and ranking</h4>
      <p>Each score is the position between the worst and the best of all valid combinations in the reference climate. So when you change the climate, scores move against the same ruler. <code>Score = Σ weight × score</code> (risk enters as 100 − score). Weights come from your sliders, normalized to add up to 100%.</p>
      <h4>6. Simulator</h4>
      <p>Daily rain × (1 + Δ); temperature + ΔT, with <code>ET0 × (Tmean + ΔT + 17.8)/(Tmean + 17.8)</code> (Hargreaves). Everything is recalculated from scratch: rain onset, windows, balance and scores. In El Niño Mode, the engine uses only the analog years and shows each one separately.</p>
      <h4>7. Agronomic catalog (draft for review)</h4><table><tr><th>Crop</th><th>Cycle</th><th>Kc ini/mid/end</th><th>Ky</th><th>Straw t/ha</th><th>Window until</th></tr>
      ${cat.map((c) => `<tr><td>${c.nome}</td><td>${c.fases.reduce((a, b) => a + b, 0)} d</td><td>${c.kc.join(" / ")}</td><td>${c.ky}</td><td>${c.palhada}</td><td>${c.plantioAte ? `${MESES[+c.plantioAte.slice(0, 2) - 1]} ${+c.plantioAte.slice(3)}` : "–"}</td></tr>`).join("")}</table>
      <p>${esc(R.catalogo.FONTES.kc)} · ${esc(R.catalogo.FONTES.ky)} · ${esc(R.catalogo.FONTES.renda)}</p>
      <h4>8. Limitations</h4><ul><li>Without a soil test, soil is estimated. Without pest history, the pest index is structural.</li><li>Years are simulated independently (water does not carry over from one year to the next, since the dry winter empties the profile).</li><li>Scenarios are conditional (“what if”), not forecasts.</li></ul>`;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})(globalThis.Rotare = globalThis.Rotare || {});
