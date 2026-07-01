// Aba "Simulação manual": usuário fixa placares de jogos futuros (grupos e mata-mata)
// e re-roda Monte Carlo. À medida que o usuário fixa resultados, as próximas rodadas
// do mata-mata vão aparecendo (R32 → R16 → QF → SF → 3º + Final) construindo o caminho.
//
// Mostra delta de probabilidades (P(título), P(final), P(grupo)) vs baseline.

(function (global) {
  const ManualUI = {};

  function pct(x) { return (x * 100).toFixed(1) + "%"; }
  function fmtDelta(d) {
    if (Math.abs(d) < 0.0005) return "<span class=\"delta-zero\">±0.0pp</span>";
    const sign = d > 0 ? "+" : "−";
    const cls = d > 0 ? "delta-up" : "delta-down";
    return `<span class="${cls}">${sign}${(Math.abs(d) * 100).toFixed(1)}pp</span>`;
  }

  function clampScore(v) {
    if (v === "" || v === null || v === undefined) return null;
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n < 0 || n > 15) return null;
    return n;
  }

  const KO_STAGE_LABEL = {
    r32: "Oitavas / R32",
    r16: "Round of 16",
    qf:  "Quartas de final",
    sf:  "Semifinais",
    third: "Disputa de 3º lugar",
    final: "Final",
  };
  const KO_STAGES = ["r32", "r16", "qf", "sf", "third", "final"];

  // -------------------------------------------------------------------------
  // Cenário determinístico: dado played + overrides, calcula até onde dá pra
  // determinar o bracket sem precisar de Monte Carlo.
  // -------------------------------------------------------------------------
  function computeScenarioState(state, overrides) {
    // 1. Jogos da fase de grupos efetivos (real played + override)
    const groupMatches = state.matches.filter(m => m.stage === "group").map(m => {
      if (m.played) return m;
      const ov = overrides[m.id];
      if (ov && typeof ov.score_home === "number" && typeof ov.score_away === "number") {
        return { ...m, played: true, score_home: ov.score_home, score_away: ov.score_away, manual: true };
      }
      return m;
    });

    // 2. Por grupo: todos os 6 jogos resolvidos? Se sim, computa standings.
    const teamsByGroup = {};
    for (const t of state.teams) (teamsByGroup[t.group] ||= []).push(t.code);

    const rng = () => 0.5; // preview determinístico
    const standings = {};
    let allGroupsSettled = true;
    for (const g of "ABCDEFGHIJKL") {
      const gms = groupMatches.filter(m => m.group === g);
      const allPlayed = gms.length === 6 && gms.every(m => m.played);
      if (!allPlayed) { allGroupsSettled = false; standings[g] = null; continue; }
      standings[g] = Tournament.computeGroupStandings(g, teamsByGroup[g], gms, rng);
    }

    const result = {
      allGroupsSettled,
      groupStandings: standings,
      rounds: {},        // stage → [{ id, home, away, score_home?, score_away?, ko_winner?, source, winner? }]
      hasAnyKnockoutOverride: false,
    };

    if (!allGroupsSettled) return result;

    // 3. Thirds + R32 mapping
    const thirds = Tournament.selectBestThirds(standings, rng);
    const thirdsMapping = Tournament.allocateThirdsToR32(thirds.advancing, state.bracket, state.thirdTable);
    result.thirds = thirds;
    result.thirdsMapping = thirdsMapping;

    // 4. Cascateia rodadas, populando knockoutResults pra resolver seeds da próxima
    const knockoutResults = {};
    const matchById = {};
    for (const m of state.matches) matchById[m.id] = m;

    // Processa uma rodada já com os pares montados (todos com home/away resolvidos).
    function processRound(matchList, stage) {
      const arr = [];
      for (const m of matchList) {
        const matchDef = matchById[m.id];
        const realPlayed = matchDef && matchDef.played && typeof matchDef.score_home === "number";
        const ov = overrides[m.id];
        const overridden = !realPlayed && ov && typeof ov.score_home === "number" && typeof ov.score_away === "number";

        const entry = {
          id: m.id, home: m.home, away: m.away, stage,
          score_home: null, score_away: null, ko_winner: null,
          source: "pending", winner: null,
        };

        let src = null;
        if (realPlayed) { src = matchDef; entry.source = "real"; }
        else if (overridden) { src = ov; entry.source = "manual"; result.hasAnyKnockoutOverride = true; }

        if (src) {
          entry.score_home = src.score_home;
          entry.score_away = src.score_away;
          let winner, loser;
          if (src.score_home > src.score_away) { winner = m.home; loser = m.away; }
          else if (src.score_away > src.score_home) { winner = m.away; loser = m.home; }
          else {
            entry.ko_winner = src.ko_winner || "home";
            winner = entry.ko_winner === "away" ? m.away : m.home;
            loser = winner === m.home ? m.away : m.home;
          }
          entry.winner = winner;
          knockoutResults[m.id] = { winner, loser };
        }
        arr.push(entry);
      }
      result.rounds[stage] = arr;
    }

    // Tenta resolver cada par de seeds independentemente — se um lado ainda
    // depende de jogo não fixado, pula esse confronto (mas mantém os outros).
    function tryBuildRound(roundSpec, ctx) {
      const built = [];
      for (const r of roundSpec) {
        try {
          const home = Tournament.resolveSeed(r.home, { ...ctx, currentMatchId: r.match });
          const away = Tournament.resolveSeed(r.away, { ...ctx, currentMatchId: r.match });
          built.push({ id: r.match, home, away });
        } catch (e) {
          // home ou away ainda não resolvido — pula esse jogo
        }
      }
      return built;
    }

    const ctx = { standings, thirdsMapping, knockoutResults };

    // R32: todos os 16 confrontos estão determinados (depende só de standings).
    const r32 = Tournament.buildR32Matchups(standings, thirdsMapping, state.bracket);
    processRound(r32, "r32");

    // Rodadas seguintes: cada confronto aparece só se ambos os lados estão decididos.
    processRound(tryBuildRound(state.bracket.r16, ctx), "r16");
    processRound(tryBuildRound(state.bracket.qf, ctx), "qf");
    processRound(tryBuildRound(state.bracket.sf, ctx), "sf");
    processRound(tryBuildRound([state.bracket.third], ctx), "third");
    processRound(tryBuildRound([state.bracket.final], ctx), "final");

    return result;
  }

  // Exposto pra reuso na aba Resultados (results.js): com overrides={} devolve
  // o bracket determinístico considerando só os resultados reais.
  ManualUI.computeScenarioState = computeScenarioState;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  ManualUI.render = function (App, container, callbacks) {
    ManualUI._lastCallbacks = callbacks;
    const state = App.state;
    const baseline = App.stats;
    const scenario = App.scenarioStats;
    const overrides = App.overrides;

    // Jogos futuros da fase de grupos
    const futureGroup = state.matches
      .filter(m => !m.played && m.stage === "group")
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date) || a.group.localeCompare(b.group));

    const overrideCount = Object.keys(overrides).length;
    const scenarioState = computeScenarioState(state, overrides);

    container.innerHTML = `
      <div class="manual-layout">
        <div class="manual-left">
          <div class="manual-header">
            <h2>Cenários hipotéticos</h2>
            <p class="muted">
              Fixe placares dos jogos restantes da fase de grupos e, conforme o bracket
              vai sendo determinado, do mata-mata também. Campos vazios continuam sendo simulados.
              Depois clique em <strong>Aplicar cenário e simular</strong> para atualizar as probabilidades. Atalho: <kbd>Tab</kbd> entre os campos.
            </p>
          </div>

          ${futureGroup.length > 0 ? `
            <h3 class="ko-round-title">Fase de grupos — jogos restantes</h3>
            ${renderGroupMatchList(futureGroup, overrides, state)}
          ` : '<div class="manual-section-note muted">Fase de grupos completa.</div>'}

          ${renderKnockoutSections(scenarioState, state)}

          <div class="manual-controls">
            <button id="manual-run" ${overrideCount === 0 ? "disabled" : ""}>Aplicar cenário e simular</button>
            <button id="manual-clear" class="secondary" ${overrideCount === 0 ? "disabled" : ""}>Limpar todos</button>
            <span class="manual-count">${overrideCount} jogo${overrideCount === 1 ? "" : "s"} fixado${overrideCount === 1 ? "" : "s"}</span>
          </div>
        </div>

        <div class="manual-right">
          <h2>Impacto vs. baseline</h2>
          ${renderDiffPanel(state, baseline, scenario, overrides)}
        </div>
      </div>
    `;

    wireInputs(App, container, callbacks);
  };

  function wireInputs(App, container, callbacks) {
    // Score inputs (grupo + mata-mata)
    container.querySelectorAll("input.score-input").forEach(inp => {
      inp.addEventListener("input", (e) => {
        const matchId = e.target.dataset.matchid;
        const row = container.querySelector(`tr[data-matchid="${matchId}"]`);
        const homeInp = row.querySelector('input[data-side="home"]');
        const awayInp = row.querySelector('input[data-side="away"]');
        const h = clampScore(homeInp.value);
        const a = clampScore(awayInp.value);

        if (h !== null && a !== null) {
          const prev = App.overrides[matchId] || {};
          const ov = { score_home: h, score_away: a };
          // Mata-mata empatado: preserva ko_winner se já existia
          if (h === a && prev.ko_winner) ov.ko_winner = prev.ko_winner;
          else if (h === a) ov.ko_winner = "home";
          App.overrides[matchId] = ov;
          row.classList.add("locked");
        } else {
          delete App.overrides[matchId];
          row.classList.remove("locked");
        }
        updateControlsState(container, App);
      });

      // Re-render só quando o foco sair de todos os campos de placar — assim o
      // usuário pode tabular entre jogos sem o re-render destruir o input atual.
      inp.addEventListener("blur", () => {
        setTimeout(() => {
          const active = document.activeElement;
          if (active && container.contains(active) && active.classList.contains("score-input")) return;
          ManualUI.render(App, container, callbacks);
        }, 0);
      });
    });

    // KO winner selector (empate em 90' → quem vence nos pênaltis)
    container.querySelectorAll("select.ko-winner-select").forEach(sel => {
      sel.addEventListener("change", (e) => {
        const matchId = e.target.dataset.matchid;
        const ov = App.overrides[matchId];
        if (!ov) return;
        ov.ko_winner = e.target.value;
        App.overrides[matchId] = ov;
        ManualUI.render(App, container, callbacks);
      });
    });

    // Clear individual row
    container.querySelectorAll("button.row-clear").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const matchId = e.currentTarget.dataset.matchid;
        delete App.overrides[matchId];
        ManualUI.render(App, container, callbacks);
      });
    });

    const runBtn = container.querySelector("#manual-run");
    if (runBtn) runBtn.addEventListener("click", () => callbacks.onApply());

    const clearBtn = container.querySelector("#manual-clear");
    if (clearBtn) clearBtn.addEventListener("click", () => callbacks.onClear());
  }

  function updateControlsState(container, App) {
    const runBtn = container.querySelector("#manual-run");
    const clearBtn = container.querySelector("#manual-clear");
    const count = Object.keys(App.overrides).length;
    const countSpan = container.querySelector(".manual-count");
    if (runBtn) runBtn.disabled = count === 0;
    if (clearBtn) clearBtn.disabled = count === 0;
    if (countSpan) countSpan.textContent = `${count} jogo${count === 1 ? "" : "s"} fixado${count === 1 ? "" : "s"}`;
  }

  function renderGroupMatchList(matches, overrides, state) {
    const rows = matches.map(m => {
      const ov = overrides[m.id];
      const hVal = ov ? ov.score_home : "";
      const aVal = ov ? ov.score_away : "";
      const homeName = state.nameByCode[m.home] || m.home;
      const awayName = state.nameByCode[m.away] || m.away;
      const locked = ov ? "locked" : "";
      const date = m.date ? m.date.slice(5).replace("-", "/") : "";
      return `
        <tr data-matchid="${m.id}" class="${locked}">
          <td class="muted mono cell-date">${date}</td>
          <td class="muted cell-group">G${m.group}</td>
          <td class="cell-team home">${homeName} ${Flags.html(m.home)}</td>
          <td class="cell-score">
            <input class="score-input" type="number" min="0" max="15" inputmode="numeric"
                   data-matchid="${m.id}" data-side="home" value="${hVal}" />
            <span class="x">×</span>
            <input class="score-input" type="number" min="0" max="15" inputmode="numeric"
                   data-matchid="${m.id}" data-side="away" value="${aVal}" />
          </td>
          <td class="cell-team away">${Flags.html(m.away)}${awayName}</td>
          <td class="cell-action">
            <button class="row-clear" data-matchid="${m.id}" title="Limpar este jogo">↺</button>
          </td>
        </tr>
      `;
    }).join("");

    return `
      <table class="manual-matches">
        <thead>
          <tr>
            <th>Data</th><th>Grupo</th><th class="th-home">Casa</th>
            <th class="th-score">Placar</th><th class="th-away">Fora</th><th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function renderKnockoutSections(scenarioState, state) {
    if (!scenarioState.allGroupsSettled) {
      return `
        <div class="manual-section-note muted">
          <strong>Mata-mata:</strong> fixe o placar de todos os jogos restantes da fase de grupos
          (ou aguarde os resultados reais) para liberar a edição dos jogos do mata-mata.
        </div>
      `;
    }
    let html = "";
    for (const stage of KO_STAGES) {
      const list = scenarioState.rounds[stage];
      if (!list || list.length === 0) continue;
      html += `<h3 class="ko-round-title">${KO_STAGE_LABEL[stage]}</h3>`;
      html += renderKnockoutMatchList(list, state);
    }
    // Dica: se faltam rodadas posteriores ainda sem nenhum jogo, explica.
    const lastNonEmpty = [...KO_STAGES].reverse().find(s => scenarioState.rounds[s] && scenarioState.rounds[s].length > 0);
    if (lastNonEmpty && lastNonEmpty !== "final") {
      const nextStage = KO_STAGES[KO_STAGES.indexOf(lastNonEmpty) + 1];
      if (nextStage && (!scenarioState.rounds[nextStage] || scenarioState.rounds[nextStage].length === 0)) {
        html += `<div class="manual-section-note muted">
          Fixe ambos os lados de um confronto para liberar a próxima rodada do bracket.
        </div>`;
      }
    }
    return html;
  }

  function renderKnockoutMatchList(list, state) {
    const rows = list.map(m => {
      const hn = state.nameByCode[m.home] || m.home;
      const an = state.nameByCode[m.away] || m.away;
      const hVal = m.score_home != null ? m.score_home : "";
      const aVal = m.score_away != null ? m.score_away : "";
      const readonly = m.source === "real" ? "readonly disabled" : "";
      let lockClass = "";
      if (m.source === "manual") lockClass = "locked";
      else if (m.source === "real") lockClass = "real-played";

      const isTied = (m.score_home != null && m.score_away != null && m.score_home === m.score_away);
      const koWinner = m.ko_winner || "home";
      const showKoSel = isTied && m.source !== "real";

      const koWinnerHtml = showKoSel ? `
        <div class="ko-winner-pick">
          <span class="muted small">Pênaltis:</span>
          <select class="ko-winner-select" data-matchid="${m.id}">
            <option value="home" ${koWinner === "home" ? "selected" : ""}>${hn}</option>
            <option value="away" ${koWinner === "away" ? "selected" : ""}>${an}</option>
          </select>
        </div>
      ` : "";

      const winnerBadge = (m.winner && m.source !== "real") ? `<span class="ko-winner-badge">→ ${state.nameByCode[m.winner] || m.winner}</span>` : "";
      const realBadge = m.source === "real" ? `<span class="ko-real-badge">JOGADO</span>` : "";

      return `
        <tr data-matchid="${m.id}" class="${lockClass}">
          <td class="cell-team home">${hn} ${Flags.html(m.home)}</td>
          <td class="cell-score">
            <input class="score-input" type="number" min="0" max="15" inputmode="numeric"
                   data-matchid="${m.id}" data-side="home" data-ko="1" value="${hVal}" ${readonly} />
            <span class="x">×</span>
            <input class="score-input" type="number" min="0" max="15" inputmode="numeric"
                   data-matchid="${m.id}" data-side="away" data-ko="1" value="${aVal}" ${readonly} />
          </td>
          <td class="cell-team away">${Flags.html(m.away)}${an}</td>
          <td class="cell-ko-extra"><div class="ko-extra-inner">${koWinnerHtml}${winnerBadge}${realBadge}</div></td>
          <td class="cell-action">
            ${m.source === "manual" ? `<button class="row-clear" data-matchid="${m.id}" title="Limpar">↺</button>` : ""}
          </td>
        </tr>
      `;
    }).join("");
    return `
      <table class="manual-matches ko-matches">
        <thead><tr>
          <th class="th-home">Casa</th>
          <th class="th-score">Placar</th>
          <th class="th-away">Fora</th>
          <th></th>
          <th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function renderDiffPanel(state, baseline, scenario, overrides) {
    if (!baseline) {
      return '<div class="empty-state">Aguardando baseline...</div>';
    }
    if (Object.keys(overrides).length === 0) {
      return `
        <div class="muted manual-hint">
          Fixe ao menos um jogo à esquerda e clique em <strong>Aplicar cenário e simular</strong>.<br><br>
          O painel vai mostrar quanto cada seleção subiu/desceu nas suas chances de título, final, semis e classificação para o mata-mata vs. o baseline atual.
        </div>
      `;
    }
    if (!scenario) {
      return `
        <div class="muted manual-hint">
          ${Object.keys(overrides).length} jogo(s) prontos para fixar. Clique em <strong>Aplicar cenário e simular</strong> para ver o impacto.
        </div>
      `;
    }

    const rows = state.teams.map(t => {
      const b = baseline.byTeam[t.code] || {};
      const s = scenario.byTeam[t.code] || {};
      return {
        code: t.code,
        name: t.name_pt,
        group: t.group,
        bChamp: b.pChampion || 0, sChamp: s.pChampion || 0, dChamp: (s.pChampion || 0) - (b.pChampion || 0),
        bFinal: b.pFinal || 0, sFinal: s.pFinal || 0, dFinal: (s.pFinal || 0) - (b.pFinal || 0),
        bR32: b.pAdvanceGroup || 0, sR32: s.pAdvanceGroup || 0, dR32: (s.pAdvanceGroup || 0) - (b.pAdvanceGroup || 0),
      };
    });

    const champMovers = rows.slice().sort((a, b) => Math.abs(b.dChamp) - Math.abs(a.dChamp)).slice(0, 10).filter(r => Math.abs(r.dChamp) > 0.001);
    const advMovers = rows.slice().sort((a, b) => Math.abs(b.dR32) - Math.abs(a.dR32)).slice(0, 10).filter(r => Math.abs(r.dR32) > 0.001);

    return `
      <div class="diff-section">
        <h3>Maiores mudanças na P(título)</h3>
        ${champMovers.length === 0 ? '<div class="muted">Sem mudanças significativas.</div>' : `
        <table class="diff-table">
          <thead><tr><th>Seleção</th><th class="num">Baseline</th><th class="num">Cenário</th><th class="num">Δ</th></tr></thead>
          <tbody>
            ${champMovers.map(r => `
              <tr>
                <td>${Flags.html(r.code)}${r.name}</td>
                <td class="num">${pct(r.bChamp)}</td>
                <td class="num">${pct(r.sChamp)}</td>
                <td class="num">${fmtDelta(r.dChamp)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>`}
      </div>

      <div class="diff-section">
        <h3>Maiores mudanças em classificar para mata-mata</h3>
        ${advMovers.length === 0 ? '<div class="muted">Sem mudanças significativas.</div>' : `
        <table class="diff-table">
          <thead><tr><th>Seleção</th><th class="num">Baseline</th><th class="num">Cenário</th><th class="num">Δ</th></tr></thead>
          <tbody>
            ${advMovers.map(r => `
              <tr>
                <td>${Flags.html(r.code)}${r.name} <span class="muted">G${r.group}</span></td>
                <td class="num">${pct(r.bR32)}</td>
                <td class="num">${pct(r.sR32)}</td>
                <td class="num">${fmtDelta(r.dR32)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>`}
      </div>
    `;
  }

  global.ManualUI = ManualUI;
})(window);
