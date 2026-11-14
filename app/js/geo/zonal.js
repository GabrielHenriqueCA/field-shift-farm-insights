// Aviso de SI: arquivo escrito com ajuda de IA (Claude), sob direção do time Datanauts Brasil.
// Estatística zonal no navegador: agrega as grades regionais (NDVI, MapBiomas, SoilGrids, SRTM) ao polígono do talhão.
(function (R) {
  "use strict";

  function decodificar(b64, Tipo) {
    const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return Tipo ? new Tipo(bytes.buffer) : bytes;
  }

  // Região ativa: a pré-processada (Sorriso) ou um pacote buscado ao vivo pelo servidor
  let cache = null;
  function decodificarRegiao(G) {
    return {
      nome: G.nome, bbox: G.bbox, aoVivo: !!G.aoVivo,
      ndvi: { ...G.ndvi, v: decodificar(G.ndvi.dados) },
      mapbiomas: G.mapbiomas ? { ...G.mapbiomas, v: decodificar(G.mapbiomas.dados) } : null,
      worldcover: G.worldcover ? { ...G.worldcover, v: decodificar(G.worldcover.dados) } : null,
      solo: { ...G.solo, areia: decodificar(G.solo.areia), argila: decodificar(G.solo.argila), carbono: decodificar(G.solo.carbono) },
      relevo: { ...G.relevo, alt: decodificar(G.relevo.altitude, Int16Array), dec: decodificar(G.relevo.declividade) },
    };
  }
  function regiao() {
    if (cache) return cache;
    const G = globalThis.ROTARE_REGIAO;
    if (!G) return null;
    cache = decodificarRegiao(G);
    return cache;
  }
  function definirRegiao(G) { cache = G ? decodificarRegiao(G) : null; return regiao(); }
  function regiaoPadrao() { return globalThis.ROTARE_REGIAO || null; }

  // ----- geometria -----
  function pontoNoPoligono(x, y, anel) {
    let dentro = false;
    for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
      const [xi, yi] = anel[i], [xj, yj] = anel[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
  }
  function caixa(anel) {
    const xs = anel.map((p) => p[0]), ys = anel.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  function cobertura(anel, G = regiao()) {
    if (!G) return "sem_dados";
    const [W, S, E, N] = G.bbox;
    const dentro = anel.filter(([x, y]) => x >= W && x <= E && y >= S && y <= N).length;
    if (dentro === anel.length) return "total";
    return dentro ? "parcial" : "fora";
  }

  // Células cujo centro cai no polígono. Se nenhuma (talhão menor que a célula), usa a mais próxima do centro.
  function celulas(anel, grade) {
    const G = regiao(), [W, , , N] = G.bbox, dx = grade.dx;
    const [x0, y0, x1, y1] = caixa(anel);
    const i0 = Math.max(0, Math.floor((x0 - W) / dx)), i1 = Math.min(grade.w - 1, Math.floor((x1 - W) / dx));
    const j0 = Math.max(0, Math.floor((N - y1) / dx)), j1 = Math.min(grade.h - 1, Math.floor((N - y0) / dx));
    const out = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (pontoNoPoligono(W + (i + 0.5) * dx, N - (j + 0.5) * dx, anel)) out.push(j * grade.w + i);
    }
    let aproximado = false;
    if (!out.length) {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const i = Math.min(grade.w - 1, Math.max(0, Math.floor((cx - W) / dx)));
      const j = Math.min(grade.h - 1, Math.max(0, Math.floor((N - cy) / dx)));
      out.push(j * grade.w + i); aproximado = true;
    }
    return { idx: out, aproximado };
  }

  // ----- agregações -----
  function serieNdvi(anel) {
    const G = regiao(), g = G.ndvi, n = g.w * g.h, { idx, aproximado } = celulas(anel, g);
    const serie = g.meses.map((m, b) => {
      let s = 0, k = 0;
      for (const c of idx) { const v = g.v[b * n + c]; if (v !== 255) { s += v / 200 - 0.2; k++; } }
      return { mes: m, ndvi: k ? s / k : null, n: k };
    });
    return { serie, celulas: idx.length, aproximado, resolucao: "~270 m", fonte: g.fonte };
  }

  const MAPBIOMAS = {
    3: ["Formação florestal", "nativa"], 4: ["Formação savânica", "nativa"], 5: ["Mangue", "nativa"],
    6: ["Floresta alagável", "nativa"], 11: ["Campo alagado", "nativa"], 12: ["Formação campestre", "nativa"],
    9: ["Silvicultura", "uso"], 15: ["Pastagem", "uso"], 39: ["Soja", "lavoura"], 20: ["Cana", "lavoura"],
    40: ["Arroz", "lavoura"], 41: ["Outras lavouras temporárias", "lavoura"], 62: ["Algodão", "lavoura"],
    21: ["Mosaico de usos", "uso"], 24: ["Área urbanizada", "outro"], 25: ["Outra área não vegetada", "outro"],
    33: ["Rio, lago", "agua"], 0: ["Sem dado", "outro"],
  };
  function usoTerra(anel) {
    const G = regiao(), g = G.mapbiomas;
    if (!g) return null;
    const n = g.w * g.h, { idx } = celulas(anel, g);
    return g.anos.map((ano, b) => {
      const cont = {};
      for (const c of idx) { const v = g.v[b * n + c]; cont[v] = (cont[v] || 0) + 1; }
      const pares = Object.entries(cont).sort((a, b2) => b2[1] - a[1]);
      const nativa = pares.filter(([k]) => (MAPBIOMAS[k] || [])[1] === "nativa").reduce((s, [, v]) => s + v, 0);
      const [cl, q] = pares[0];
      return { ano, classe: +cl, nome: (MAPBIOMAS[cl] || ["Classe " + cl])[0], fracao: q / idx.length,
               fracaoNativa: nativa / idx.length };
    });
  }

  // Uso do solo hoje (ESA WorldCover 10 m): o que existe dentro do polígono
  const WORLDCOVER = {
    10: ["Árvores", "#1f6b3a", "mata"], 20: ["Arbustos", "#8a9a3b", "mata"], 30: ["Campo / pastagem", "#c9d36a", "agricola"],
    40: ["Lavoura", "#E9C46A", "agricola"], 50: ["Construções", "#E76F51", "urbano"], 60: ["Solo exposto", "#b9a58c", "agricola"],
    70: ["Neve e gelo", "#f0f0f0", "outro"], 80: ["Água", "#4C8DF6", "agua"], 90: ["Área úmida", "#3b9c9c", "agua"],
    95: ["Mangue", "#1c8a6e", "mata"], 100: ["Musgo e líquen", "#d9c9a3", "outro"], 0: ["Sem dado", "#555", "outro"],
  };
  function usoAtual(anel) {
    const G = regiao(), g = G.worldcover;
    if (!g) return null;
    const { idx, aproximado } = celulas(anel, g), cont = {};
    for (const c of idx) cont[g.v[c]] = (cont[g.v[c]] || 0) + 1;
    const classes = Object.entries(cont).map(([k, q]) => ({ classe: +k, nome: (WORLDCOVER[k] || ["Classe " + k])[0],
      cor: (WORLDCOVER[k] || [0, "#777"])[1], grupo: (WORLDCOVER[k] || [0, 0, "outro"])[2], fracao: q / idx.length }))
      .sort((a, b) => b.fracao - a.fracao);
    const soma = (grupo) => classes.filter((c) => c.grupo === grupo).reduce((s, c) => s + c.fracao, 0);
    const lavoura = (classes.find((c) => c.classe === 40) || { fracao: 0 }).fracao;
    const r = { classes, urbano: soma("urbano"), agua: soma("agua"), mata: soma("mata"), agricola: soma("agricola"), lavoura,
                celulas: idx.length, aproximado, resolucao: `~${Math.round(g.dx * 111000)} m`, fonte: g.fonte };
    const alertas = [];
    if (r.urbano >= 0.15) alertas.push({ nivel: r.urbano >= 0.5 ? "bloqueio" : "atencao", texto: `${Math.round(r.urbano * 100)}% do polígono são construções (casas, galpões, vias). Isso não é solo agrícola.` });
    if (r.agua >= 0.15) alertas.push({ nivel: r.agua >= 0.5 ? "bloqueio" : "atencao", texto: `${Math.round(r.agua * 100)}% do polígono é água ou área úmida.` });
    if (r.mata >= 0.25) alertas.push({ nivel: r.mata >= 0.6 ? "bloqueio" : "atencao", texto: `${Math.round(r.mata * 100)}% do polígono tem árvores ou arbustos. Verifique se é vegetação nativa protegida.` });
    r.alertas = alertas;
    r.naoAgricola = r.agricola < 0.5;
    r.bloqueio = alertas.some((a) => a.nivel === "bloqueio") || r.naoAgricola;
    return r;
  }

  // Saxton & Rawls (2006): umidade na capacidade de campo e no ponto de murcha (m³/m³)
  function saxtonRawls(areia, argila, carbonoGkg) {
    const s = areia / 100, c = argila / 100, mo = Math.min(8, (carbonoGkg / 10) * 1.724);
    const t1500 = -0.024 * s + 0.487 * c + 0.006 * mo + 0.005 * s * mo - 0.013 * c * mo + 0.068 * s * c + 0.031;
    const th1500 = t1500 + (0.14 * t1500 - 0.02);
    const t33 = -0.251 * s + 0.195 * c + 0.011 * mo + 0.006 * s * mo - 0.027 * c * mo + 0.452 * s * c + 0.299;
    const th33 = t33 + (1.283 * t33 * t33 - 0.374 * t33 - 0.015);
    return { cc: th33, pmp: th1500 };
  }
  function classeTextura(areia, argila) {
    if (argila >= 60) return "Muito argilosa";
    if (argila >= 35) return "Argilosa";
    if (areia >= 70 && argila < 15) return "Arenosa";
    return "Média (franco)";
  }
  function solo(anel) {
    const G = regiao(), g = G.solo, { idx, aproximado } = celulas(anel, g);
    let a = 0, r = 0, c = 0, k = 0;
    for (const i of idx) {
      if (g.areia[i] === 255 || g.argila[i] === 255) continue;
      a += g.areia[i]; r += g.argila[i]; c += g.carbono[i] / 4; k++;
    }
    if (!k) return null;
    a /= k; r /= k; c /= k;
    const { cc, pmp } = saxtonRawls(a, r, c);
    return { areia: a, argila: r, carbono: c, textura: classeTextura(a, r), cc, pmp, cad: (cc - pmp) * 1000,
             celulas: idx.length, aproximado, resolucao: "250 m", fonte: g.fonte };
  }
  function relevo(anel) {
    const G = regiao(), g = G.relevo, { idx, aproximado } = celulas(anel, g);
    let s = 0, d = 0, mn = Infinity, mx = -Infinity, atencao = 0, dmax = 0;
    for (const i of idx) {
      const alt = g.alt[i], dec = g.dec[i] / 10;
      s += alt; d += dec; mn = Math.min(mn, alt); mx = Math.max(mx, alt); dmax = Math.max(dmax, dec);
      if (dec > 8) atencao++;
    }
    const n = idx.length;
    return { altitude: s / n, altMin: mn, altMax: mx, declividade: d / n, declMax: dmax, fracaoAtencao: atencao / n,
             celulas: n, aproximado, resolucao: "~90 m", fonte: g.fonte };
  }

  // Células para as camadas do mapa (centros dentro do polígono)
  function celulasParaMapa(anel, nome) {
    const G = regiao(), g = G[nome], [W, , , N] = G.bbox, { idx } = celulas(anel, g);
    return idx.map((c) => {
      const i = c % g.w, j = Math.floor(c / g.w);
      return { c, i, j, lon: W + (i + 0.5) * g.dx, lat: N - (j + 0.5) * g.dx, dx: g.dx };
    });
  }

  R.zonal = { regiao, definirRegiao, regiaoPadrao, usoAtual, WORLDCOVER, cobertura, celulas, serieNdvi, usoTerra, solo, relevo, saxtonRawls, pontoNoPoligono,
              celulasParaMapa, MAPBIOMAS, decodificar };
})(globalThis.Rotare = globalThis.Rotare || {});
