// Test rápido do tournament.js usando os JSONs reais.
// Rodar: node scripts/test_tournament.js

const fs = require('fs');
const path = require('path');

// Como tournament.js usa o padrão (function(global){...})(window||self), executamos em
// um contexto onde 'self' aponta para um objeto que servirá de "global" pra ele.
const ctx = {};
const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'tournament.js'), 'utf-8');
// Wrap pra simular o ambiente: criamos uma função e injetamos self.
new Function('self', code)(ctx);
const Tournament = ctx.Tournament;

const teams = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'teams.json'), 'utf-8'));
const matchesData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'matches.json'), 'utf-8'));
const bracket = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'bracket.json'), 'utf-8'));
const thirdTable = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'third_place_table.json'), 'utf-8'));

// RNG simples seedável
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(42);

// Group code → array de team codes
const groupTeams = {};
for (const t of teams.teams) {
  if (!groupTeams[t.group]) groupTeams[t.group] = [];
  groupTeams[t.group].push(t.code);
}

// Tabela de nomes em PT pra exibição amigável
const namePT = {};
for (const t of teams.teams) namePT[t.code] = t.name_pt;

console.log('='.repeat(70));
console.log('CLASSIFICAÇÃO ATUAL (com base nos 54 jogos disputados até 25/06/2026)');
console.log('='.repeat(70));

const allStandings = {};
for (const g of 'ABCDEFGHIJKL') {
  const standings = Tournament.computeGroupStandings(g, groupTeams[g], matchesData.matches, rng);
  allStandings[g] = standings;
  console.log(`\nGrupo ${g}:`);
  console.log('  Pos  Time              J   V   E   D   GP  GC  SG  Pts');
  console.log('  ---  ----------------  --  --  --  --  --  --  --  ---');
  standings.forEach((s, i) => {
    console.log(`   ${i + 1}º  ${(namePT[s.team]).padEnd(16)}  ${String(s.played).padStart(2)}  ${String(s.wins).padStart(2)}  ${String(s.draws).padStart(2)}  ${String(s.losses).padStart(2)}  ${String(s.gf).padStart(2)}  ${String(s.ga).padStart(2)}  ${String(s.gd).padStart(2)}  ${String(s.points).padStart(3)}`);
  });
}

// Best 3rds
console.log('\n' + '='.repeat(70));
console.log('MELHORES 3ºs COLOCADOS (parcial — só 3 grupos terminaram MD3)');
console.log('='.repeat(70));
const thirds = Tournament.selectBestThirds(allStandings, rng);
console.log('\nTop 8 (avançam):');
thirds.advancing.forEach((t, i) => {
  console.log(`  ${i + 1}º  [${t.group}] ${namePT[t.team].padEnd(20)} J:${t.played} Pts:${t.points} SG:${t.gd} GP:${t.gf}`);
});
console.log('\nBottom 4 (eliminados):');
thirds.eliminated.forEach((t, i) => {
  console.log(`  ${i + 9}º [${t.group}] ${namePT[t.team].padEnd(20)} J:${t.played} Pts:${t.points} SG:${t.gd} GP:${t.gf}`);
});

// Alocação no R32
console.log('\n' + '='.repeat(70));
console.log('ALOCAÇÃO DOS 3ºs NOS SLOTS DO R32');
console.log('='.repeat(70));
const thirdsMapping = Tournament.allocateThirdsToR32(thirds.advancing, bracket, thirdTable);
const comboKey = thirds.advancing.map(t => t.group).slice().sort().join('');
const stillPossible = thirdTable.combinations[comboKey]?.still_possible;
console.log(`\nCombinação atual: ${comboKey} (FIFA #${thirdTable.combinations[comboKey]?.n}, still_possible=${stillPossible})`);
for (const slot of bracket.third_place_allocation.slots_with_third_placer) {
  const team = thirdsMapping[slot];
  const eligibleGroups = bracket.third_place_allocation.slot_groups[slot];
  const groupOfTeam = teams.teams.find(t => t.code === team)?.group;
  const eligibleMark = eligibleGroups.includes(groupOfTeam) ? '✓' : '✗';
  console.log(`  ${slot}: ${namePT[team]} (Grupo ${groupOfTeam}) ${eligibleMark} eligível em ${eligibleGroups.join(',')}`);
}

// R32 matchups
console.log('\n' + '='.repeat(70));
console.log('CONFRONTOS DO R32 (projeção atual)');
console.log('='.repeat(70));
const r32 = Tournament.buildR32Matchups(allStandings, thirdsMapping, bracket);
r32.forEach(m => {
  console.log(`  ${m.id}: ${namePT[m.home].padEnd(22)} x ${namePT[m.away]}`);
});

// Verificações de sanidade
console.log('\n' + '='.repeat(70));
console.log('VERIFICAÇÕES DE SANIDADE');
console.log('='.repeat(70));

// 1. Cada um dos 32 R32 deve ter dois times distintos
let problem = false;
const r32Teams = [];
for (const m of r32) {
  if (m.home === m.away) { console.log(`  ✗ ${m.id} tem times iguais: ${m.home}`); problem = true; }
  r32Teams.push(m.home, m.away);
}
const uniqueR32 = new Set(r32Teams);
if (uniqueR32.size !== 32) { console.log(`  ✗ R32 tem ${uniqueR32.size} times únicos (esperado 32)`); problem = true; }
else console.log(`  ✓ 32 times únicos no R32`);

// 2. Nenhum confronto pode ser entre times do mesmo grupo
for (const m of r32) {
  const gh = teams.teams.find(t => t.code === m.home).group;
  const ga = teams.teams.find(t => t.code === m.away).group;
  if (gh === ga) { console.log(`  ✗ ${m.id}: ${m.home} e ${m.away} são ambos do grupo ${gh}`); problem = true; }
}
if (!problem) console.log(`  ✓ Nenhum rematch de fase de grupos no R32`);

if (!problem) console.log('\n  TUDO OK 🟢');
