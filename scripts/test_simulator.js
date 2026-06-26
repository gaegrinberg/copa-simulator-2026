// Validação do simulator.js — roda Monte Carlo e checa sanidade dos resultados
// node scripts/test_simulator.js [N]

const fs = require('fs');
const path = require('path');

// Compartilha um único `self` entre todos os módulos para que simulator.js consiga
// resolver Tournament/Model/Elo via global.X.
const ctx = {};
function loadInto(file, target) {
  new Function('self', fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf-8'))(target);
}
loadInto('tournament.js', ctx);
loadInto('model.js', ctx);
loadInto('elo.js', ctx);
loadInto('simulator.js', ctx);
const { Simulator } = ctx;

const teamsRaw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'teams.json'), 'utf-8'));
const matchesRaw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'matches.json'), 'utf-8'));
const bracket = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'bracket.json'), 'utf-8'));
const thirdTable = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'third_place_table.json'), 'utf-8'));

const state = {
  teams: teamsRaw.teams,
  matches: matchesRaw.matches,
  bracket,
  thirdTable,
};

const N = parseInt(process.argv[2] || "5000", 10);
console.log(`Rodando ${N} simulações Monte Carlo...`);
const t0 = Date.now();

const rng = Simulator.mulberry32(42);
let lastPct = -1;
const stats = Simulator.run(state, N, rng, (done, total) => {
  const pct = Math.floor(done / total * 100);
  if (pct !== lastPct && pct % 10 === 0) {
    process.stdout.write(`  ${pct}%... `);
    lastPct = pct;
  }
});
const elapsed = (Date.now() - t0) / 1000;
console.log(`\n  Concluído em ${elapsed.toFixed(1)}s (${(N / elapsed).toFixed(0)} sims/s)`);

// Mapa de nomes
const namePT = {};
const eloByCode = {};
for (const t of teamsRaw.teams) { namePT[t.code] = t.name_pt; eloByCode[t.code] = t.elo_initial; }

// =============================================================================
// Top 16 por P(título)
// =============================================================================
console.log('\n' + '='.repeat(90));
console.log('TOP 16 — PROBABILIDADE DE TÍTULO E ESTÁGIO');
console.log('='.repeat(90));
const teams = Object.keys(stats.byTeam).map(code => ({ code, ...stats.byTeam[code] }));
teams.sort((a, b) => b.pChampion - a.pChampion);
console.log(`\n${'Time'.padEnd(20)} ${'Elo'.padStart(5)} ${'Adv'.padStart(7)} ${'R16'.padStart(7)} ${'QF'.padStart(7)} ${'SF'.padStart(7)} ${'Final'.padStart(7)} ${'Título'.padStart(7)}`);
console.log('-'.repeat(90));
for (let i = 0; i < 16; i++) {
  const t = teams[i];
  const fmt = (p) => (p * 100).toFixed(1).padStart(5) + '%';
  console.log(`${namePT[t.code].padEnd(20)} ${String(eloByCode[t.code]).padStart(5)} ${fmt(t.pAdvanceGroup).padStart(7)} ${fmt(t.pR16).padStart(7)} ${fmt(t.pQF).padStart(7)} ${fmt(t.pSF).padStart(7)} ${fmt(t.pFinal).padStart(7)} ${((t.pChampion * 100).toFixed(2) + '%').padStart(7)}`);
}

// Σ deve ser 100%
const totalChamp = teams.reduce((s, t) => s + t.pChampion, 0);
console.log(`\n[Sanidade] Σ P(título) = ${(totalChamp * 100).toFixed(2)}% (esperado: 100%)`);
const totalFinal = teams.reduce((s, t) => s + t.pFinal, 0);
console.log(`[Sanidade] Σ P(final)  = ${(totalFinal * 100).toFixed(2)}% (esperado: 200%, dois finalistas)`);
const totalR32 = teams.reduce((s, t) => s + t.pAdvanceGroup, 0);
console.log(`[Sanidade] Σ P(R32)    = ${(totalR32 * 100).toFixed(2)}% (esperado: 3200%, 32 classificados)`);

// =============================================================================
// Estatísticas por grupo (compactas)
// =============================================================================
console.log('\n' + '='.repeat(90));
console.log('PROBABILIDADES POR GRUPO (1º / 2º / 3º / 4º / Avança ao R32)');
console.log('='.repeat(90));
const byGroup = {};
for (const t of teamsRaw.teams) {
  if (!byGroup[t.group]) byGroup[t.group] = [];
  byGroup[t.group].push(t);
}
for (const g of 'ABCDEFGHIJKL') {
  console.log(`\nGrupo ${g}:`);
  const arr = byGroup[g].map(t => ({ ...t, ...stats.byTeam[t.code] }));
  arr.sort((a, b) => (b.pGroupPos[1] + b.pGroupPos[2] + b.pGroupPos[3]*0.5) - (a.pGroupPos[1] + a.pGroupPos[2] + a.pGroupPos[3]*0.5));
  for (const t of arr) {
    const p1 = (t.pGroupPos[1]*100).toFixed(1).padStart(5);
    const p2 = (t.pGroupPos[2]*100).toFixed(1).padStart(5);
    const p3 = (t.pGroupPos[3]*100).toFixed(1).padStart(5);
    const p4 = (t.pGroupPos[4]*100).toFixed(1).padStart(5);
    const adv = (t.pAdvanceGroup*100).toFixed(1).padStart(5);
    console.log(`  ${namePT[t.code].padEnd(20)} 1º:${p1}%  2º:${p2}%  3º:${p3}%  4º:${p4}%  → R32:${adv}%`);
  }
}

// Soma das probs em cada grupo deve ser 100% por posição
console.log('\n[Sanidade] Soma das probs por posição em cada grupo:');
for (const g of 'ABCDEFGHIJKL') {
  let s1=0,s2=0,s3=0,s4=0;
  for (const t of byGroup[g]) {
    s1 += stats.byTeam[t.code].pGroupPos[1];
    s2 += stats.byTeam[t.code].pGroupPos[2];
    s3 += stats.byTeam[t.code].pGroupPos[3];
    s4 += stats.byTeam[t.code].pGroupPos[4];
  }
  console.log(`  ${g}: 1º=${(s1*100).toFixed(1)}%  2º=${(s2*100).toFixed(1)}%  3º=${(s3*100).toFixed(1)}%  4º=${(s4*100).toFixed(1)}%`);
}

// =============================================================================
// Combinações de 3ºs mais comuns
// =============================================================================
console.log('\n' + '='.repeat(90));
console.log('COMBINAÇÕES DE 3ºs MAIS COMUNS');
console.log('='.repeat(90));
const comboList = Object.entries(stats.fifaCombo).map(([combo, count]) => ({
  combo, count,
  n: thirdTable.combinations[combo]?.n,
  stillPossible: thirdTable.combinations[combo]?.still_possible,
}));
comboList.sort((a, b) => b.count - a.count);
for (let i = 0; i < Math.min(8, comboList.length); i++) {
  const c = comboList[i];
  console.log(`  ${c.combo}  (FIFA #${c.n}, possível=${c.stillPossible ? 'sim' : 'não'}): ${c.count} sims  (${(c.count/N*100).toFixed(2)}%)`);
}
const numCombosSeen = comboList.length;
const possibleNow = Object.values(thirdTable.combinations).filter(c => c.still_possible).length;
console.log(`\n${numCombosSeen} combinações distintas em ${N} sims (de ${possibleNow} ainda possíveis pelo estado atual)`);

console.log('\nTUDO OK 🟢');
