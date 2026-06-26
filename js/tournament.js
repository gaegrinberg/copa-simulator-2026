// tournament.js
// Regras do torneio Copa do Mundo 2026 (formato 48 seleções).
// Funções puras: dado um estado (jogos + bracket), devolvem classificação dos grupos,
// 8 melhores 3ºs colocados, alocação dos 3ºs nos slots do R32, e progressão do mata-mata.
//
// O simulador (Etapa 5) chama este módulo após preencher todos os jogos da fase de grupos
// (mistura de played:true reais + played:false simulados).

(function (global) {
  const Tournament = {};

  // ---------------------------------------------------------------------------
  // 1. Classificação dentro de um grupo
  // ---------------------------------------------------------------------------
  // Critérios FIFA 2026 (em ordem):
  //   1. Pontos (V=3, E=1, D=0)
  //   2. Saldo de gols geral
  //   3. Gols pró geral
  //   4. Pontos no confronto direto entre os empatados
  //   5. Saldo de gols no confronto direto
  //   6. Gols pró no confronto direto
  //   7. Fair play (pulado — sem dados)
  //   8. Sorteio (rng)
  //
  // Os critérios 4-6 só se aplicam DENTRO do subconjunto de times empatados nos critérios 1-3.

  function teamStatsFromMatches(teamCode, matches) {
    let played = 0, wins = 0, draws = 0, losses = 0, gf = 0, ga = 0;
    for (const m of matches) {
      if (!m.played) continue;
      if (m.home === teamCode) {
        played++; gf += m.score_home; ga += m.score_away;
        if (m.score_home > m.score_away) wins++;
        else if (m.score_home < m.score_away) losses++;
        else draws++;
      } else if (m.away === teamCode) {
        played++; gf += m.score_away; ga += m.score_home;
        if (m.score_away > m.score_home) wins++;
        else if (m.score_away < m.score_home) losses++;
        else draws++;
      }
    }
    return {
      team: teamCode,
      played, wins, draws, losses, gf, ga,
      gd: gf - ga,
      points: wins * 3 + draws,
    };
  }

  // Mini-tabela entre um subconjunto de times (apenas jogos entre eles).
  function miniTable(teamCodes, matches) {
    const setCodes = new Set(teamCodes);
    const sub = matches.filter(m => m.played && setCodes.has(m.home) && setCodes.has(m.away));
    const table = {};
    for (const code of teamCodes) table[code] = teamStatsFromMatches(code, sub);
    return table;
  }

  // Resolve empates aplicando recursivamente os critérios.
  function sortGroup(teams, matches, rng) {
    // teams: array de stats já computadas (com pontos, gd, gf, gols)
    // Ordena por 1-3 (pontos, gd, gf). Depois, dentro de cada empate, aplica h2h e sorteio.

    // Passo A: ordena por pontos > gd > gf
    const sorted = teams.slice().sort((x, y) => {
      if (y.points !== x.points) return y.points - x.points;
      if (y.gd !== x.gd) return y.gd - x.gd;
      if (y.gf !== x.gf) return y.gf - x.gf;
      return 0;
    });

    // Passo B: identifica grupos de times empatados em (pontos, gd, gf) e desempata
    const result = [];
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j < sorted.length
        && sorted[j].points === sorted[i].points
        && sorted[j].gd === sorted[i].gd
        && sorted[j].gf === sorted[i].gf) j++;

      const tied = sorted.slice(i, j);
      if (tied.length === 1) {
        result.push(tied[0]);
      } else {
        // Resolve via mini-tabela (h2h points > h2h gd > h2h gf > random)
        const mini = miniTable(tied.map(t => t.team), matches);
        const resolved = tied.slice().sort((x, y) => {
          const mx = mini[x.team], my = mini[y.team];
          if (my.points !== mx.points) return my.points - mx.points;
          if (my.gd !== mx.gd) return my.gd - mx.gd;
          if (my.gf !== mx.gf) return my.gf - mx.gf;
          return rng() < 0.5 ? 1 : -1; // sorteio
        });
        for (const t of resolved) result.push(t);
      }
      i = j;
    }
    return result;
  }

  Tournament.computeGroupStandings = function (groupId, teamCodes, matches, rng) {
    // teamCodes: array dos 4 códigos do grupo
    // matches: array com TODOS os jogos da fase de grupos (deste grupo); filtramos played:true aqui
    // rng: função () => [0,1) para sorteio
    const groupMatches = matches.filter(m => m.group === groupId);
    const stats = teamCodes.map(c => teamStatsFromMatches(c, groupMatches));
    return sortGroup(stats, groupMatches, rng);
  };

  // ---------------------------------------------------------------------------
  // 2. Seleção dos 8 melhores 3ºs colocados
  // ---------------------------------------------------------------------------
  // Critérios: pontos > saldo > gols pró > fair play (pulado) > sorteio.

  Tournament.selectBestThirds = function (allStandings, rng) {
    // allStandings: { A: [...4 stats...], B: [...], ..., L: [...] }
    const thirds = [];
    for (const g of Object.keys(allStandings)) {
      const t = allStandings[g][2]; // índice 2 = 3º colocado
      thirds.push({ ...t, group: g });
    }
    thirds.sort((x, y) => {
      if (y.points !== x.points) return y.points - x.points;
      if (y.gd !== x.gd) return y.gd - x.gd;
      if (y.gf !== x.gf) return y.gf - x.gf;
      return rng() < 0.5 ? 1 : -1;
    });
    return {
      advancing: thirds.slice(0, 8),    // 8 melhores
      eliminated: thirds.slice(8),      // 4 piores
    };
  };

  // ---------------------------------------------------------------------------
  // 3. Alocação dos 3ºs nos slots do R32
  // ---------------------------------------------------------------------------
  // FIFA tem uma tabela determinística de 495 entradas (C(12,8)) mapeando "quais
  // 8 grupos enviam 3º colocado" → permutação fixa por slot. Carregada em
  // data/third_place_table.json a partir do template oficial da Wikipedia
  // (Annexe C do regulamento FIFA WC 2026).
  //
  // Se a tabela oficial for fornecida, usa lookup direto (canônico).
  // Caso contrário (fallback), usa heurística de matching bipartido — válida
  // mas pode diferir da escolha FIFA em alguns slots.

  function findMatching(slotOrder, slotGroups, advancingGroupsByRank) {
    // Backtracking: para cada slot na ordem, tenta atribuir o melhor 3º colocado
    // (por ranking decrescente) cuja origem é elegível para aquele slot.
    const assignment = {};
    const usedGroups = new Set();

    function tryFill(idx) {
      if (idx === slotOrder.length) return true;
      const slot = slotOrder[idx];
      const eligible = slotGroups[slot];
      for (const g of advancingGroupsByRank) {
        if (usedGroups.has(g)) continue;
        if (!eligible.includes(g)) continue;
        assignment[slot] = g;
        usedGroups.add(g);
        if (tryFill(idx + 1)) return true;
        delete assignment[slot];
        usedGroups.delete(g);
      }
      return false;
    }

    return tryFill(0) ? assignment : null;
  }

  Tournament.allocateThirdsToR32 = function (advancingThirds, bracket, officialTable) {
    const alloc = bracket.third_place_allocation;
    const slots = alloc.slots_with_third_placer;
    const slotGroups = alloc.slot_groups;
    const groupsByRank = advancingThirds.map(t => t.group);

    let mapping = null;

    // Caminho preferido: lookup na tabela oficial FIFA (495 combinações)
    if (officialTable && officialTable.combinations) {
      const combo = groupsByRank.slice().sort().join("");
      const entry = officialTable.combinations[combo];
      if (entry) mapping = { ...entry.mapping };
    }

    // Fallback: heurística de matching bipartido
    if (!mapping) {
      mapping = findMatching(slots, slotGroups, groupsByRank);
    }

    if (!mapping) {
      // Último recurso (não deve acontecer): atribuição cega
      mapping = {};
      const used = new Set();
      for (const slot of slots) {
        for (const g of groupsByRank) {
          if (!used.has(g)) { mapping[slot] = g; used.add(g); break; }
        }
      }
    }

    // Converte grupo → código do time (o 3º colocado daquele grupo)
    const thirdByGroup = {};
    for (const t of advancingThirds) thirdByGroup[t.group] = t.team;
    const result = {};
    for (const slot of slots) result[slot] = thirdByGroup[mapping[slot]];
    return result;
  };

  // ---------------------------------------------------------------------------
  // 4. Resolução de seeds do mata-mata
  // ---------------------------------------------------------------------------
  // Seeds podem ser:
  //   "1A", "2J"    → 1º/2º do grupo
  //   "3CDEF..."    → 3º colocado alocado neste slot (precisa do matchId)
  //   "W074"        → vencedor do match 74
  //   "L101"        → perdedor do match 101

  Tournament.resolveSeed = function (seed, ctx) {
    // ctx: { standings, thirdsMapping, knockoutResults, currentMatchId }
    if (/^[12][A-L]$/.test(seed)) {
      const pos = seed[0] === '1' ? 0 : 1;
      return ctx.standings[seed[1]][pos].team;
    }
    if (seed[0] === '3') {
      return ctx.thirdsMapping[ctx.currentMatchId];
    }
    if (/^[WL]\d{3}$/.test(seed)) {
      const matchId = 'M' + seed.slice(1);
      const r = ctx.knockoutResults[matchId];
      if (!r) throw new Error(`Match ${matchId} ainda não resolvido (seed: ${seed})`);
      return seed[0] === 'W' ? r.winner : r.loser;
    }
    throw new Error(`Seed desconhecido: ${seed}`);
  };

  // ---------------------------------------------------------------------------
  // 5. Construção dos confrontos do R32
  // ---------------------------------------------------------------------------
  Tournament.buildR32Matchups = function (standings, thirdsMapping, bracket) {
    const list = [];
    for (const r of bracket.r32) {
      const home = r.home.startsWith('3')
        ? thirdsMapping[r.match]
        : Tournament.resolveSeed(r.home, { standings });
      const away = r.away.startsWith('3')
        ? thirdsMapping[r.match]
        : Tournament.resolveSeed(r.away, { standings });
      list.push({ id: r.match, stage: 'r32', home, away });
    }
    return list;
  };

  // ---------------------------------------------------------------------------
  // 6. Geração dos confrontos das fases seguintes a partir de resultados anteriores
  // ---------------------------------------------------------------------------
  // Recebe o resultado consolidado até o momento e devolve os confrontos da próxima fase.

  function buildRound(roundSpec, ctx) {
    return roundSpec.map(r => {
      const home = Tournament.resolveSeed(r.home, { ...ctx, currentMatchId: r.match });
      const away = Tournament.resolveSeed(r.away, { ...ctx, currentMatchId: r.match });
      return { id: r.match, home, away };
    });
  }

  Tournament.buildR16Matchups = function (ctx, bracket) {
    return buildRound(bracket.r16, ctx).map(m => ({ ...m, stage: 'r16' }));
  };
  Tournament.buildQFMatchups = function (ctx, bracket) {
    return buildRound(bracket.qf, ctx).map(m => ({ ...m, stage: 'qf' }));
  };
  Tournament.buildSFMatchups = function (ctx, bracket) {
    return buildRound(bracket.sf, ctx).map(m => ({ ...m, stage: 'sf' }));
  };
  Tournament.buildThirdPlace = function (ctx, bracket) {
    const r = bracket.third;
    return [{
      id: r.match,
      stage: 'third',
      home: Tournament.resolveSeed(r.home, { ...ctx, currentMatchId: r.match }),
      away: Tournament.resolveSeed(r.away, { ...ctx, currentMatchId: r.match }),
    }];
  };
  Tournament.buildFinal = function (ctx, bracket) {
    const r = bracket.final;
    return [{
      id: r.match,
      stage: 'final',
      home: Tournament.resolveSeed(r.home, { ...ctx, currentMatchId: r.match }),
      away: Tournament.resolveSeed(r.away, { ...ctx, currentMatchId: r.match }),
    }];
  };

  // ---------------------------------------------------------------------------
  // 7. Estágio máximo alcançado por cada time
  // ---------------------------------------------------------------------------
  // Útil para o Monte Carlo agregar P(passar de grupo), P(R16), ..., P(título).

  const STAGES = ['group', 'r32', 'r16', 'qf', 'sf', 'final', 'champion'];

  Tournament.STAGES = STAGES;

  Tournament.stageRank = function (stage) {
    return STAGES.indexOf(stage);
  };

  // ---------------------------------------------------------------------------
  // 8. Vencedor de um knockout dado o placar (90', prorrogação, pênaltis)
  // ---------------------------------------------------------------------------
  // A simulação do placar de 90' fica em model.js. Aqui só decidimos quem avança
  // dados o resultado regulamentar e (se necessário) prorrogação/pênaltis também
  // já simulados externamente.

  Tournament.decideKnockout = function (home, away, sh, sa, etHome, etAway, penHome, penAway) {
    // sh,sa: placar 90'. etHome/etAway: gols na prorrogação (0 se não houve). penHome/penAway: cobranças convertidas (0 se não houve).
    const ftH = sh + (etHome || 0), ftA = sa + (etAway || 0);
    if (ftH > ftA) return { winner: home, loser: away, decided: (etHome || etAway) ? 'et' : 'ft' };
    if (ftH < ftA) return { winner: away, loser: home, decided: (etHome || etAway) ? 'et' : 'ft' };
    if (penHome > penAway) return { winner: home, loser: away, decided: 'pens' };
    return { winner: away, loser: home, decided: 'pens' };
  };

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  global.Tournament = Tournament;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
