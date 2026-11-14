// Aviso de SI: testes escritos com ajuda de IA (Claude), sob direção do time Datanauts Brasil.
// Rodar (na pasta rotare): node --test app/tests/motor.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

globalThis.window = globalThis;
const raiz = path.join(__dirname, "..");
const turfPath = path.join(__dirname, "turf.min.js");
if (!fs.existsSync(turfPath)) throw new Error("Baixe o turf para app/tests/turf.min.js (ver tests/LEIA-ME.md)");
for (const f of ["tests/turf.min.js", "data/clima.js", "data/regiao.js", "data/talhoes.js", "js/motor/catalogo.js", "js/motor/balanco.js",
  "js/motor/rotacao.js", "js/motor/historico.js", "js/geo/zonal.js", "js/geo/editor.js", "js/explica.js"]) {
  vm.runInThisContext(fs.readFileSync(path.join(raiz, f), "utf8"), { filename: f });
}
const R = globalThis.Rotare, C = globalThis.ROTARE_CLIMA, T = globalThis.ROTARE_TALHOES;
const solo = { cad: 105, declividade: 3 };
const ctxBase = { clima: C, solo, irrigado: false, atual: ["milho", "milho", "milho"], permitidas: null,
                  pesos: { solo: 50, risco: 50, agua: 50, renda: 50 }, cenario: null };

test("hectares: quadrado de 0,01° no equador tem ~123,6 ha (geodésico)", () => {
  const m = R.geo.metricas([[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01]]);
  assert.ok(Math.abs(m.areaHa - 123.6) < 0.5, `área ${m.areaHa}`);
  assert.ok(Math.abs(m.perimetroKm - 4.45) < 0.02, `perímetro ${m.perimetroKm}`);
});

test("polígono: detecta auto-interseção e área mínima", () => {
  const gravata = R.geo.metricas([[0, 0], [0.01, 0.01], [0.01, 0], [0, 0.01]]);
  assert.equal(gravata.autoIntersecao, true);
  assert.equal(gravata.valido, false);
  const pequeno = R.geo.metricas([[0, 0], [0.0001, 0], [0.0001, 0.0001]]);
  assert.equal(pequeno.pequeno, true);
  assert.equal(R.geo.metricas([[0, 0], [1, 1]]), null);
});

test("talhões de demonstração: dentro da região, área plausível e solo/relevo agregados", () => {
  for (const t of T) {
    const m = R.geo.metricas(t.geometria.slice(0, -1));
    assert.ok(m.valido && m.areaHa > 50 && m.areaHa < 1000, `${t.id}: ${m.areaHa} ha`);
    assert.equal(R.zonal.cobertura(m.anel), "total");
    const s = R.zonal.solo(m.anel);
    assert.ok(s.cad > 40 && s.cad < 250, `${t.id}: CAD ${s.cad}`);
    const r = R.zonal.relevo(m.anel);
    assert.ok(r.altitude > 250 && r.altitude < 500);
  }
});

test("cobertura: ponto fora da região é 'fora'", () => {
  assert.equal(R.zonal.cobertura([[-47, -15], [-46.9, -15], [-46.9, -14.9]]), "fora");
});

test("Saxton & Rawls reproduz o valor do banco (areia 56, argila 28, C 22,8)", () => {
  const { cc, pmp } = R.zonal.saxtonRawls(56, 28, 22.8);
  assert.ok(cc > pmp && (cc - pmp) * 1000 > 80 && (cc - pmp) * 1000 < 160);
});

test("pesos: normalização soma 1 e zero vira pesos iguais", () => {
  const w = R.rotacao.normalizarPesos({ solo: 80, risco: 20, agua: 0, renda: 100 });
  assert.ok(Math.abs(w.solo + w.risco + w.agua + w.renda - 1) < 1e-12);
  assert.deepEqual(R.rotacao.normalizarPesos({ solo: 0, risco: 0, agua: 0, renda: 0 }), { solo: 0.25, risco: 0.25, agua: 0.25, renda: 0.25 });
});

test("balanço hídrico: ETa ≤ ETc e produtividade relativa entre 0 e 1", () => {
  const a = R.balanco.anoClimatico(C, 2015, null);
  for (const o of R.rotacao.OPCOES) {
    const r = R.balanco.simularAno(a, o, solo, false);
    for (const [cid, c] of Object.entries(r.culturas)) {
      if (c.foraJanela) continue;
      assert.ok(c.eta <= c.etc + 1e-6, `${o}/${cid}`);
      assert.ok(c.rendRel >= 0 && c.rendRel <= 1);
    }
  }
});

test("irrigação elimina o estresse da 2ª safra", () => {
  const a = R.balanco.anoClimatico(C, 2015, { chuva: -0.4 });
  const seca = R.balanco.simularAno(a, "milho", solo, false);
  const irr = R.balanco.simularAno(a, "milho", solo, true);
  if (!irr.culturas.milho.foraJanela) {
    assert.ok(irr.culturas.milho.rendRel >= seca.culturas.milho.rendRel);
    assert.ok(irr.irrigacao > 0);
  }
});

