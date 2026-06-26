// Validação do elo.js
// Rodar: node scripts/test_elo.js

const fs = require('fs');
const path = require('path');

const ctx = {};
new Function('self', fs.readFileSync(path.join(__dirname, '..', 'js', 'elo.js'), 'utf-8'))(ctx);
const Elo = ctx.Elo;

// =============================================================================
// Teste 1: We esperado para diferenças de Elo conhecidas
// =============================================================================
console.log('='.repeat(70));
console.log('TESTE 1 — Probabilidade esperada We');
console.log('='.repeat(70));
console.log(`\n${'Δ Elo'.padEnd(8)} We(favorito)  We(zebra)`);
console.log('-'.repeat(40));
for (const d of [0, 50, 100, 200, 300, 400, 500, 700]) {
  const we = Elo.expectedScore(1800 + d, 1800);
  console.log(`  ${String(d).padEnd(6)} ${(we * 100).toFixed(2).padStart(6)}%       ${((1 - we) * 100).toFixed(2).padStart(6)}%`);
}

// =============================================================================
// Teste 2: Fator G por saldo de gols
// =============================================================================
console.log('\n' + '='.repeat(70));
console.log('TESTE 2 — Fator G (saldo de gols)');
console.log('='.repeat(70));
console.log(`\n${'GD'.padEnd(6)} G`);
console.log('-'.repeat(15));
for (const gd of [0, 1, 2, 3, 4, 5, 6, 8]) {
  console.log(`  ${String(gd).padEnd(4)} ${Elo.goalDifferenceFactor(gd).toFixed(3)}`);
}

// =============================================================================
// Teste 3: Casos conhecidos
// =============================================================================
console.log('\n' + '='.repeat(70));
console.log('TESTE 3 — Atualização em cenários conhecidos');
console.log('='.repeat(70));

const cases = [
  // [descrição, eloH, eloA, resultado]
  ["BRA(2009) vence HAI(1517) por 3x0  (favorito grande vence)",
    2009, 1517, { scoreHome: 3, scoreAway: 0, decided: "ft" }],
  ["BRA(2009) perde p/ HAI(1517) por 0x1 (zebra histórica)",
    2009, 1517, { scoreHome: 0, scoreAway: 1, decided: "ft" }],
  ["ARG(2144) empata com FRA(2090) por 1x1",
    2144, 2090, { scoreHome: 1, scoreAway: 1, decided: "ft" }],
  ["BRA(2009) vence MAR(1877) na ET por 2x1 (1x1 em 90')",
    2009, 1877, { scoreHome: 1, scoreAway: 1, etHome: 1, etAway: 0, decided: "et" }],
  ["MEX(1912) elimina USA(1820) nos pênaltis (0x0 em 90+ET)",
    1912, 1820, { scoreHome: 0, scoreAway: 0, etHome: 0, etAway: 0, decided: "pens" }],
  ["ESP(2134) goleia KSA(1593) por 5x0",
    2134, 1593, { scoreHome: 5, scoreAway: 0, decided: "ft" }],
];

console.log(`\n${'Cenário'.padEnd(58)} ΔHome  ΔAway`);
console.log('-'.repeat(78));
for (const [desc, eH, eA, res] of cases) {
  const r = Elo.applyMatch(eH, eA, res);
  const dH = r.deltaHome.toFixed(2).padStart(6);
  const dA = r.deltaAway.toFixed(2).padStart(6);
  console.log(`${desc.padEnd(58)} ${dH > 0 ? '+' : ''}${dH}  ${dA > 0 ? '+' : ''}${dA}`);
}

// =============================================================================
// Teste 4: Conservação (delta_home + delta_away ≈ 0)
// =============================================================================
console.log('\n' + '='.repeat(70));
console.log('TESTE 4 — Conservação de Elo (soma das mudanças = 0)');
console.log('='.repeat(70));
let maxErr = 0;
for (let i = 0; i < 100; i++) {
  const eH = 1500 + Math.random() * 700;
  const eA = 1500 + Math.random() * 700;
  const sH = Math.floor(Math.random() * 5);
  const sA = Math.floor(Math.random() * 5);
  const r = Elo.applyMatch(eH, eA, { scoreHome: sH, scoreAway: sA, decided: "ft" });
  const err = Math.abs(r.deltaHome + r.deltaAway);
  if (err > maxErr) maxErr = err;
}
console.log(`\nMáximo |ΔH + ΔA| em 100 sorteios: ${maxErr.toExponential(2)}  (esperado ≈ 0)`);

// =============================================================================
// Teste 5: Encadeamento — Elo evolui ao longo de uma sequência de jogos
// =============================================================================
console.log('\n' + '='.repeat(70));
console.log('TESTE 5 — Encadeamento: trajetória hipotética de uma seleção');
console.log('='.repeat(70));
console.log('\nMarrocos (1877) em campanha hipotética no mata-mata:');

let eloMar = 1877;
const opponents = [
  ["NED (1972)", 1972, { scoreHome: 2, scoreAway: 1, decided: "ft" }],   // MAR vence 2x1
  ["ESP (2134)", 2134, { scoreHome: 0, scoreAway: 0, etHome: 0, etAway: 0, decided: "pens" }], // empate 0x0+ET, MAR avança nos pens
  ["FRA (2090)", 2090, { scoreHome: 1, scoreAway: 2, decided: "ft" }],   // MAR perde 1x2
];
for (const [oppDesc, eOpp, res] of opponents) {
  const r = Elo.applyMatch(eloMar, eOpp, res);
  console.log(`  vs ${oppDesc.padEnd(14)} → resultado ${res.scoreHome}-${res.scoreAway}${res.etHome ? ' (ET)' : ''}${res.decided==='pens' ? ' (pens)' : ''}`);
  console.log(`     Elo MAR: ${eloMar.toFixed(1)} → ${r.newHome.toFixed(1)} (${r.deltaHome >= 0 ? '+' : ''}${r.deltaHome.toFixed(1)})`);
  eloMar = r.newHome;
}

console.log('\nTUDO OK 🟢');
