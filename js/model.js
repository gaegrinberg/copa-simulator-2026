// model.js
// Modelo de gols esperados Dixon-Coles para a Copa do Mundo 2026.
//
// Pipeline:
//   Elo_home, Elo_away  -->  λ_home, λ_away      (expectedGoals)
//   λ_home, λ_away      -->  matriz P[x][y]      (matchProbabilities)
//   P[x][y]             -->  placar amostrado    (sampleScore)
//
// Para mata-mata empatado em 90', prorrogação (extraTime) e pênaltis (penalties).

(function (global) {
  const Model = {};

  // ---------------------------------------------------------------------------
  // Constantes calibráveis
  // ---------------------------------------------------------------------------
  // Média de gols por partida em Copas do Mundo recentes (2018: 2.64, 2022: 2.69).
  Model.BASE_TOTAL_GOALS = 2.65;
  // Quantos Elo equivalem a 1 gol de diferença esperada (literatura: ~280-300).
  Model.ELO_PER_GOAL = 286;
  // Bonus de Elo para país-anfitrião quando joga na fase de grupos em casa.
  Model.HOST_BOOST_GROUP = 50;
  // Bonus para anfitrião em mata-mata (jogo pode ou não ser em casa; usamos 0 por padrão).
  Model.HOST_BOOST_KO = 0;
  // Parâmetro tau de Dixon-Coles (correlação para placares baixos).
  Model.DC_RHO = -0.13;
  // Maior placar considerado na matriz de probabilidades.
  Model.MAX_GOALS = 8;
  // Pisos para evitar λ negativo/colado em 0.
  Model.LAMBDA_FLOOR = 0.15;

  // Códigos dos países-anfitriões.
  const HOSTS = new Set(["USA", "CAN", "MEX"]);

  // ---------------------------------------------------------------------------
  // 1. Elo → λ_home, λ_away (gols esperados em 90')
  // ---------------------------------------------------------------------------
  //   Diferença de gols esperada = ΔElo / ELO_PER_GOAL
  //   Soma de gols esperada     = BASE_TOTAL_GOALS
  //   λ_home = (soma + diff) / 2
  //   λ_away = (soma - diff) / 2

  Model.expectedGoals = function (eloHome, eloAway, opts) {
    opts = opts || {};
    const isGroup = opts.stage === "group";
    const homeBoost = (HOSTS.has(opts.homeCode) && isGroup) ? Model.HOST_BOOST_GROUP
                    : (HOSTS.has(opts.homeCode) && !isGroup) ? Model.HOST_BOOST_KO : 0;
    const awayBoost = 0; // away nunca tem boost de mando
    const adjHome = eloHome + homeBoost;
    const adjAway = eloAway + awayBoost;
    const diff = (adjHome - adjAway) / Model.ELO_PER_GOAL;
    const sum  = Model.BASE_TOTAL_GOALS;
    let lh = (sum + diff) / 2;
    let la = (sum - diff) / 2;
    if (lh < Model.LAMBDA_FLOOR) lh = Model.LAMBDA_FLOOR;
    if (la < Model.LAMBDA_FLOOR) la = Model.LAMBDA_FLOOR;
    return { lambdaHome: lh, lambdaAway: la };
  };

  // ---------------------------------------------------------------------------
  // 2. Poisson PMF — tabelas reutilizadas para evitar alocação no hot loop
  // ---------------------------------------------------------------------------
  const INV_FACT = (function () {
    const arr = new Float64Array(20);
    arr[0] = 1;
    for (let k = 1; k < 20; k++) arr[k] = arr[k - 1] / k;
    return arr;
  })();

  // Buffers compartilhados — usados por matchProbabilities + sampleScore.
  // O grid é armazenado como Float64Array flat de tamanho (N+1)². OBS: assume
  // execução single-thread (cada Worker tem seu próprio escopo).
  const _N = Model.MAX_GOALS + 1;     // 9
  const _SIZE = _N * _N;              // 81
  const _grid = new Float64Array(_SIZE);
  const _pmfH = new Float64Array(_N);
  const _pmfA = new Float64Array(_N);

  // ---------------------------------------------------------------------------
  // 3. Matriz de probabilidades P[x*N+y] (flat, normalizada)
  // ---------------------------------------------------------------------------
  // Correção Dixon-Coles inline nos 4 placares baixos (0-0, 1-0, 0-1, 1-1).

  Model.matchProbabilities = function (lambdaHome, lambdaAway) {
    const N = _N;
    const rho = Model.DC_RHO;
    // PMF Poisson incremental — evita Math.pow.
    const expH = Math.exp(-lambdaHome);
    const expA = Math.exp(-lambdaAway);
    let lhk = 1, lak = 1;
    for (let k = 0; k < N; k++) {
      _pmfH[k] = expH * lhk * INV_FACT[k];
      _pmfA[k] = expA * lak * INV_FACT[k];
      lhk *= lambdaHome;
      lak *= lambdaAway;
    }
    let total = 0;
    for (let x = 0; x < N; x++) {
      const ph = _pmfH[x];
      const rowOff = x * N;
      for (let y = 0; y < N; y++) {
        let p = ph * _pmfA[y];
        // DC tau inline
        if (x < 2 && y < 2) {
          if (x === 0 && y === 0)      p *= (1 - lambdaHome * lambdaAway * rho);
          else if (x === 1 && y === 0) p *= (1 + lambdaAway * rho);
          else if (x === 0 && y === 1) p *= (1 + lambdaHome * rho);
          else                          p *= (1 - rho);
        }
        if (p < 0) p = 0;
        _grid[rowOff + y] = p;
        total += p;
      }
    }
    const inv = 1 / total;
    for (let i = 0; i < _SIZE; i++) _grid[i] *= inv;
    return _grid;
  };

  // ---------------------------------------------------------------------------
  // 4. Probabilidades agregadas: vitória mandante / empate / visitante
  // ---------------------------------------------------------------------------
  Model.outcomeProbabilities = function (grid) {
    const N = _N;
    let pH = 0, pD = 0, pA = 0;
    for (let x = 0; x < N; x++) {
      const off = x * N;
      for (let y = 0; y < N; y++) {
        const p = grid[off + y];
        if (x > y) pH += p;
        else if (x < y) pA += p;
        else pD += p;
      }
    }
    return { home: pH, draw: pD, away: pA };
  };

  // ---------------------------------------------------------------------------
  // 5. Amostragem de placar de 90' (CDF flat)
  // ---------------------------------------------------------------------------
  Model.sampleScore = function (grid, rng) {
    const r = rng();
    const N = _N;
    let cum = 0;
    for (let i = 0; i < _SIZE; i++) {
      cum += grid[i];
      if (r < cum) {
        const x = (i / N) | 0;
        return { home: x, away: i - x * N };
      }
    }
    return { home: N - 1, away: N - 1 };
  };

  // ---------------------------------------------------------------------------
  // 7. Prorrogação (30 min adicionais)
  // ---------------------------------------------------------------------------
  // Lambdas reduzidos para 30/90 = 1/3 do total. Aplicamos D-C também.
  Model.sampleExtraTime = function (lambdaHome, lambdaAway, rng) {
    const lh = lambdaHome / 3;
    const la = lambdaAway / 3;
    const grid = Model.matchProbabilities(lh, la);
    return Model.sampleScore(grid, rng);
  };

  // ---------------------------------------------------------------------------
  // 8. Disputa de pênaltis
  // ---------------------------------------------------------------------------
  // Modelo simples: cada cobrança tem prob de conversão p, com pequeno ajuste de Elo.
  //   p_team = 0.75 + 0.00015 * (Elo_team - Elo_other), clamp em [0.55, 0.92]
  // Formato: 5 cobranças cada, com early-stopping (uma equipe garante antes do fim).
  // Empate após 5 → alternância (sudden death) até diferença de 1 com mesmo nº de cobranças.

  function penaltyConvProb(eloA, eloB) {
    const p = 0.75 + 0.00015 * (eloA - eloB);
    return Math.max(0.55, Math.min(0.92, p));
  }

  Model.samplePenalties = function (eloHome, eloAway, rng) {
    const pH = penaltyConvProb(eloHome, eloAway);
    const pA = penaltyConvProb(eloAway, eloHome);
    let scoreH = 0, scoreA = 0;
    let kicksH = 0, kicksA = 0;

    function remaining(side) { return 5 - (side === "H" ? kicksH : kicksA); }
    function decided() {
      // Se diferença atual > cobranças restantes do lado atrasado, decidido.
      const remH = 5 - kicksH, remA = 5 - kicksA;
      if (scoreH - scoreA > remA) return true;
      if (scoreA - scoreH > remH) return true;
      return false;
    }

    // Fase regulamentar: alternância H,A,H,A,...
    while (kicksH < 5 || kicksA < 5) {
      if (kicksH <= kicksA && kicksH < 5) {
        if (rng() < pH) scoreH++;
        kicksH++;
      } else if (kicksA < 5) {
        if (rng() < pA) scoreA++;
        kicksA++;
      } else break;
      if (decided()) return { home: scoreH, away: scoreA, suddenDeath: false };
    }

    // Morte súbita: continua alternando, decide quando uma converte e a outra não no mesmo round.
    while (true) {
      const hScored = rng() < pH;
      const aScored = rng() < pA;
      scoreH += hScored ? 1 : 0;
      scoreA += aScored ? 1 : 0;
      kicksH++; kicksA++;
      if (hScored !== aScored) {
        return { home: scoreH, away: scoreA, suddenDeath: true };
      }
    }
  };

  // ---------------------------------------------------------------------------
  // 9. Helper completo: simulação de uma partida (group ou knockout)
  // ---------------------------------------------------------------------------
  // Devolve placar de 90' sempre; se knockout e empatado em 90', tb traz ET; se ainda
  // empatado, tb traz pens; e o vencedor consolidado.

  Model.simulateMatch = function (eloHome, eloAway, opts, rng) {
    opts = opts || {};
    const { lambdaHome, lambdaAway } = Model.expectedGoals(eloHome, eloAway, opts);
    const grid = Model.matchProbabilities(lambdaHome, lambdaAway);
    const ft = Model.sampleScore(grid, rng);

    const result = {
      home: opts.homeCode, away: opts.awayCode,
      scoreHome: ft.home, scoreAway: ft.away,
      etHome: 0, etAway: 0,
      penHome: 0, penAway: 0,
      lambdaHome, lambdaAway,
      decided: "ft",
      winner: null,
    };

    if (opts.knockout && ft.home === ft.away) {
      const et = Model.sampleExtraTime(lambdaHome, lambdaAway, rng);
      result.etHome = et.home;
      result.etAway = et.away;
      result.decided = "et";
      const aggH = ft.home + et.home, aggA = ft.away + et.away;
      if (aggH === aggA) {
        const pen = Model.samplePenalties(eloHome, eloAway, rng);
        result.penHome = pen.home;
        result.penAway = pen.away;
        result.decided = "pens";
        result.winner = pen.home > pen.away ? opts.homeCode : opts.awayCode;
      } else {
        result.winner = aggH > aggA ? opts.homeCode : opts.awayCode;
      }
    } else if (ft.home > ft.away) {
      result.winner = opts.homeCode;
    } else if (ft.home < ft.away) {
      result.winner = opts.awayCode;
    } else {
      // grupo empatado: sem vencedor
      result.winner = null;
    }
    return result;
  };

  // ---------------------------------------------------------------------------
  global.Model = Model;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