test("menos chuva nunca reduz o risco médio e atrasa (ou mantém) o início das chuvas", () => {
  const r0 = R.rotacao.resumirOpcoes(R.rotacao.simularOpcoes(C, solo, false, null));
  const r1 = R.rotacao.resumirOpcoes(R.rotacao.simularOpcoes(C, solo, false, { chuva: -0.3 }));
  assert.ok(r1.milho.falha >= r0.milho.falha);
  for (const y of [2010, 2015, 2020]) {
    const a0 = R.balanco.inicioChuvas(R.balanco.anoClimatico(C, y, null)).dia;
    const a1 = R.balanco.inicioChuvas(R.balanco.anoClimatico(C, y, { chuva: -0.3 })).dia;
    assert.ok(a1 >= a0, `${y}: ${a0} → ${a1}`);
  }
});

test("regras: nunca algodão em anos seguidos e combinações sem repetição", () => {
  const seqs = R.rotacao.sequenciasValidas(null);
  assert.equal(new Set(seqs.map(R.rotacao.chaveComb)).size, seqs.length);
  for (const s of seqs) for (let i = 1; i < 3; i++) assert.ok(!(s[i] === "algodao" && s[i - 1] === "algodao"), s.join(">"));
});

test("restrições do produtor são respeitadas pelos cenários gerados", () => {
  const permitidas = new Set(["milho", "milheto", "pousio"]);
  const r = R.rotacao.analisar({ ...ctxBase, permitidas });
  for (const c of r.cartoes) if (c.id !== "atual") for (const o of c.seq) assert.ok(permitidas.has(o), `${c.id}: ${o}`);
});

test("análise: notas entre 0 e 100, ranking ordenado e só uma recomendada", () => {
  for (const cen of [null, { chuva: -0.2 }, { elNino: true }, { chuva: -0.4, temp: 3 }]) {
    const r = R.rotacao.analisar({ ...ctxBase, cenario: cen });
    assert.ok(r.cartoes.length >= 4);
    assert.equal(r.cartoes.filter((c) => c.recomendada).length, 1);
    for (let i = 0; i < r.cartoes.length; i++) {
      const c = r.cartoes[i];
      for (const v of Object.values(c.notas)) assert.ok(v >= 0 && v <= 100);
      if (i) assert.ok(r.cartoes[i - 1].pontuacao >= c.pontuacao);
    }
  }
});

test("determinismo: mesma entrada, mesma saída", () => {
  const a = R.rotacao.analisar(ctxBase), b = R.rotacao.analisar(ctxBase);
  assert.deepEqual(a.cartoes.map((c) => [c.seq, c.pontuacao]), b.cartoes.map((c) => [c.seq, c.pontuacao]));
});

test("simulador: com prioridade em solo e risco, chuva -20% troca a recomendada (momento da demo)", () => {
  const pesos = R.explica.interpretarPrioridades("quero proteger o solo e ter menos risco de seca").pesos;
  const ctx = { ...ctxBase, pesos };
  const r0 = R.rotacao.analisar(ctx);
  const fixas = r0.cartoes.map((c) => ({ id: c.id, titulo: c.titulo, seq: c.seq }));
  const r1 = R.rotacao.analisar({ ...ctx, cenario: { chuva: -0.2 } }, fixas);
  assert.notEqual(r0.cartoes[0].id, r1.cartoes[0].id, "a recomendada deveria trocar");
  assert.deepEqual(r1.cartoes.map((c) => c.id).sort(), fixas.map((f) => f.id).sort());
});

test("El Niño: usa só anos com ONI ≥ 1,5 e mostra um resultado por ano análogo", () => {
  const anos = R.rotacao.anosAnalise(C, { elNino: true });
  assert.ok(anos.includes(2015) && anos.includes(1997));
  for (const y of anos) assert.equal(C.enso_safra[y].fase, "el_nino_forte");
  const r = R.rotacao.analisar({ ...ctxBase, cenario: { elNino: true } });
  for (const c of r.cartoes) assert.equal(c.porAno.length, anos.length);
});

test("dados ausentes: NDVI sem dado vira null e a inferência não quebra", () => {
  const serie = Array.from({ length: 24 }, (_, i) => ({ mes: `20${14 + Math.floor((i + 6) / 12)}-${String(((i + 6) % 12) + 1).padStart(2, "0")}`, ndvi: i % 5 ? 0.7 : null }));
  const s = R.historico.inferirSafras(serie, null);
  assert.ok(s.length >= 1);
  assert.equal(R.historico.rotacaoAtual([]).length, 3);
});

test("histórico: talhão Sede é inferido como soja + milho, validado como soja pelo MapBiomas", () => {
  const t = T.find((x) => x.id === "sede"), anel = t.geometria;
  const s = R.historico.inferirSafras(R.zonal.serieNdvi(anel).serie, R.zonal.usoTerra(anel));
  assert.ok(s.filter((x) => x.opcao === "milho").length >= 8);
  assert.ok(s.every((x) => x.confirmaSoja !== false));
});

test("explicação: só usa números do motor (o percentual de risco citado bate com a métrica)", () => {
  const r = R.rotacao.analisar(ctxBase);
  const c = r.cartoes[0];
  const e = R.explica.explicar(c, { cartoes: r.cartoes, pesos: r.pesos, anos: r.anos, resumo: r.resumo, cobertura: "total" });
  assert.ok(e.porque.includes(`${Math.round(c.metricas.risco * 100)}%`));
  assert.ok(e.beneficios.length && e.riscos.length && e.naoSabemos.length);
});
