// Aviso de SI: arquivo escrito com ajuda de IA (Claude), sob direção do time Datanauts Brasil.
// Editor de talhão sobre MapLibre: retângulo redimensionável, polígono livre, vértices arrastáveis,
// inserção pelo ponto médio, mover o polígono inteiro, desfazer e refazer. Coordenadas geográficas reais (WGS84).
(function (R) {
  "use strict";

  const COR = "#E9C46A";

  class EditorTalhao {
    constructor(map, { onChange } = {}) {
      this.map = map;
      this.onChange = onChange || (() => {});
      this.anel = [];            // [[lon,lat], ...] sem repetir o primeiro ponto
      this.modo = "nenhum";      // nenhum | retangulo | poligono | editar
      this.retangulo = false;    // mantém forma retangular ao arrastar cantos
      this.hist = [];
      this.futuro = [];
      this.rascunho = null;
      this.arrasto = null;
      this._instalar();
    }

    _instalar() {
      const m = this.map;
      const vazio = { type: "FeatureCollection", features: [] };
      for (const id of ["ed-poly", "ed-vert", "ed-mid", "ed-draft"]) m.addSource(id, { type: "geojson", data: vazio });
      m.addLayer({ id: "ed-fill", type: "fill", source: "ed-poly", paint: { "fill-color": COR, "fill-opacity": 0.14 } });
      m.addLayer({ id: "ed-line-glow", type: "line", source: "ed-poly", paint: { "line-color": COR, "line-width": 8, "line-opacity": 0.25, "line-blur": 4 } });
      m.addLayer({ id: "ed-line", type: "line", source: "ed-poly", paint: { "line-color": COR, "line-width": 2.5 } });
      m.addLayer({ id: "ed-draft", type: "line", source: "ed-draft", paint: { "line-color": COR, "line-width": 2, "line-dasharray": [2, 2] } });
      m.addLayer({ id: "ed-mid", type: "circle", source: "ed-mid", paint: { "circle-radius": 4.5, "circle-color": "#12141F", "circle-stroke-color": COR, "circle-stroke-width": 1.5, "circle-opacity": 0.9 } });
      m.addLayer({ id: "ed-vert", type: "circle", source: "ed-vert", paint: { "circle-radius": 6.5, "circle-color": "#F4F1EA", "circle-stroke-color": COR, "circle-stroke-width": 2.5 } });

      m.on("mousedown", (e) => this._down(e));
      m.on("touchstart", (e) => { if (e.points && e.points.length === 1) this._down(e); });
      m.on("mousemove", (e) => this._move(e));
      m.on("touchmove", (e) => this._move(e));
      m.on("mouseup", (e) => this._up(e));
      m.on("touchend", (e) => this._up(e));
      m.on("click", (e) => this._click(e));
      m.on("dblclick", (e) => this._dbl(e));
      for (const l of ["ed-vert", "ed-mid"]) {
        m.on("mouseenter", l, () => { if (this.modo === "editar") m.getCanvas().style.cursor = "grab"; });
        m.on("mouseleave", l, () => this._cursor());
      }
      m.on("mouseenter", "ed-fill", () => { if (this.modo === "editar") m.getCanvas().style.cursor = "move"; });
      m.on("mouseleave", "ed-fill", () => this._cursor());
    }

    // ----- API -----
    iniciar(modo) {
      this.modo = modo;
      this.rascunho = modo === "poligono" ? [] : null;
      if (modo === "retangulo" || modo === "poligono") { this._salvarHist(); this.anel = []; this.retangulo = false; }
      this.map.doubleClickZoom[modo === "poligono" ? "disable" : "enable"]();
      this._cursor(); this._render(); this._emitir();
    }
    definir(anel, { historico = true, retangulo = false } = {}) {
      if (historico) this._salvarHist();
      this.anel = anel.map((p) => [p[0], p[1]]);
      if (this.anel.length > 1 && igual(this.anel[0], this.anel[this.anel.length - 1])) this.anel.pop();
      this.retangulo = retangulo; this.modo = "editar"; this.rascunho = null;
      this._cursor(); this._render(); this._emitir();
    }
    liberarVertices() { this.retangulo = false; this._emitir(); }
    // Fora da etapa de desenho o talhão fica visível, mas sem alças de edição
    travar(sim) {
      if (sim) { this.modo = "nenhum"; this.rascunho = null; this.map.doubleClickZoom.enable(); }
      else if (this.anel.length >= 3) this.modo = "editar";
      this._cursor(); this._render();
    }
    visivel(sim) {
      for (const l of ["ed-fill", "ed-line", "ed-line-glow", "ed-vert", "ed-mid", "ed-draft"]) this.map.setLayoutProperty(l, "visibility", sim ? "visible" : "none");
    }
    desfazer() {
      if (!this.hist.length) return;
      this.futuro.push(this._estado()); this._aplicar(this.hist.pop());
    }
    refazer() {
      if (!this.futuro.length) return;
      this.hist.push(this._estado()); this._aplicar(this.futuro.pop());
    }
    limpar() { this._salvarHist(); this.anel = []; this.modo = "nenhum"; this.rascunho = null; this.retangulo = false; this._render(); this._emitir(); }
    fechar() {
      if (this.modo === "poligono" && this.rascunho && this.rascunho.length >= 3) {
        this.anel = this.rascunho; this.rascunho = null; this.modo = "editar";
        this.map.doubleClickZoom.enable(); this._render(); this._emitir();
      }
    }
    get geojson() {
      return this.anel.length >= 3 ? { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...this.anel, this.anel[0]]] } } : null;
    }
    metricas() { return metricas(this.anel); }
    get podeDesfazer() { return this.hist.length > 0; }
    get podeRefazer() { return this.futuro.length > 0; }

    // ----- eventos -----
    _down(e) {
      const m = this.map;
      if (this.modo === "retangulo") {
        e.preventDefault(); m.dragPan.disable();
        this.arrasto = { tipo: "ret", a: [e.lngLat.lng, e.lngLat.lat] };
        return;
      }
      if (this.modo !== "editar" || !this.anel.length) return;
      const caixa = [[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]];
      const v = m.queryRenderedFeatures(caixa, { layers: ["ed-vert"] })[0];
      const md = !v && m.queryRenderedFeatures(caixa, { layers: ["ed-mid"] })[0];
      const f = !v && !md && m.queryRenderedFeatures(e.point, { layers: ["ed-fill"] })[0];
      if (!v && !md && !f) return;
      e.preventDefault(); m.dragPan.disable(); this._salvarHist();
      if (v) this.arrasto = { tipo: "vert", i: v.properties.i };
      else if (md) {
        const i = md.properties.i + 1;
        this.anel.splice(i, 0, [e.lngLat.lng, e.lngLat.lat]);
        this.retangulo = false;
        this.arrasto = { tipo: "vert", i };
      } else this.arrasto = { tipo: "mover", ultimo: [e.lngLat.lng, e.lngLat.lat] };
      m.getCanvas().style.cursor = "grabbing";
    }
    _move(e) {
      const p = [e.lngLat.lng, e.lngLat.lat];
      if (this.modo === "poligono" && this.rascunho && this.rascunho.length) {
        this.map.getSource("ed-draft").setData(linha([...this.rascunho, p]));
      }
      const a = this.arrasto;
      if (!a) return;
      if (a.tipo === "ret") {
        const [x0, y0] = a.a, [x1, y1] = p;
        this.anel = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
        this._render(); this._emitir(true);
      } else if (a.tipo === "vert") {
        if (this.retangulo && this.anel.length === 4) {
          // cantos: 0(x0,y0) 1(x1,y0) 2(x1,y1) 3(x0,y1). i^1 divide o y com i; 3-i divide o x.
          const i = a.i, mesmoY = i ^ 1, mesmoX = 3 - i;
          this.anel[i] = p;
          this.anel[mesmoY] = [this.anel[mesmoY][0], p[1]];
          this.anel[mesmoX] = [p[0], this.anel[mesmoX][1]];
        } else this.anel[a.i] = p;
        this._render(); this._emitir(true);
      } else if (a.tipo === "mover") {
        const dx = p[0] - a.ultimo[0], dy = p[1] - a.ultimo[1];
        this.anel = this.anel.map(([x, y]) => [x + dx, y + dy]); a.ultimo = p;
        this._render(); this._emitir(true);
      }
    }
    _up() {
      const a = this.arrasto;
      if (!a) return;
      this.arrasto = null; this.map.dragPan.enable();
      if (a.tipo === "ret") {
        const met = metricas(this.anel);
        if (!met || met.areaM2 < 100) { this.anel = []; this._render(); this._emitir(); return; }
        this.modo = "editar"; this.retangulo = true;
      }
      this._cursor(); this._render(); this._emitir();
    }
    _click(e) {
      if (this.modo !== "poligono") return;
      const p = [e.lngLat.lng, e.lngLat.lat];
      const r = this.rascunho;
      if (r.length >= 3) {
        const p0 = this.map.project(r[0]);
        if (Math.hypot(p0.x - e.point.x, p0.y - e.point.y) < 12) { this.fechar(); return; }
      }
      r.push(p);
      this.anel = r.length >= 3 ? [...r] : [];
      this.map.getSource("ed-vert").setData(pontos(r));
      this._render(); this._emitir(true);
    }
    _dbl(e) {
      if (this.modo === "poligono") { e.preventDefault(); if (this.rascunho.length > 3) this.rascunho.pop(); this.fechar(); return; }
      if (this.modo !== "editar") return;
      const v = this.map.queryRenderedFeatures([[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]], { layers: ["ed-vert"] })[0];
      if (v && this.anel.length > 3) {
        e.preventDefault(); this._salvarHist();
        this.anel.splice(v.properties.i, 1); this.retangulo = false; this._render(); this._emitir();
      }
    }

    // ----- internos -----
    _estado() { return { anel: this.anel.map((p) => [...p]), retangulo: this.retangulo }; }
    _salvarHist() { this.hist.push(this._estado()); if (this.hist.length > 60) this.hist.shift(); this.futuro = []; }
    _aplicar(s) { this.anel = s.anel; this.retangulo = s.retangulo; this.modo = this.anel.length ? "editar" : "nenhum"; this.rascunho = null; this._render(); this._emitir(); }
    _cursor() {
      const c = { retangulo: "crosshair", poligono: "crosshair" }[this.modo] || "";
      this.map.getCanvas().style.cursor = c;
    }
    _render() {
      const m = this.map, a = this.anel;
      const desenhando = this.modo === "poligono" && this.rascunho;
      m.getSource("ed-poly").setData(a.length >= 3 ? { type: "Feature", geometry: { type: "Polygon", coordinates: [[...a, a[0]]] } }
        : { type: "FeatureCollection", features: [] });
      m.getSource("ed-vert").setData(pontos(desenhando ? this.rascunho : (this.modo === "editar" ? a : [])));
      const mids = this.modo === "editar" && a.length >= 3 ? a.map((p, i) => {
        const q = a[(i + 1) % a.length];
        return { type: "Feature", properties: { i }, geometry: { type: "Point", coordinates: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] } };
      }) : [];
      m.getSource("ed-mid").setData({ type: "FeatureCollection", features: mids });
      if (!desenhando) m.getSource("ed-draft").setData({ type: "FeatureCollection", features: [] });
    }
    _emitir(arrastando = false) { this.onChange({ anel: this.anel, metricas: metricas(this.anel), modo: this.modo, arrastando, editor: this }); }
  }

  // ----- geometria (Turf: área e perímetro geodésicos) -----
  function igual(a, b) { return a[0] === b[0] && a[1] === b[1]; }
  function pontos(arr) {
    return { type: "FeatureCollection", features: arr.map((p, i) => ({ type: "Feature", properties: { i }, geometry: { type: "Point", coordinates: p } })) };
  }
  function linha(arr) { return { type: "Feature", geometry: { type: "LineString", coordinates: arr } }; }

  function metricas(anel) {
    if (!anel || anel.length < 3) return null;
    const T = globalThis.turf;
    const fechado = [...anel, anel[0]];
    const poly = T.polygon([fechado]);
    const areaM2 = T.area(poly);
    const perimetroKm = T.length(T.lineString(fechado), { units: "kilometers" });
    const c = T.centroid(poly).geometry.coordinates;
    const kinks = T.kinks(poly).features.length;
    const bbox = T.bbox(poly);
    return { areaM2, areaHa: areaM2 / 10000, perimetroKm, centroide: c, bbox, vertices: anel.length,
             valido: kinks === 0 && areaM2 >= 5000, autoIntersecao: kinks > 0, pequeno: areaM2 < 5000, anel: fechado };
  }

  R.EditorTalhao = EditorTalhao;
  R.geo = { metricas };
})(globalThis.Rotare = globalThis.Rotare || {});
