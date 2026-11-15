// Aviso de SI: arquivo escrito com ajuda de IA (Claude), sob direção do time Datanauts Brasil.
// Camada de explicação. Nesta versão os textos são montados por regras a partir dos números do motor:
// nenhum número é criado aqui. A interface explicar(card, ctx) é o ponto para plugar um LLM no futuro,
// que receberia só o JSON calculado e devolveria texto (sem poder alterar valores).
(function (R) {
  "use strict";
  const { CULTURAS, SEGUNDA_SAFRA } = R.catalogo;
  const pct = (x) => `${Math.round(x * 100)}%`;
  const n0 = (x) => Math.round(x).toLocaleString("en-US");
  const NOMES_EIXO = { solo: "Soil health", risco: "Climate risk", agua: "Water efficiency", renda: "Relative income" };

  function nomeSeq(seq) { return seq.map((o) => `Soybean → ${SEGUNDA_SAFRA[o].nome}`).join(" | "); }

  function contribuicoes(card, ref, pesos) {
    const eixos = ["solo", "risco", "agua", "renda"];
    return eixos.map((e) => {
      const v = e === "risco" ? 100 - card.notas.risco : card.notas[e];
      const vr = ref ? (e === "risco" ? 100 - ref.notas.risco : ref.notas[e]) : 50;
      return { eixo: e, peso: pesos[e], nota: card.notas[e], delta: v - vr, efeito: pesos[e] * (v - vr) };
    }).sort((a, b) => b.efeito - a.efeito);
  }

  function porque(card, ctx) {
    const atual = ctx.cartoes.find((c) => c.id === "atual");
    const ref = atual && atual !== card ? atual : null;
    const c = contribuicoes(card, ref, ctx.pesos);
    const fortes = c.filter((x) => x.efeito > 0.5).slice(0, 2);
    const fracos = c.filter((x) => x.efeito < -0.5).slice(-1);
    const m = card.metricas;
    const partes = [];
    partes.push(`With your weights (${["solo", "risco", "agua", "renda"].map((e) => `${{ solo: "soil", risco: "risk", agua: "water", renda: "income" }[e]} ${pct(ctx.pesos[e])}`).join(", ")}), this sequence scores ${card.pontuacao.toFixed(0)} points and ranks #${card.posicao} of ${ctx.cartoes.length}.`);
    if (ref && fortes.length) {
      partes.push(`Compared with your current rotation, what helps most: ${fortes.map((f) => `${NOMES_EIXO[f.eixo].toLowerCase()} (${f.eixo === "risco" ? (f.delta > 0 ? "lower" : "higher") + " risk" : (f.delta > 0 ? "+" : "") + f.delta.toFixed(0) + " points"})`).join(" and ")}.`);
    }
    if (ref && fracos.length) partes.push(`What works against it: ${NOMES_EIXO[fracos[0].eixo].toLowerCase()}.`);
    partes.push(`Over the ${ctx.anos.length} years used in the calculation, the average chance of a cash-crop failure per year is ${pct(m.risco)}, the crops use ${pct(m.agua)} of the rain and leave ${m.solo.palhada.toFixed(0)} t/ha of straw over 3 years.`);
    return partes.join(" ");
  }

  function beneficios(card) {
    const m = card.metricas, s = m.solo, out = [];
    const cob = card.seq.filter((o) => ["braquiaria", "milheto", "consorcio"].includes(o)).length;
    if (cob) out.push(`${cob} of 3 years with a cover crop: more straw (${s.palhada.toFixed(0)} t/ha over 3 years) and deep roots that recycle nutrients.`);
    if (s.erosao >= 0.7) out.push(`Bare soil only ${Math.round(s.diasDescobertos)} days per year on average: less exposure to erosion.`);
    if (new Set(card.seq).size >= 2) out.push(`Alternates ${new Set(card.seq).size} different second crops, which helps break pest and disease cycles.`);
    if (m.agua >= 0.5) out.push(`The crops use ${pct(m.agua)} of the year's rain instead of letting it drain away or evaporate from bare soil.`);
    if (card.seq.includes("sorgo") || card.seq.includes("milheto")) out.push("Sorghum and millet handle an early end of the rainy season better than corn.");
    if (!out.length) out.push("Keeps the system you already know, with no change in machinery or logistics.");
    return out;
  }

  function riscos(card, ctx) {
    const out = [];
    const r = ctx.resumo;
    for (const o of new Set(card.seq)) {
      const op = SEGUNDA_SAFRA[o];
      if (r[o].foraJanela > 0.05) out.push(`${op.nome}: in ${pct(r[o].foraJanela)} of the years the soybean harvest comes too late to plant within the window.`);
      for (const cid of op.culturas) {
        if (CULTURAS[cid].papel !== "comercial") continue;
        const quebras = r[o].porAno.filter((a) => a.r.culturas[cid] && a.r.culturas[cid].falha && !a.r.culturas[cid].foraJanela).length;
        if (quebras / r[o].porAno.length > 0.1) out.push(`${CULTURAS[cid].nome}: serious water shortage (relative yield below 80%) in ${quebras} of ${r[o].porAno.length} years of the scenario.`);
      }
    }
    if (card.seq.includes("algodao")) out.push("Cotton requires intensive boll weevil management and more capital per hectare.");
    if (card.seq.includes("consorcio")) out.push("In the intercrop, brachiaria can compete with corn if seeding and herbicide rates are not adjusted.");
    if (card.metricas.irrigacao > 1) out.push(`Depends on irrigation: on average ${n0(card.metricas.irrigacao)} mm per year in the current scenario.`);
    const soja = r[card.seq[0]].porAno.filter((a) => a.r.culturas.soja.falha).length;
    if (soja) out.push(`Soybean: strong water deficit in ${soja} of ${r[card.seq[0]].porAno.length} years; this applies to every strategy.`);
    if (!out.length) out.push("No climate risk above 10% of years was found in this scenario.");
    return out;
  }

  function naoSabemos(ctx) {
    const out = [
      ctx.laudo ? "We used your soil test." : "No soil test: texture and carbon are SoilGrids estimates (250 m). A lab soil test improves the result.",
      "Rain and temperature come from regional grids (CHIRPS ~5 km, NASA POWER ~55 km): neighboring fields get the same value.",
      "Prices, production costs and seed availability are not included. Income is a relative index (soybean = 1).",
      "The field's history of pests, diseases and weeds is unknown.",
      "250 m NDVI cannot tell corn, sorghum and millet apart: the history is inferred and you confirm it.",
    ];
    if (ctx.aoVivo) out.push("The engine uses the Central Brazil calendar (soybean + second crop). Outside that system, results are indicative.");
    for (const a of ctx.alertasUso || []) out.unshift(a);
    return out;
  }

  function explicar(card, ctx) {
    return { porque: porque(card, ctx), beneficios: beneficios(card), riscos: riscos(card, ctx), naoSabemos: naoSabemos(ctx) };
  }

  // Interpretação do texto livre do produtor em pesos iniciais (regras por palavra-chave; ele ajusta depois)
  const TERMOS = {
    solo: ["solo", "palha", "palhada", "erosão", "erosao", "matéria orgânica", "materia organica", "compact", "nematoide", "praga", "conserv", "regener", "cobertura", "fertilidade", "soil", "straw", "erosion", "organic matter", "compaction", "pest", "conservation", "regenerat", "cover", "fertility"],
    risco: ["risco", "seca", "veranico", "segurança", "seguranca", "perder", "quebra", "clima", "el niño", "el nino", "estabilidade", "garantir", "risk", "drought", "dry spell", "safety", "lose", "failure", "climate", "stability"],
    agua: ["água", "agua", "chuva", "irriga", "umidade", "hídric", "hidric", "water", "rain", "irrigat", "moisture"],
    renda: ["renda", "lucro", "dinheiro", "rentab", "margem", "ganhar", "retorno", "preço", "preco", "mercado", "pagar", "income", "profit", "money", "margin", "return", "price", "market"],
  };
  function interpretarPrioridades(texto) {
    const t = (texto || "").toLowerCase();
    const achados = {};
    const pesos = { solo: 1, risco: 1, agua: 1, renda: 1 };
    for (const [eixo, termos] of Object.entries(TERMOS)) {
      achados[eixo] = termos.filter((x) => t.includes(x));
      pesos[eixo] += achados[eixo].length * 1.5;
    }
    const total = Object.values(achados).reduce((s, a) => s + a.length, 0);
    return { pesos: R.rotacao.normalizarPesos(pesos), achados, reconheceu: total > 0 };
  }

  R.explica = { explicar, interpretarPrioridades, nomeSeq, NOMES_EIXO };
})(globalThis.Rotare = globalThis.Rotare || {});
