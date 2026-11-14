// Aviso de SI: arquivo escrito com ajuda de IA (Claude), sob direção do time Datanauts Brasil.
// Balanço hídrico diário de um reservatório (FAO-56, cap. 8: Ks pela depleção do solo) e resposta da
// produtividade relativa ao déficit (FAO-33: 1 - Yr = Ky (1 - ETa/ETc)). Determinístico e sem IA.
(function (R) {
  "use strict";
  const { CULTURAS, SEGUNDA_SAFRA } = R.catalogo;
  const DIA = 86400000;

  // ----- calendário -----
  function indiceDe(clima, iso) {
    return Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(clima.inicio + "T00:00:00Z")) / DIA);
  }
  function dataDe(clima, i) {
    return new Date(Date.parse(clima.inicio + "T00:00:00Z") + i * DIA).toISOString().slice(0, 10);
  }
  // Ano agrícola y = 1/set de y até 31/ago de y+1 (365 dias, 29/fev ignorado no fim)
  function anosDisponiveis(clima) {
    const ultimo = dataDe(clima, clima.chuva.length - 1);
    const anos = [];
    for (let y = +clima.inicio.slice(0, 4); ; y++) {
      if (`${y + 1}-08-31` > ultimo) break;
      if (`${y}-09-01` >= clima.inicio) anos.push(y);
    }
    return anos;
  }

  // ----- cenário climático (sliders) aplicado a um ano -----
  // chuva: fração (-0.4 a +0.2); temp: +°C (0 a 3). ET0 de Hargreaves é proporcional a (Tmed + 17,8).
  function anoClimatico(clima, y, cen) {
    const i0 = indiceDe(clima, `${y}-09-01`);
    const n = 365, fc = 1 + (cen?.chuva || 0), dT = cen?.temp || 0;
    const p = new Float64Array(n), et0 = new Float64Array(n), tmax = new Float64Array(n), tmin = new Float64Array(n);
    for (let d = 0; d < n; d++) {
      const i = i0 + d;
      const tmed = (clima.tmax[i] + clima.tmin[i]) / 2;
      p[d] = clima.chuva[i] * fc;
      et0[d] = clima.et0[i] * (tmed + dT + 17.8) / (tmed + 17.8);
      tmax[d] = clima.tmax[i] + dT;
      tmin[d] = clima.tmin[i] + dT;
    }
    return { ano: y, p, et0, tmax, tmin, data0: `${y}-09-01` };
  }

  // Início do período chuvoso (critério tipo Sivakumar, 1988): a partir de 15/set, primeiro dia com
  // ≥ 20 mm em 3 dias, sem veranico de 10 dias (< 5 mm) nos 30 dias seguintes. Limite: 15/dez.
  function inicioChuvas(a) {
    const d0 = 14, lim = 105;
    for (let d = d0; d <= lim; d++) {
      if (a.p[d] + a.p[d + 1] + a.p[d + 2] < 20) continue;
      let ok = true;
      for (let j = d + 3; j <= d + 21 && ok; j++) {
        let s = 0;
        for (let k = j; k < j + 10; k++) s += a.p[k];
        if (s < 5) ok = false;
      }
      if (ok) return { dia: d, tardio: false };
    }
    return { dia: lim, tardio: true };
  }
  // Fim do período chuvoso: último dia, até 31/mai, seguido de 20 dias com < 10 mm somados
  function fimChuvas(a) {
    for (let d = 150; d < 290; d++) {
      let s = 0;
      for (let k = d; k < d + 20; k++) s += a.p[k];
      if (s < 10) return d;
    }
    return 290;
  }

  function diaDoAnoAgricola(y, mmdd) {
    const [m, dd] = mmdd.split("-").map(Number);
    const ano = m >= 9 ? y : y + 1;
    return Math.round((Date.UTC(ano, m - 1, dd) - Date.UTC(y, 8, 1)) / DIA);
  }

  // Kc diário pelas 4 fases da FAO-56 (inicial, desenvolvimento, intermediária, final)
  function kcNoDia(c, t) {
    const [f1, f2, f3, f4] = c.fases, [ki, km, kf] = c.kc;
    if (t < f1) return ki;
    if (t < f1 + f2) return ki + (km - ki) * (t - f1) / f2;
    if (t < f1 + f2 + f3) return km;
    if (t < f1 + f2 + f3 + f4) return km + (kf - km) * (t - f1 - f2 - f3) / f4;
    return null;
  }
  function faseNoDia(c, t) {
    let acc = 0;
    for (let k = 0; k < 4; k++) { acc += c.fases[k]; if (t < acc) return k; }
    return 4;
  }
  const ciclo = (c) => c.fases.reduce((a, b) => a + b, 0);

  /**
   * Simula um ano agrícola: soja na abertura das chuvas e a opção de segunda safra logo após a colheita.
   * solo: { cad: mm de água disponível por metro }  irrigado: boolean
   */
  function simularAno(a, opcao, solo, irrigado) {
    const n = 365, cad = solo.cad;
    const ini = inicioChuvas(a);
    const soja = CULTURAS.soja;
    const plantios = [{ id: "soja", c: soja, d0: ini.dia }];
    const s1 = ini.dia + ciclo(soja) + 2;
    const op = SEGUNDA_SAFRA[opcao];
    const foraJanela = {};
    for (const cid of op.culturas) {
      const c = CULTURAS[cid];
      const limite = c.plantioAte ? diaDoAnoAgricola(a.ano, c.plantioAte) : n;
      // no consórcio a braquiária vai junto com o milho: se o milho não cabe na janela, nenhum dos dois entra
      const bloqueado = s1 > limite || (opcao === "consorcio" && cid === "braquiaria" && foraJanela.milho);
      if (bloqueado) { foraJanela[cid] = true; continue; }
      plantios.push({ id: cid, c, d0: s1, ateFim: cid === "braquiaria" });
    }

    const res = {};
    for (const pl of plantios) res[pl.id] = { etc: 0, eta: 0, ksCrit: 0, nCrit: 0, calor: 0, geada: 0, d0: pl.d0, dFim: null };
    let taw = cad * 0.3, dr = taw;          // fim da seca: perfil superficial esgotado
    let irrig = 0, etaTot = 0, pTot = 0, drenagem = 0, descobertos = 0;
    let palhada = 0, kPalhada = 0.008;      // t/ha e decaimento diário (meia-vida ~ 87 dias)

    for (let d = 0; d < n; d++) {
      // cultura ativa (a mais recente que estiver no ciclo; no consórcio, milho e braquiária juntos)
      let kc = null, raiz = 0.3, p = 0.5, ativos = [];
      for (const pl of plantios) {
        const t = d - pl.d0;
        if (t < 0) continue;
        let k = kcNoDia(pl.c, t);
        if (k === null && pl.ateFim) k = pl.c.kc[2];      // braquiária fica até a dessecação (fim do ano)
        if (k === null) {
          if (res[pl.id].dFim === null) {
            res[pl.id].dFim = d;
            const ry = rendRel(pl.c, res[pl.id]);
            palhada += pl.c.palhada * ry;
            kPalhada = pl.c.familia === "Fabaceae" ? 0.014 : 0.006;
          }
          continue;
        }
        ativos.push({ pl, t, k });
      }
      if (ativos.length) {
        // consórcio: o dossel é dominado pela maior Kc; raiz pela mais profunda
        kc = Math.max(...ativos.map((x) => x.k));
        raiz = Math.max(...ativos.map((x) => Math.min(x.pl.c.raiz, 0.2 + (x.pl.c.raiz - 0.2) * Math.min(1, x.t / (x.pl.c.fases[0] + x.pl.c.fases[1])))));
        p = Math.min(...ativos.map((x) => x.pl.c.p));
      } else {
        kc = palhada >= 4 ? 0.15 : 0.25;                    // solo nu ou com palha (evaporação)
      }
      palhada *= Math.exp(-kPalhada);
      const cobertoDossel = ativos.some((x) => x.t >= x.pl.c.fases[0]);
      if (!cobertoDossel && palhada < 2.5) descobertos++;

      // reservatório: mantém a depleção relativa quando a raiz cresce
      const tawNovo = cad * raiz;
      dr = (dr / taw) * tawNovo; taw = tawNovo;
      const raw = p * taw;

      pTot += a.p[d];
      dr -= a.p[d];
      if (dr < 0) { drenagem += -dr; dr = 0; }
      if (irrigado && ativos.length && dr > raw) { irrig += dr; dr = 0; }
      const etc = kc * a.et0[d];
      const ks = dr > raw ? Math.max(0, (taw - dr) / ((1 - p) * taw)) : 1;
      const eta = ks * etc;
      dr = Math.min(taw, dr + eta);
      etaTot += eta;

      for (const x of ativos) {
        const r = res[x.pl.id];
        const etcC = x.k * a.et0[d];
        r.etc += etcC; r.eta += ks * etcC;
        if (faseNoDia(x.pl.c, x.t) === x.pl.c.critica) {
          r.ksCrit += ks; r.nCrit++;
          if (a.tmax[d] > 35) r.calor++;
        }
        if (a.tmin[d] <= 2) r.geada++;
      }
    }

    const culturas = {};
    for (const pl of plantios) {
      const r = res[pl.id];
      const ry = rendRel(pl.c, r);
      culturas[pl.id] = {
        rendRel: ry, etc: r.etc, eta: r.eta, ksCritico: r.nCrit ? r.ksCrit / r.nCrit : 1,
        calor: r.calor, geada: r.geada, plantio: pl.d0, colheita: r.dFim,
        falha: pl.c.papel === "comercial" ? ry < 0.8 : ry < 0.6,
      };
    }
    for (const cid of Object.keys(foraJanela)) culturas[cid] = { foraJanela: true, falha: true, rendRel: 0 };
    return {
      ano: a.ano, opcao, inicioChuvas: ini.dia, inicioTardio: ini.tardio, fimChuvas: fimChuvas(a),
      semeaduraSegunda: s1, culturas, chuva: pTot, eta: etaTot, irrigacao: irrig, drenagem,
      diasDescobertos: descobertos, palhadaFinal: palhada,
    };
  }

  function rendRel(c, r) {
    if (!r.etc) return 0;
    return Math.max(0, Math.min(1, 1 - c.ky * (1 - r.eta / r.etc)));
  }

  R.balanco = { anoClimatico, simularAno, inicioChuvas, fimChuvas, anosDisponiveis, indiceDe, dataDe, diaDoAnoAgricola, kcNoDia };
})(globalThis.Rotare = globalThis.Rotare || {});
