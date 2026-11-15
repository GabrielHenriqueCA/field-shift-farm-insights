// Aviso de SI: arquivo escrito com ajuda de IA (Claude), sob direção do time Datanauts Brasil.
// Indicadores por sequência de 3 anos, normalização documentada, cenários e ranking. Determinístico e sem IA.
(function (R) {
  "use strict";
  const { CULTURAS, SEGUNDA_SAFRA, REGRAS } = R.catalogo;
  const B = R.balanco;
  const OPCOES = Object.keys(SEGUNDA_SAFRA);
  const COBERTURA = new Set(["milheto", "braquiaria", "consorcio"]);
  const ANOS_REFERENCIA = 30;          // normal móvel: as 30 safras completas mais recentes

  const PESOS_CENARIO = {
    equilibrio: { solo: 0.25, risco: 0.25, agua: 0.25, renda: 0.25 },
    conservacao: { solo: 0.60, risco: 0.10, agua: 0.20, renda: 0.10 },
    resiliencia: { solo: 0.10, risco: 0.55, agua: 0.25, renda: 0.10 },
  };

  function normalizarPesos(p) {
    const s = (p.solo || 0) + (p.risco || 0) + (p.agua || 0) + (p.renda || 0);
    if (!s) return { solo: 0.25, risco: 0.25, agua: 0.25, renda: 0.25 };
    return { solo: p.solo / s, risco: p.risco / s, agua: p.agua / s, renda: p.renda / s };
  }

  function anosAnalise(clima, cen) {
    const todos = B.anosDisponiveis(clima);
    if (cen && cen.elNino) {
      return todos.filter((y) => clima.enso_safra[y] && clima.enso_safra[y].fase === "el_nino_forte");
    }
    return todos.slice(-ANOS_REFERENCIA);
  }

  // Simula todas as opções de segunda safra em todos os anos do cenário: { opcao: [resultadoAno...] }
  function simularOpcoes(clima, solo, irrigado, cen) {
    const anos = anosAnalise(clima, cen);
    const out = {};
    for (const o of OPCOES) out[o] = [];
    for (const y of anos) {
      const a = B.anoClimatico(clima, y, cen);
      for (const o of OPCOES) out[o].push(B.simularAno(a, o, solo, irrigado));
    }
    return { anos, porOpcao: out };
  }

  // ----- métricas de um ano com uma opção -----
  function rendaAno(r) {
    const op = SEGUNDA_SAFRA[r.opcao];
    let v = CULTURAS.soja.renda * r.culturas.soja.rendRel;
    if (r.opcao === "consorcio") v += r.culturas.milho.foraJanela ? 0 : op.renda * r.culturas.milho.rendRel;
    else for (const cid of op.culturas) {
      const c = CULTURAS[cid], rc = r.culturas[cid];
      if (rc.foraJanela) continue;
      v += c.papel === "comercial" ? c.renda * rc.rendRel : c.renda;   // cobertura: custo fixo
    }
    return v;
  }
  function falhaAno(r) {
    if (r.culturas.soja.falha) return true;
    for (const cid of SEGUNDA_SAFRA[r.opcao].culturas) {
      if (CULTURAS[cid].papel === "comercial" && r.culturas[cid].falha) return true;
    }
    return false;
  }
  function aguaAno(r) {
    let eta = 0;
    for (const cid in r.culturas) eta += r.culturas[cid].eta || 0;
    return Math.min(1, eta / (r.chuva + r.irrigacao));
  }
  function palhadaAno(r) {
    const op = SEGUNDA_SAFRA[r.opcao];
    let v = CULTURAS.soja.palhada * r.culturas.soja.rendRel;
    if (r.opcao === "pousio") return v + op.palhada;
    if (r.opcao === "consorcio") return v + (r.culturas.milho.foraJanela ? 0 : op.palhada * r.culturas.milho.rendRel);
    for (const cid of op.culturas) if (!r.culturas[cid].foraJanela) v += CULTURAS[cid].palhada * r.culturas[cid].rendRel;
    return v;
  }
  function ciclagemOpcao(o) {
    const op = SEGUNDA_SAFRA[o];
    if (op.ciclagem !== undefined) return op.ciclagem;
    return Math.max(0, ...op.culturas.map((c) => CULTURAS[c].ciclagem));
  }

  // Resumo por opção (média nos anos do cenário) para avaliar as 343 sequências sem resimular
  function resumirOpcoes(sim) {
    const res = {};
    for (const o of OPCOES) {
      const lista = sim.porOpcao[o], n = lista.length;
      const m = (f) => lista.reduce((s, r) => s + f(r), 0) / n;
      res[o] = {
        renda: m(rendaAno), falha: m((r) => (falhaAno(r) ? 1 : 0)), agua: m(aguaAno), palhada: m(palhadaAno),
        descobertos: m((r) => r.diasDescobertos), irrigacao: m((r) => r.irrigacao),
        foraJanela: m((r) => (SEGUNDA_SAFRA[o].culturas.some((c) => r.culturas[c].foraJanela) ? 1 : 0)),
        porAno: lista.map((r) => ({ ano: r.ano, renda: rendaAno(r), falha: falhaAno(r), agua: aguaAno(r), r })),
      };
    }
    return res;
  }

  // ----- índice de solo (estrutura inspirada no Soil Conditioning Index do USDA-NRCS) -----
  function indiceSolo(seq, resumo, declividade) {
    const palhada = seq.reduce((s, o) => s + resumo[o].palhada, 0);
    const mo = Math.min(1, palhada / 37.5);                                   // 37,5 t/ha = 3 anos de soja + consórcio
    const nutrientes = seq.reduce((s, o) => s + 0.3 + 0.7 * ciclagemOpcao(o), 0) / 3;
    const fatorDeclive = Math.min(3, 1 + (declividade || 0) / 6);
    const descob = seq.reduce((s, o) => s + resumo[o].descobertos, 0) / 3 / 365;
    const erosao = Math.max(0, Math.min(1, 1 - descob * fatorDeclive));
    const distintas = new Set(seq).size;
    const anosCobertura = seq.filter((o) => COBERTURA.has(o)).length;
    let pragas = 0.6 * (distintas - 1) / 2 + 0.4 * anosCobertura / 3;
    if (seq.includes("algodao")) pragas -= 0.15;                              // pressão de bicudo
    if (seq.every((o) => o === "pousio")) pragas = 0.2;
    pragas = Math.max(0, Math.min(1, pragas));
    return { nutrientes, materiaOrganica: mo, erosao, pragas, total: (nutrientes + mo + erosao + pragas) / 4,
             palhada, diasDescobertos: descob * 365 };
  }

  function metricasSequencia(seq, resumo, declividade) {
    return {
      risco: seq.reduce((s, o) => s + resumo[o].falha, 0) / 3,                 // chance média de quebra por ano
      renda: seq.reduce((s, o) => s + resumo[o].renda, 0),                     // índice relativo, 3 anos
      agua: seq.reduce((s, o) => s + resumo[o].agua, 0) / 3,                   // fração da chuva usada pelas culturas
      solo: indiceSolo(seq, resumo, declividade),
      irrigacao: seq.reduce((s, o) => s + resumo[o].irrigacao, 0) / 3,
      foraJanela: seq.reduce((s, o) => s + resumo[o].foraJanela, 0) / 3,
    };
  }

  // Os anos são simulados de forma independente, então a ordem não muda as métricas: enumeramos combinações
  // (84 com 7 opções) e escolhemos a ordem que respeita as regras e mais alterna as culturas.
  function permutacoes(arr) {
    if (arr.length <= 1) return [arr];
    const out = [];
    arr.forEach((x, i) => permutacoes([...arr.slice(0, i), ...arr.slice(i + 1)]).forEach((p) => out.push([x, ...p])));
    return out;
  }
  function ordenar(comb) {
    let best = null, bestTroca = -1;
    for (const p of permutacoes(comb)) {
      if (REGRAS.some((r) => r.viola(p))) continue;
      const trocas = (p[0] !== p[1]) + (p[1] !== p[2]);
      if (trocas > bestTroca) { best = p; bestTroca = trocas; }
    }
    return best;
  }
  const chaveComb = (seq) => [...seq].sort().join("+");
  function sequenciasValidas(permitidas) {
    const ops = OPCOES.filter((o) => !permitidas || permitidas.has(o));
    const out = [];
    for (let i = 0; i < ops.length; i++) for (let j = i; j < ops.length; j++) for (let k = j; k < ops.length; k++) {
      const seq = ordenar([ops[i], ops[j], ops[k]]);
      if (seq) out.push(seq);
    }
    return out;
  }

  // Âncoras de normalização: pior e melhor valor entre TODAS as sequências válidas, no clima de referência
  function ancoras(resumoRef, declividade) {
    const todas = sequenciasValidas(null).map((s) => metricasSequencia(s, resumoRef, declividade));
    const mm = (f) => [Math.min(...todas.map(f)), Math.max(...todas.map(f))];
    return { risco: mm((m) => m.risco), renda: mm((m) => m.renda), agua: mm((m) => m.agua), solo: mm((m) => m.solo.total) };
  }
  const escala = (v, [a, b]) => (b - a < 1e-9 ? 50 : Math.max(0, Math.min(100, (100 * (v - a)) / (b - a))));

  function notas(m, anc) {
    return {
      solo: escala(m.solo.total, anc.solo),
      risco: escala(m.risco, anc.risco),          // quanto MAIOR, mais risco
      agua: escala(m.agua, anc.agua),
      renda: escala(m.renda, anc.renda),
    };
  }
  function pontuar(n, pesos) {
    const w = normalizarPesos(pesos);
    return w.solo * n.solo + w.risco * (100 - n.risco) + w.agua * n.agua + w.renda * n.renda;
  }

  function melhor(seqs, avaliar, pesos, excluir) {
    let best = null;
    for (const s of seqs) {
      if (excluir.has(chaveComb(s))) continue;
      const sc = pontuar(avaliar(s).notas, pesos);
      if (!best || sc > best.sc + 1e-9) best = { seq: s, sc };
    }
    return best && best.seq;
  }

  /**
   * Análise completa de um talhão.
   * ctx: { clima, solo: {cad, declividade}, irrigado, atual: [o,o,o], permitidas: Set|null, pesos, cenario: {chuva,temp,elNino} }
   * fixas: sequências dos cartões já mostrados (para manter os cartões e só reordenar quando o clima muda)
   */
  function analisar(ctx, fixas) {
    const decl = ctx.solo.declividade || 0;
    const ref = resumirOpcoes(simularOpcoes(ctx.clima, ctx.solo, ctx.irrigado, null));
    const anc = ancoras(ref, decl);
    const cen = ctx.cenario || {};
    const temCenario = cen.elNino || cen.chuva || cen.temp;
    const sim = temCenario ? simularOpcoes(ctx.clima, ctx.solo, ctx.irrigado, cen) : null;
    const resumo = sim ? resumirOpcoes(sim) : ref;
    // A fração da chuva usada sobe quando chove menos (o denominador encolhe). Para não parecer "melhora",
    // a eficiência hídrica é comparada entre as combinações no MESMO clima.
    if (sim) anc.agua = ancoras(resumo, decl).agua;
    const anos = sim ? sim.anos : anosAnalise(ctx.clima, null);

    const cache = new Map();
    const avaliar = (seq) => {
      const k = seq.join(">");
      if (!cache.has(k)) {
        const m = metricasSequencia(seq, resumo, decl);
        cache.set(k, { seq, metricas: m, notas: notas(m, anc) });
      }
      return cache.get(k);
    };
    const validas = sequenciasValidas(ctx.permitidas);

    let cartoes;
    if (fixas) {
      cartoes = fixas.map((f) => ({ ...f }));
    } else {
      const usadas = new Set();
      cartoes = [];
      if (ctx.atual) { cartoes.push({ id: "atual", titulo: "Your current rotation", seq: ctx.atual }); usadas.add(chaveComb(ctx.atual)); }
      const titulos = { equilibrio: "Farm balance", conservacao: "Soil conservation", resiliencia: "Climate resilience" };
      for (const id of ["equilibrio", "conservacao", "resiliencia"]) {
        const s = melhor(validas, avaliar, PESOS_CENARIO[id], usadas);
        if (s) { cartoes.push({ id, titulo: titulos[id], seq: s }); usadas.add(chaveComb(s)); }
      }
      const sob = melhor(validas, avaliar, ctx.pesos, new Set());
      if (sob && !usadas.has(chaveComb(sob))) cartoes.push({ id: "sobmedida", titulo: "Tailored to you", seq: sob });
    }

    for (const c of cartoes) {
      const a = avaliar(c.seq);
      c.metricas = a.metricas; c.notas = a.notas; c.pontuacao = pontuar(a.notas, ctx.pesos);
      c.porAno = anos.map((y, i) => {
        const linhas = c.seq.map((o) => resumo[o].porAno[i]);
        return { ano: y, renda: linhas.reduce((s, l) => s + l.renda, 0), quebras: linhas.filter((l) => l.falha).length,
                 detalhe: linhas.map((l) => l.r) };
      });
    }
    cartoes.sort((a, b) => b.pontuacao - a.pontuacao);
    cartoes.forEach((c, i) => { c.posicao = i + 1; c.recomendada = i === 0; });

    // Melhor sequência possível neste clima (pode não estar entre os cartões)
    const otima = melhor(validas, avaliar, ctx.pesos, new Set());
    const otimaFora = otima && !cartoes.some((c) => chaveComb(c.seq) === chaveComb(otima)) ? { seq: otima, ...avaliar(otima) } : null;

    return { cartoes, anos, ancoras: anc, resumo, otimaFora, pesos: normalizarPesos(ctx.pesos), cenario: cen,
             nSequencias: validas.length };
  }

  R.rotacao = { analisar, simularOpcoes, resumirOpcoes, metricasSequencia, indiceSolo, sequenciasValidas, normalizarPesos,
                pontuar, notas, ancoras, anosAnalise, chaveComb, ordenar, OPCOES, PESOS_CENARIO, ANOS_REFERENCIA };
})(globalThis.Rotare = globalThis.Rotare || {});
