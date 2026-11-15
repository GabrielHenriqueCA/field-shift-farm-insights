// Aviso de SI: arquivo escrito com ajuda de IA (Claude), sob direção do time Datanauts Brasil.
// Catálogo agronômico inicial (rascunho T3): valores de literatura, a REVISAR pelo time antes da submissão.
// Kc, duração das fases e fração p: FAO-56 (Allen et al., 1998), tabelas 11, 12 e 22.
// Ky (resposta da produtividade ao déficit hídrico): FAO-33 (Doorenbos & Kassam, 1979).
// Palhada e ciclagem: ordens de grandeza de Embrapa (Sistema Plantio Direto no Cerrado).
// renda: índice RELATIVO de margem (soja = 1). Hipótese do time, não é preço nem reais.
(function (R) {
  "use strict";

  const CULTURAS = {
    soja: {
      nome: "Soybean", familia: "Fabaceae", papel: "comercial", cor: "#3DBE7A",
      fases: [20, 30, 40, 20], kc: [0.40, 1.15, 0.50], raiz: 0.9, p: 0.50, ky: 0.85,
      palhada: 2.5, fixaN: true, ciclagem: 0.2, renda: 1.0, critica: 2,
    },
    milho: {
      nome: "Second-crop corn", familia: "Poaceae", papel: "comercial", cor: "#E9C46A",
      fases: [20, 35, 40, 30], kc: [0.30, 1.20, 0.60], raiz: 1.2, p: 0.55, ky: 1.25,
      palhada: 6.0, fixaN: false, ciclagem: 0.4, renda: 0.45, critica: 2, plantioAte: "03-10",
    },
    sorgo: {
      nome: "Sorghum", familia: "Poaceae", papel: "comercial", cor: "#C8873A",
      fases: [20, 30, 40, 25], kc: [0.30, 1.00, 0.55], raiz: 1.4, p: 0.55, ky: 0.90,
      palhada: 5.0, fixaN: false, ciclagem: 0.5, renda: 0.25, critica: 2, plantioAte: "03-31",
    },
    algodao: {
      nome: "Second-crop cotton", familia: "Malvaceae", papel: "comercial", cor: "#F4F1EA",
      fases: [30, 50, 55, 35], kc: [0.35, 1.15, 0.70], raiz: 1.3, p: 0.65, ky: 0.85,
      palhada: 2.0, fixaN: false, ciclagem: 0.1, renda: 0.85, critica: 2, plantioAte: "01-31",
    },
    milheto: {
      nome: "Millet (cover)", familia: "Poaceae", papel: "cobertura", cor: "#8FBF5A",
      fases: [15, 25, 30, 20], kc: [0.30, 1.00, 0.40], raiz: 1.3, p: 0.55, ky: 0.90,
      palhada: 7.0, fixaN: false, ciclagem: 0.8, renda: -0.05, critica: 2, plantioAte: "04-15",
    },
    braquiaria: {
      nome: "Brachiaria (cover)", familia: "Poaceae", papel: "cobertura", cor: "#2E8B57",
      fases: [25, 40, 80, 60], kc: [0.40, 0.95, 0.80], raiz: 1.8, p: 0.60, ky: 0.80,
      palhada: 9.0, fixaN: false, ciclagem: 1.0, renda: -0.03, critica: 1, plantioAte: "04-30",
    },
  };

  // Opções de segunda safra. "consorcio" = milho + braquiária semeados juntos; a braquiária segue após a colheita.
  const SEGUNDA_SAFRA = {
    milho: { nome: "Second-crop corn", culturas: ["milho"], icone: "milho" },
    sorgo: { nome: "Sorghum", culturas: ["sorgo"], icone: "sorgo" },
    algodao: { nome: "Second-crop cotton", culturas: ["algodao"], icone: "algodao" },
    milheto: { nome: "Millet", culturas: ["milheto"], icone: "milheto" },
    braquiaria: { nome: "Brachiaria", culturas: ["braquiaria"], icone: "braquiaria" },
    consorcio: { nome: "Corn + brachiaria", culturas: ["milho", "braquiaria"], icone: "consorcio",
                 renda: 0.42, palhada: 10.0, ciclagem: 0.9 },
    pousio: { nome: "Fallow", culturas: [], icone: "pousio", renda: 0, palhada: 0.5, ciclagem: 0 },
  };

  // Regras agronômicas que eliminam combinações incompatíveis
  const REGRAS = [
    { id: "algodao_seguido", texto: "Cotton 2 years in a row favors boll weevil and ramularia: not allowed.",
      viola: (seq) => seq.some((c, i) => i > 0 && c === "algodao" && seq[i - 1] === "algodao") },
  ];
  // Repetir milho nos 3 anos é permitido (é o manejo mais comum no MT), mas perde pontos em Pragas.

  const FONTES = {
    kc: "FAO-56 (Allen et al., 1998), tables 11 and 12",
    ky: "FAO-33 (Doorenbos & Kassam, 1979)",
    palhada: "Embrapa Cerrados, no-till (orders of magnitude)",
    renda: "Relative margin index defined by the team (soybean = 1). Not a price or income in money.",
  };

  R.catalogo = { CULTURAS, SEGUNDA_SAFRA, REGRAS, FONTES };
})(globalThis.Rotare = globalThis.Rotare || {});
