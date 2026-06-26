// simulator.js
// Orquestra Tournament + Model + Elo em um loop Monte Carlo.
//
// Para cada simulação (uma "trajetória independente"):
//   1. Clonar Elos iniciais.
//   2. Simular cada jogo da fase de grupos com played:false; aplicar Elo update.
//   3. Computar classificação dos 12 grupos e selecionar 8 melhores 3ºs.
//   4. Alocar 3ºs aos slots do R32 via tabela oficial FIFA.
//   5. Simular R32 → R16 → QF → SF → 3º lugar + Final; Elo updates entre rodadas.
//   6. Registrar para cada time o estágio máximo alcançado + posição no grupo.
//
// No fim, agregar contagens em probabilidades.
//
// Depende de Tournament (tournament.js), Model (model.js), Elo (elo.js).

(function (global) {
  // Resolve dependências via objeto global compartilhado (window, self, ou ctx em testes Node).
  const Tournament = global.Tournament;
  const Model = global.Model;
  const Elo = global.Elo;
  if (!Tournament || !Model || !Elo) {
    throw new Error("simulator.js: Tournament/Model/Elo precisam estar carregados antes (tournament.js, model.js, elo.js).");
  }

  const Simulator = {};

  // ---------------------------------------------------------------------------
  // Tally por time
  // ---------------------------------------------------------------------------
  const STAGES = ["group", "r32", "r16", "qf", "sf", "final", "champion"];

  function initTally(teamCodes) {
    const t = {};
    for (const code of teamCodes) {
      t[code] = {
        // estágio máximo alcançado, count por estágio
        stage: { group: 0, r32: 0, r16: 0, qf: 0, sf: 0, final: 0, champion: 0 },
        // posição final no grupo
        groupPos: { 1: 0, 2: 0, 3: 0, 4: 0 },
        // se chegou ao R32 (independente do estágio final)
        advancedFromGroup: 0,
        // somatórios para cálculo de Elo final médio, gols, etc.
        finalElo: 0,
        groupGF: 0, groupGA: 0, groupPts: 0,
      };
    }
    return t;
  }

  function addToTally(tally, sim) {
    for (const code in sim.stageReached) {
      const stage = sim.stageReached[code];
      tally[code].stage[stage]++;
      if (stage !== "group") tally[code].advancedFromGroup++;
      tally[code].finalElo += sim.finalElo[code];
    }
    for (const g in sim.standings) {
      sim.standings[g].forEach((t, idx) => {
        tally[t.team].groupPos[idx + 1]++;
        tally[t.team].groupGF += t.gf;
        tally[t.team].groupGA += t.ga;
        tally[t.team].groupPts += t.points;
      });
    }
  }

  function normalizeTally(tally, N) {
    const out = {};
    for (const code in tally) {
      const t = tally[code];
      // Probabilidades CUMULATIVAS (chegar pelo menos ao estágio)
      const c = t.stage;
      const cumChampion = c.champion;
      const cumFinal    = c.final + cumChampion;
      const cumSF       = c.sf + cumFinal;
      const cumQF       = c.qf + cumSF;
      const cumR16      = c.r16 + cumQF;
      const cumR32      = c.r32 + cumR16;
      out[code] = {
        pAdvanceGroup: cumR32 / N,
        pR16:          cumR16 / N,
        pQF:           cumQF / N,
        pSF:           cumSF / N,
        pFinal:        cumFinal / N,
        pChampion:     cumChampion / N,
        pGroupPos: {
          1: t.groupPos[1] / N,
          2: t.groupPos[2] / N,
          3: t.groupPos[3] / N,
          4: t.groupPos[4] / N,
        },
        avgFinalElo: t.finalElo / N,
        avgGroupPts: t.groupPts / N,
        avgGroupGF:  t.groupGF / N,
        avgGroupGA:  t.groupGA / N,
      };
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Uma simulação (uma trajetória)
  // ---------------------------------------------------------------------------
  Simulator.runOne = function (state, rng, overrides) {
    const { teams, matches, bracket, thirdTable } = state;
    overrides = overrides || {};

    // Elos clonados pra esta simulação
    const elos = {};
    for (const t of teams) elos[t.code] = t.elo_initial;

    // Mapa: code → grupo
    const groupOf = {};
    for (const t of teams) groupOf[t.code] = t.group;

    // === Fase de grupos ===
    // Construímos uma cópia dos jogos onde os não-played são simulados.
    // Ordenamos por data pra que a evolução do Elo seja realista.
    const groupMatches = matches.filter(m => m.stage === "group")
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date));

    const simulatedGroupMatches = [];
    for (const m of groupMatches) {
      if (m.played) {
        simulatedGroupMatches.push(m);
        continue;
      }
      // Override manual? Trata como jogo "jogado" com placar fixo e atualiza Elo.
      const ov = overrides[m.id];
      if (ov && typeof ov.score_home === "number" && typeof ov.score_away === "number") {
        simulatedGroupMatches.push({
          ...m,
          score_home: ov.score_home,
          score_away: ov.score_away,
          played: true,
          manual: true,
        });
        const updM = Elo.applyMatch(elos[m.home], elos[m.away], {
          scoreHome: ov.score_home,
          scoreAway: ov.score_away,
          decided: "ft",
        });
        elos[m.home] = updM.newHome;
        elos[m.away] = updM.newAway;
        continue;
      }
      // Simular
      const opts = { stage: "group", homeCode: m.home, awayCode: m.away, knockout: false };
      const sim = Model.simulateMatch(elos[m.home], elos[m.away], opts, rng);
      simulatedGroupMatches.push({
        ...m,
        score_home: sim.scoreHome,
        score_away: sim.scoreAway,
        played: true,
        simulated: true,
      });
      const upd = Elo.applyMatch(elos[m.home], elos[m.away], {
        scoreHome: sim.scoreHome,
        scoreAway: sim.scoreAway,
        decided: "ft",
      });
      elos[m.home] = upd.newHome;
      elos[m.away] = upd.newAway;
    }

    // === Classificação dos 12 grupos ===
    const groupTeams = {};
    for (const t of teams) {
      if (!groupTeams[t.group]) groupTeams[t.group] = [];
      groupTeams[t.group].push(t.code);
    }
    const standings = {};
    for (const g of "ABCDEFGHIJKL") {
      standings[g] = Tournament.computeGroupStandings(g, groupTeams[g], simulatedGroupMatches, rng);
    }

    // === 8 melhores 3ºs e alocação ===
    const thirds = Tournament.selectBestThirds(standings, rng);
    const thirdsMapping = Tournament.allocateThirdsToR32(thirds.advancing, bracket, thirdTable);

    // === Estágio de cada time ===
    const stageReached = {};
    for (const t of teams) stageReached[t.code] = "group";
    // 1ºs e 2ºs avançam ao R32
    for (const g of "ABCDEFGHIJKL") {
      stageReached[standings[g][0].team] = "r32";
      stageReached[standings[g][1].team] = "r32";
    }
    for (const t of thirds.advancing) stageReached[t.team] = "r32";

    // === Mata-mata ===
    const knockoutResults = {};

    function simulateAndRecord(matchList, nextStage) {
      for (const m of matchList) {
        const opts = { stage: "ko", homeCode: m.home, awayCode: m.away, knockout: true };
        const sim = Model.simulateMatch(elos[m.home], elos[m.away], opts, rng);
        const upd = Elo.applyMatch(elos[m.home], elos[m.away], {
          scoreHome: sim.scoreHome,
          scoreAway: sim.scoreAway,
          etHome: sim.etHome,
          etAway: sim.etAway,
          decided: sim.decided,
        });
        elos[m.home] = upd.newHome;
        elos[m.away] = upd.newAway;
        const winner = sim.winner;
        const loser = winner === m.home ? m.away : m.home;
        knockoutResults[m.id] = { winner, loser, sim };
        if (nextStage) stageReached[winner] = nextStage;
      }
    }

    const r32 = Tournament.buildR32Matchups(standings, thirdsMapping, bracket);
    simulateAndRecord(r32, "r16");

    const ctx = { standings, thirdsMapping, knockoutResults };
    const r16 = Tournament.buildR16Matchups(ctx, bracket);
    simulateAndRecord(r16, "qf");

    const qf = Tournament.buildQFMatchups(ctx, bracket);
    simulateAndRecord(qf, "sf");

    const sf = Tournament.buildSFMatchups(ctx, bracket);
    // SF: vencedor vai à final, perdedor vai pra disputa de 3º. Marca ambos com seu estágio máximo.
    for (const m of sf) {
      const opts = { stage: "ko", homeCode: m.home, awayCode: m.away, knockout: true };
      const sim = Model.simulateMatch(elos[m.home], elos[m.away], opts, rng);
      const upd = Elo.applyMatch(elos[m.home], elos[m.away], {
        scoreHome: sim.scoreHome, scoreAway: sim.scoreAway,
        etHome: sim.etHome, etAway: sim.etAway, decided: sim.decided,
      });
      elos[m.home] = upd.newHome;
      elos[m.away] = upd.newAway;
      const winner = sim.winner;
      const loser = winner === m.home ? m.away : m.home;
      knockoutResults[m.id] = { winner, loser, sim };
      stageReached[winner] = "final";  // vai disputar a final
      stageReached[loser] = "sf";      // chega às semis (e disputa 3º lugar)
    }

    // Disputa de 3º lugar (não muda stage máximo dos perdedores, mas registramos resultado)
    const third = Tournament.buildThirdPlace(ctx, bracket);
    for (const m of third) {
      const opts = { stage: "ko", homeCode: m.home, awayCode: m.away, knockout: true };
      const sim = Model.simulateMatch(elos[m.home], elos[m.away], opts, rng);
      const upd = Elo.applyMatch(elos[m.home], elos[m.away], {
        scoreHome: sim.scoreHome, scoreAway: sim.scoreAway,
        etHome: sim.etHome, etAway: sim.etAway, decided: sim.decided,
      });
      elos[m.home] = upd.newHome;
      elos[m.away] = upd.newAway;
      knockoutResults[m.id] = { winner: sim.winner, loser: sim.winner === m.home ? m.away : m.home, sim };
    }

    // Final
    const finalArr = Tournament.buildFinal(ctx, bracket);
    for (const m of finalArr) {
      const opts = { stage: "ko", homeCode: m.home, awayCode: m.away, knockout: true };
      const sim = Model.simulateMatch(elos[m.home], elos[m.away], opts, rng);
      const upd = Elo.applyMatch(elos[m.home], elos[m.away], {
        scoreHome: sim.scoreHome, scoreAway: sim.scoreAway,
        etHome: sim.etHome, etAway: sim.etAway, decided: sim.decided,
      });
      elos[m.home] = upd.newHome;
      elos[m.away] = upd.newAway;
      knockoutResults[m.id] = { winner: sim.winner, loser: sim.winner === m.home ? m.away : m.home, sim };
      stageReached[sim.winner] = "champion";
    }

    return {
      stageReached,
      standings,
      thirds,
      thirdsMapping,
      knockoutResults,
      finalElo: elos,
    };
  };

  // ---------------------------------------------------------------------------
  // Loop de N simulações
  // ---------------------------------------------------------------------------
  Simulator.run = function (state, N, rng, onProgress, overrides) {
    const teamCodes = state.teams.map(t => t.code);
    const tally = initTally(teamCodes);

    // Combinações de top-8 3ºs (FIFA combo) mais comuns
    const fifaCombo = {};

    // Por matchId do mata-mata: contagem de quem foi home, away, e quem venceu
    // Estrutura: matchupCounts[matchId] = { home: {code:cnt}, away: {code:cnt}, winner: {code:cnt} }
    const matchupCounts = {};
    function bumpMatch(matchId, home, away, winner) {
      if (!matchupCounts[matchId]) matchupCounts[matchId] = { home: {}, away: {}, winner: {} };
      const mc = matchupCounts[matchId];
      mc.home[home] = (mc.home[home] || 0) + 1;
      mc.away[away] = (mc.away[away] || 0) + 1;
      if (winner) mc.winner[winner] = (mc.winner[winner] || 0) + 1;
    }

    const reportEvery = Math.max(1, Math.floor(N / 100));

    for (let i = 0; i < N; i++) {
      const sim = Simulator.runOne(state, rng, overrides);
      addToTally(tally, sim);

      // Combinação de 3ºs
      const combo = sim.thirds.advancing.map(t => t.group).slice().sort().join("");
      fifaCombo[combo] = (fifaCombo[combo] || 0) + 1;

      // Confrontos do mata-mata
      for (const id in sim.knockoutResults) {
        const r = sim.knockoutResults[id];
        bumpMatch(id, r.sim.home, r.sim.away, r.winner);
      }

      if (onProgress && i % reportEvery === 0) onProgress(i, N);
    }

    if (onProgress) onProgress(N, N);

    return {
      N,
      byTeam: normalizeTally(tally, N),
      fifaCombo,
      matchupCounts,
    };
  };

  // ---------------------------------------------------------------------------
  // RNG seedável (Mulberry32)
  // ---------------------------------------------------------------------------
  Simulator.mulberry32 = function (seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  };

  global.Simulator = Simulator;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
