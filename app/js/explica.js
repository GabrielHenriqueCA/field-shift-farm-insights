// Aviso de SI: arquivo escrito com ajuda de IA (Claude), sob direção do time Datanauts Brasil.
// Camada de explicação. Nesta versão os textos são montados por regras a partir dos números do motor:
// nenhum número é criado aqui. A interface explicar(card, ctx) é o ponto para plugar um LLM no futuro,
// que receberia só o JSON calculado e devolveria texto (sem poder alterar valores).
(function (R) {
  "use strict";
  const { CULTURAS, SEGUNDA_SAFRA } = R.catalogo;
  const pct = (x) => `${Math.round(x * 100)}%`;
  const n0 = (x) => Math.round(x).toLocaleString("pt-BR");
  const NOMES_EIXO = { solo: "Saúde do solo", risco: "Risco climático", agua: "Eficiência hídrica", renda: "Renda relativa" };

  function nomeSeq(seq) { return seq.map((o) => `Soja → ${SEGUNDA_SAFRA[o].nome}`).join(" | "); }

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
    partes.push(`Com os seus pesos (${["solo", "risco", "agua", "renda"].map((e) => `${NOMES_EIXO[e].split(" ")[0].toLowerCase()} ${pct(ctx.pesos[e])}`).join(", ")}), esta sequência soma ${card.pontuacao.toFixed(0)} pontos e fica em ${card.posicao}º entre ${ctx.cartoes.length}.`);
    if (ref && fortes.length) {
      partes.push(`Em relação à sua rotação atual, o que mais pesa a favor: ${fortes.map((f) => `${NOMES_EIXO[f.eixo].toLowerCase()} (${f.eixo === "risco" ? "risco " + (f.delta > 0 ? "menor" : "maior") : (f.delta > 0 ? "+" : "") + f.delta.toFixed(0) + " pontos"})`).join(" e ")}.`);
    }
    if (ref && fracos.length) partes.push(`O que pesa contra: ${NOMES_EIXO[fracos[0].eixo].toLowerCase()}.`);
    partes.push(`Nos ${ctx.anos.length} anos usados no cálculo, a chance média de quebra de uma safra comercial por ano é ${pct(m.risco)}, as culturas aproveitam ${pct(m.agua)} da chuva e deixam ${m.solo.palhada.toFixed(0)} t/ha de palhada em 3 anos.`);
    return partes.join(" ");
  }

  function beneficios(card) {
    const m = card.metricas, s = m.solo, out = [];
    const cob = card.seq.filter((o) => ["braquiaria", "milheto", "consorcio"].includes(o)).length;
    if (cob) out.push(`${cob} de 3 anos com planta de cobertura: mais palhada (${s.palhada.toFixed(0)} t/ha em 3 anos) e raízes profundas que reciclam nutrientes.`);
    if (s.erosao >= 0.7) out.push(`Solo descoberto só ${Math.round(s.diasDescobertos)} dias por ano em média: menor exposição à erosão.`);
    if (new Set(card.seq).size >= 2) out.push(`Alterna ${new Set(card.seq).size} segundas safras diferentes, o que ajuda a quebrar ciclos de pragas e doenças.`);
    if (m.agua >= 0.5) out.push(`As culturas usam ${pct(m.agua)} da chuva do ano, em vez de deixá-la drenar ou evaporar do solo nu.`);
    if (card.seq.includes("sorgo") || card.seq.includes("milheto")) out.push("Sorgo e milheto toleram melhor o fim antecipado das chuvas que o milho.");
    if (!out.length) out.push("Mantém o sistema que você já conhece, sem mudança de maquinário ou de logística.");
    return out;
  }

  function riscos(card, ctx) {
    const out = [];
    const r = ctx.resumo;
    for (const o of new Set(card.seq)) {
      const op = SEGUNDA_SAFRA[o];
      if (r[o].foraJanela > 0.05) out.push(`${op.nome}: em ${pct(r[o].foraJanela)} dos anos a soja sai tarde demais para plantar dentro da janela.`);
      for (const cid of op.culturas) {
        if (CULTURAS[cid].papel !== "comercial") continue;
        const quebras = r[o].porAno.filter((a) => a.r.culturas[cid] && a.r.culturas[cid].falha && !a.r.culturas[cid].foraJanela).length;
        if (quebras / r[o].porAno.length > 0.1) out.push(`${CULTURAS[cid].nome}: falta d'água séria (produtividade relativa abaixo de 80%) em ${quebras} de ${r[o].porAno.length} anos do cenário.`);
      }
    }
    if (card.seq.includes("algodao")) out.push("Algodão exige manejo intenso de bicudo e mais capital por hectare.");
    if (card.seq.includes("consorcio")) out.push("No consórcio, a braquiária pode competir com o milho se a semeadura e a dose de herbicida não forem ajustadas.");
    if (card.metricas.irrigacao > 1) out.push(`Depende de irrigação: em média ${n0(card.metricas.irrigacao)} mm por ano no cenário atual.`);
    const soja = r[card.seq[0]].porAno.filter((a) => a.r.culturas.soja.falha).length;
    if (soja) out.push(`Soja: déficit hídrico forte em ${soja} de ${r[card.seq[0]].porAno.length} anos, vale para todas as estratégias.`);
    if (!out.length) out.push("Nenhum risco climático acima de 10% dos anos foi encontrado neste cenário.");
    return out;
  }

  function naoSabemos(ctx) {
    const out = [
      ctx.laudo ? "Usamos o seu laudo de solo." : "Sem laudo de solo: textura e carbono são estimativas do SoilGrids (250 m). Um laudo melhora o resultado.",
      "Chuva e temperatura vêm de grades regionais (CHIRPS ~5 km, NASA POWER ~55 km): o valor é o mesmo para talhões vizinhos.",
      "Preço, custo de produção e disponibilidade de semente não entram. A renda é um índice relativo (soja = 1).",
      "Histórico de pragas, doenças e plantas daninhas do talhão não é conhecido.",
      "O NDVI de 250 m não distingue milho, sorgo e milheto: o histórico é inferido e você confirma.",
    ];
    if (ctx.aoVivo) out.push("O calendário do motor é o do Brasil Central (soja + 2ª safra). Fora desse sistema, os resultados são indicativos.");
    for (const a of ctx.alertasUso || []) out.unshift(a);
    return out;
  }

  function explicar(card, ctx) {
    return { porque: porque(card, ctx), beneficios: beneficios(card), riscos: riscos(card, ctx), naoSabemos: naoSabemos(ctx) };
  }

  // Interpretação do texto livre do produtor em pesos iniciais (regras por palavra-chave; ele ajusta depois)
  const TERMOS = {
    solo: ["solo", "palha", "palhada", "erosão", "erosao", "matéria orgânica", "materia organica", "compact", "nematoide", "praga", "conserv", "regener", "cobertura", "fertilidade"],
    risco: ["risco", "seca", "veranico", "segurança", "seguranca", "perder", "quebra", "clima", "el niño", "el nino", "estabilidade", "garantir"],
    agua: ["água", "agua", "chuva", "irriga", "umidade", "hídric", "hidric"],
    renda: ["renda", "lucro", "dinheiro", "rentab", "margem", "ganhar", "retorno", "preço", "preco", "mercado", "pagar"],
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
