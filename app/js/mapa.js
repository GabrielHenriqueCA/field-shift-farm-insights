// Aviso de SI: arquivo escrito com ajuda de IA (Claude), sob direção do time Datanauts Brasil.
// Mapa: globo do MapLibre, imagem Esri, camadas NASA GIBS (HLS e MODIS) e camadas da análise do talhão.
(function (R) {
  "use strict";

  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
  const CORES = { verde: "#3DBE7A", amarelo: "#E9C46A", vermelho: "#E76F51", azul: "#4C8DF6", ouro: "#E9C46A" };

  function criarMapa(el) {
    const map = new maplibregl.Map({
      container: el,
      style: {
        version: 8,
        projection: { type: "globe" },
        sources: {
          esri: { type: "raster", tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19,
                  attribution: "Imagem © Esri, Maxar, Earthstar Geographics" },
          rotulos: { type: "raster", tiles: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19 },
        },
        layers: [
          { id: "fundo", type: "background", paint: { "background-color": "#07080d" } },
          { id: "esri", type: "raster", source: "esri", paint: { "raster-fade-duration": 250 } },
          { id: "rotulos", type: "raster", source: "rotulos", paint: { "raster-opacity": 0.8 } },
        ],
      },
      center: [-52, -13], zoom: 1.7, maxPitch: 60, attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
    map.on("style.load", () => {
      try {
        map.setSky({ "sky-color": "#12141F", "horizon-color": "#26304f", "fog-color": "#12141F",
                     "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0] });
      } catch (e) { /* céu é só estética */ }
    });
    return map;
  }

  function vazio() { return { type: "FeatureCollection", features: [] }; }

  // Camadas da análise, abaixo do editor
  function instalarCamadas(map) {
    const G = R.zonal.regiao();
    const [W, S, E, N] = G ? G.bbox : [0, 0, 0, 0];
    const cantos = [[W, N], [E, N], [E, S], [W, S]];
    const px = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    map.addSource("ndvi-img", { type: "image", url: px, coordinates: cantos });
    map.addLayer({ id: "ndvi", type: "raster", source: "ndvi-img", layout: { visibility: "none" }, paint: { "raster-opacity": 0.78, "raster-resampling": "nearest" } });
    map.addSource("decl-img", { type: "image", url: px, coordinates: cantos });
    map.addLayer({ id: "declividade", type: "raster", source: "decl-img", layout: { visibility: "none" }, paint: { "raster-opacity": 0.7, "raster-resampling": "nearest" } });
    map.addSource("regiao", { type: "geojson", data: G ? { type: "Feature", geometry: { type: "Polygon", coordinates: [[...cantos, cantos[0]]] } } : vazio() });
    map.addLayer({ id: "regiao", type: "line", source: "regiao", paint: { "line-color": CORES.azul, "line-width": 1.2, "line-dasharray": [4, 3], "line-opacity": 0.7 } });
    map.addSource("uso-img", { type: "image", url: px, coordinates: cantos });
    map.addLayer({ id: "uso", type: "raster", source: "uso-img", layout: { visibility: "none" }, paint: { "raster-opacity": 0.85, "raster-resampling": "nearest" } });
    map.addSource("risco", { type: "geojson", data: vazio() });
    map.addLayer({ id: "risco", type: "fill", source: "risco", layout: { visibility: "none" }, paint: { "fill-color": ["get", "cor"], "fill-opacity": 0.38 } });
    map.addSource("atencao", { type: "geojson", data: vazio() });
    map.addLayer({ id: "atencao", type: "fill", source: "atencao", layout: { visibility: "none" }, paint: { "fill-color": ["get", "cor"], "fill-opacity": 0.6, "fill-outline-color": ["get", "cor"] } });
    map.addSource("demos", { type: "geojson", data: vazio() });
    map.addLayer({ id: "demos", type: "line", source: "demos", paint: { "line-color": CORES.azul, "line-width": 2, "line-dasharray": [2, 2] } });
    map.addLayer({ id: "demos-fill", type: "fill", source: "demos", paint: { "fill-color": CORES.azul, "fill-opacity": 0.08 } });
  }

  // Quando a região ativa muda (pacote ao vivo), as imagens das grades passam a cobrir a nova caixa
  function trocarRegiaoMapa(map) {
    const G = R.zonal.regiao();
    if (!G) return;
    const [W, S, E, N] = G.bbox, cantos = [[W, N], [E, N], [E, S], [W, S]];
    for (const id of ["ndvi-img", "decl-img", "uso-img"]) map.getSource(id).setCoordinates(cantos);
    map.getSource("regiao").setData({ type: "Feature", geometry: { type: "Polygon", coordinates: [[...cantos, cantos[0]]] } });
  }
  // Uso do solo (WorldCover) só dentro do talhão: construções, água e mata aparecem coloridas
  function atualizarUso(map, anel) {
    const G = R.zonal.regiao(), g = G.worldcover;
    if (!g) return;
    const [W, , , N] = G.bbox, dentro = new Uint8Array(g.w * g.h);
    for (const c of R.zonal.celulas(anel, g).idx) dentro[c] = 1;
    const url = imagemGrade(g.w, g.h, (i) => {
      if (!dentro[i]) return null;
      const info = R.zonal.WORLDCOVER[g.v[i]];
      if (!info) return null;
      const hex = info[1], a = info[2] === "agricola" ? 90 : 235;
      return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), a];
    });
    map.getSource("uso-img").updateImage({ url });
  }

  function definirGibs(map, camada, data) {
    if (map.getLayer("gibs")) map.removeLayer("gibs");
    if (map.getSource("gibs")) map.removeSource("gibs");
    if (!camada) return;
    const [id, nivel] = camada.split("|");
    const ext = nivel === "9" ? "jpg" : "png";
    map.addSource("gibs", { type: "raster", tileSize: 256, maxzoom: +nivel, attribution: "NASA GIBS / EOSDIS",
      tiles: [`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${id}/default/${data}/GoogleMapsCompatible_Level${nivel}/{z}/{y}/{x}.${ext}`] });
    map.addLayer({ id: "gibs", type: "raster", source: "gibs", paint: { "raster-opacity": 0.92 } }, "rotulos");
  }

  // ----- imagens das grades (canvas) -----
  function rampaNdvi(v) {
    const p = [[0.15, [139, 94, 52]], [0.35, [196, 150, 82]], [0.5, [233, 196, 106]], [0.7, [61, 190, 122]], [0.9, [18, 110, 64]]];
    if (v <= p[0][0]) return p[0][1];
    for (let i = 1; i < p.length; i++) {
      if (v <= p[i][0]) {
        const t = (v - p[i - 1][0]) / (p[i][0] - p[i - 1][0]);
        return p[i - 1][1].map((c, k) => Math.round(c + (p[i][1][k] - c) * t));
      }
    }
    return p[p.length - 1][1];
  }
  function imagemGrade(w, h, cor) {
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d"), img = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const c = cor(i);
      if (!c) continue;
      img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = c[3] ?? 255;
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL();
  }
  function atualizarNdvi(map, mesIdx) {
    const G = R.zonal.regiao(), g = G.ndvi, n = g.w * g.h;
    const url = imagemGrade(g.w, g.h, (i) => { const v = g.v[mesIdx * n + i]; return v === 255 ? null : rampaNdvi(v / 200 - 0.2); });
    map.getSource("ndvi-img").updateImage({ url });
    return g.meses[mesIdx];
  }
  const CLASSES_DECL = [[3, [61, 190, 122, 90], "0–3% plano"], [8, [61, 190, 122, 200], "3–8% suave ondulado"],
    [13, [233, 196, 106, 230], "8–13% ondulado: atenção"], [20, [231, 140, 81, 240], "13–20% forte: erosão"], [999, [231, 111, 81, 255], "> 20%"]];
  function atualizarDeclividade(map) {
    const G = R.zonal.regiao(), g = G.relevo;
    const url = imagemGrade(g.w, g.h, (i) => { const d = g.dec[i] / 10; return CLASSES_DECL.find((c) => d <= c[0])[1]; });
    map.getSource("decl-img").updateImage({ url });
  }

  function quadrado(lon, lat, dx) {
    const h = dx / 2;
    return [[[lon - h, lat - h], [lon + h, lat - h], [lon + h, lat + h], [lon - h, lat + h], [lon - h, lat - h]]];
  }
  // Áreas de atenção: declividade > 8% (SRTM ~90 m) e vegetação nativa (MapBiomas, último ano) dentro do talhão
  function atualizarAtencao(map, anel) {
    const G = R.zonal.regiao(), feats = [];
    for (const c of R.zonal.celulasParaMapa(anel, "relevo")) {
      const d = G.relevo.dec[c.c] / 10;
      if (d > 8) feats.push({ type: "Feature", properties: { cor: CORES.amarelo, tipo: `Declividade ${d.toFixed(1)}%` }, geometry: { type: "Polygon", coordinates: quadrado(c.lon, c.lat, c.dx) } });
    }
    const mb = G.mapbiomas, ultimo = mb ? mb.anos.length - 1 : 0, n = mb ? mb.w * mb.h : 0;
    if (mb) for (const c of R.zonal.celulasParaMapa(anel, "mapbiomas")) {
      const cl = mb.v[ultimo * n + c.c], info = R.zonal.MAPBIOMAS[cl];
      if (info && info[1] === "nativa") feats.push({ type: "Feature", properties: { cor: CORES.vermelho, tipo: `${info[0]} (MapBiomas ${mb.anos[ultimo]})` }, geometry: { type: "Polygon", coordinates: quadrado(c.lon, c.lat, c.dx) } });
    }
    map.getSource("atencao").setData({ type: "FeatureCollection", features: feats });
    return feats;
  }
  function classeRisco(r) {
    if (r < 0.10) return { cor: CORES.verde, nome: "Favorável", faixa: "< 10% dos anos" };
    if (r < 0.25) return { cor: CORES.amarelo, nome: "Atenção", faixa: "10% a 25% dos anos" };
    return { cor: CORES.vermelho, nome: "Risco elevado", faixa: "> 25% dos anos" };
  }
  function atualizarRisco(map, anel, risco) {
    const c = classeRisco(risco);
    map.getSource("risco").setData({ type: "Feature", properties: { cor: c.cor }, geometry: { type: "Polygon", coordinates: [[...anel, anel[0]]] } });
    return c;
  }
  function mostrar(map, id, on) { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); }

  R.mapa = { criarMapa, instalarCamadas, trocarRegiaoMapa, atualizarUso, definirGibs, atualizarNdvi, atualizarDeclividade, atualizarAtencao, atualizarRisco,
             classeRisco, mostrar, rampaNdvi, CLASSES_DECL, CORES };
})(globalThis.Rotare = globalThis.Rotare || {});
