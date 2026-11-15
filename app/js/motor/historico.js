// Aviso de SI: arquivo escrito com ajuda de IA (Claude), sob direção do time Datanauts Brasil.
// Inferência do histórico de safras a partir da curva mensal de NDVI (MODIS, ~270 m), validada pelo MapBiomas.
// Regras fenológicas simples e transparentes. Sempre é INFERÊNCIA: o produtor confirma ou corrige.
(function (R) {
  "use strict";

  const LIMIAR = { verao: 0.55, segunda: 0.50, julho: 0.60, cobertura: 0.45 };

  // serie: [{mes:'2014-07', ndvi}] começando em julho. Safra k = jul/(2014+k) a jun/(2015+k).
  function inferirSafras(serie, usoTerra) {
    const v = serie.map((s) => s.ndvi);
    const max = (...xs) => { const ok = xs.filter((x) => x !== null && x !== undefined); return ok.length ? Math.max(...ok) : null; };
    const min = (...xs) => { const ok = xs.filter((x) => x !== null && x !== undefined); return ok.length ? Math.min(...ok) : null; };
    const out = [];
    for (let k = 0; k * 12 + 11 < v.length; k++) {
      const o = k * 12, ano = +serie[o].mes.slice(0, 4);
      const verao = max(v[o + 5], v[o + 6], v[o + 7]);
      const vale = min(v[o + 7], v[o + 8]);
      const segunda = max(v[o + 9], v[o + 10]);
      const jul = v[o + 12] ?? null, ago = v[o + 13] ?? null;
      const mb = usoTerra ? usoTerra.find((u) => u.ano === ano + 1) || usoTerra.find((u) => u.ano === ano) : null;
      let opcao, texto, confianca;
      if (verao === null || verao < LIMIAR.verao) {
        opcao = null; texto = "No summer crop detected"; confianca = "media";
      } else if (segunda === null || segunda < LIMIAR.segunda) {
        opcao = "pousio"; texto = "Soybean, no second crop"; confianca = "media";
      } else if (jul !== null && jul >= LIMIAR.julho) {
        opcao = "algodao"; texto = "Soybean + long-cycle second crop (likely cotton)"; confianca = "baixa";
      } else if (jul !== null && ago !== null && jul >= LIMIAR.cobertura && ago >= LIMIAR.cobertura) {
        opcao = "consorcio"; texto = "Soybean + second crop with dry-season cover (likely corn + brachiaria)"; confianca = "baixa";
      } else {
        opcao = "milho"; texto = "Soybean + second crop (likely corn)"; confianca = "media";
      }
      out.push({ safra: `${ano}/${String(ano + 1).slice(2)}`, ano, verao, vale, segunda, jul, ago, opcao, texto, confianca,
                 mapbiomas: mb ? `${mb.nome} (${Math.round(mb.fracao * 100)}%)` : null,
                 confirmaSoja: mb ? mb.classe === 39 : null });
    }
    return out;
  }

  // Rotação atual = as segundas safras das 3 últimas safras detectadas, na ordem
  function rotacaoAtual(safras) {
    const ult = safras.filter((s) => s.opcao).slice(-3).map((s) => s.opcao);
    while (ult.length < 3) ult.unshift(ult[0] || "milho");
    return ult;
  }

  R.historico = { inferirSafras, rotacaoAtual, LIMIAR };
})(globalThis.Rotare = globalThis.Rotare || {});
