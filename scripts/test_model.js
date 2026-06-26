// Validação do model.js
// Rodar: node scripts/test_model.js

const fs = require('fs');
const path = require('path');

const ctx = {};
new Function('self', fs.readFileSync(path.join(__dirname, '..', 'js', 'model.js'), 'utf-8'))(ctx);
const Model = ctx.Model;

const teamsRaw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'teams.json'), 'utf-8'));
const teams = {};
for (const t of teamsRaw.teams) teams[t.code] = t;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// =============================================================================
// Teste 1: Elo → λ para alguns confrontos típicos
// =============================================================================
console.log('='.repeat(70));
console.log('TESTE 1 — Elo → λ_home, λ_away');
console.log('='.repeat(70));

const pairs = [
  ["BRA", "MAR", "group"],
  ["BRA", "HAI", "group"],
  ["ARG", "FRA", "ko"],
  ["ESP", "KSA", "group"],
  ["MEX", "RSA", "group"],   // anfitrião MEX deve receber boost
  ["URU", "MEX", "group"],   // visitante vs anfitrião MEX → MEX recebe boost?
  ["FRA", "NOR", "group"],   // jogo neutro
];

console.log(`\n${'Confronto'.padEnd(20)} ${'Elo H/A'.padEnd(14)} λ_H    λ_A    P(W_H) P(D)   P(W_A)`);
console.log('-'.repeat(70));
for (const [h, a, stage] of pairs) {
  const opts = { stage, homeCode: h, awayCode: a, knockout: stage !== "group" };
  const { lambdaHome, lambdaAway } = Model.expectedGoals(teams[h].elo_initial, teams[a].elo_initial, opts);
  const grid = Model.matchProbabilities(lambdaHome, lambdaAway);
  const out = Model.outcomeProbabilities(grid);
  console.log(`${(h + ' x ' + a).padEnd(20)} ${(teams[h].elo_initial + '/' + teams[a].elo_initial).padEnd(14)} ${lambdaHome.toFixed(2)}   ${lambdaAway.toFixed(2)}   ${(out.home*100).toFixed(1)}% ${(out.draw*100).toFixed(1)}% ${(out.away*100).toFixed(1)}%`);
}

// =============================================================================
// Teste 2: Correção Dixon-Coles vs Poisson independente
// =============================================================================
console.log('\n' + '='.repeat(70));
console.log('TESTE 2 — Efeito da correção tau de Dixon-Coles');
console.log('='.repeat(70));

const lh = 1.3, la = 1.1;
// Copia (model retorna buffer compartilhado — precisa snapshot pra comparar dois grids)
const dcGrid = Float64Array.from(Model.matchProbabilities(lh, la));

// Versão sem D-C (rho=0)
const orig = Model.DC_RHO;
Model.DC_RHO = 0;
const indGrid = Float64Array.from(Model.matchProbabilities(lh, la));
Model.DC_RHO = orig;

console.log(`\nλ_H=${lh}, λ_A=${la}`);
console.log(`Placar    Poisson indep.  Dixon-Coles  Δ%`);
console.log('-'.repeat(60));
const _NSZ = 9; // MAX_GOALS+1
for (const [x, y] of [[0,0],[1,0],[0,1],[1,1],[2,0],[0,2],[2,1],[1,2],[2,2],[3,0]]) {
  const ind = indGrid[x * _NSZ + y];
  const dc = dcGrid[x * _NSZ + y];
  const delta = ((dc - ind) / ind) * 100;
  console.log(`  ${x}-${y}      ${(ind*100).toFixed(2)}%          ${(dc*100).toFixed(2)}%       ${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`);
}

// =============================================================================
// Teste 3: Monte Carlo de placares (sanity check de média)
// =============================================================================
console.log('\n' + '='.repeat(70));
console.log('TESTE 3 — Monte Carlo: média de gols em 10.000 amostras');
console.log('='.repeat(70));

const rng = mulberry32(42);
const tests = [
  ["BRA", "MAR", 1.55, 1.10],
  ["ARG", "FRA", 1.40, 1.25],
  ["BRA", "HAI", 2.18, 0.46],
];
console.log(`\n${'Confronto'.padEnd(15)} λ_H esp. λ_H obs.  λ_A esp. λ_A obs.  Total esp. Total obs.`);
for (const [h, a, expH, expA] of tests) {
  const opts = { stage: "group", homeCode: h, awayCode: a };
  const { lambdaHome, lambdaAway } = Model.expectedGoals(teams[h].elo_initial, teams[a].elo_initial, opts);
  const grid = Model.matchProbabilities(lambdaHome, lambdaAway);
  let sumH = 0, sumA = 0;
  const N = 10000;
  for (let i = 0; i < N; i++) {
    const s = Model.sampleScore(grid, rng);
    sumH += s.home; sumA += s.away;
  }
  console.log(`${(h+' x '+a).padEnd(15)} ${lambdaHome.toFixed(2)}     ${(sumH/N).toFixed(2)}     ${lambdaAway.toFixed(2)}     ${(sumA/N).toFixed(2)}     ${(lambdaHome+lambdaAway).toFixed(2)}      ${((sumH+sumA)/N).toFixed(2)}`);
}

// =============================================================================
// Teste 4: Pênaltis — distribuição de vencedores
// =============================================================================
console.log('\n' + '='.repeat(70));
console.log('TESTE 4 — Pênaltis em 10.000 disputas');
console.log('='.repeat(70));
const penTests = [
  ["BRA", "ARG"],   // Elos próximos
  ["BRA", "HAI"],   // gap grande
  ["FRA", "USA"],
];
for (const [h, a] of penTests) {
  const rngP = mulberry32(123);
  let winsH = 0;
  const N = 10000;
  for (let i = 0; i < N; i++) {
    const pen = Model.samplePenalties(teams[h].elo_initial, teams[a].elo_initial, rngP);
    if (pen.home > pen.away) winsH++;
  }
  console.log(`  ${h} (${teams[h].elo_initial}) x ${a} (${teams[a].elo_initial}): ${h} ganhou ${(winsH/N*100).toFixed(1)}% das vezes`);
}

// =============================================================================
// Teste 5: Mata-mata completo — distribuição de decisões (FT / ET / pens)
// =============================================================================
console.log('\n' + '='.repeat(70));
console.log('TESTE 5 — Mata-mata: % de jogos decididos em 90'+', ET, pênaltis');
console.log('='.repeat(70));

const koTests = [
  ["BRA", "MAR"],
  ["BRA", "HAI"],
  ["ARG", "FRA"],
];
for (const [h, a] of koTests) {
  const rngK = mulberry32(7);
  const opts = { stage: "ko", homeCode: h, awayCode: a, knockout: true };
  let ft = 0, et = 0, pens = 0, totalGoals = 0;
  const N = 10000;
  for (let i = 0; i < N; i++) {
    const m = Model.simulateMatch(teams[h].elo_initial, teams[a].elo_initial, opts, rngK);
    totalGoals += m.scoreHome + m.scoreAway + m.etHome + m.etAway;
    if (m.decided === "ft") ft++;
    else if (m.decided === "et") et++;
    else pens++;
  }
  console.log(`  ${h} x ${a}: FT=${(ft/N*100).toFixed(1)}%  ET=${(et/N*100).toFixed(1)}%  Pens=${(pens/N*100).toFixed(1)}%  | gols médios (90+ET): ${(totalGoals/N).toFixed(2)}`);
}

console.log('\nTUDO OK 🟢');
