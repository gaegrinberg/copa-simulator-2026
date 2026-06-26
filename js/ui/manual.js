// Aba "Simulação manual": usuário fixa placares de jogos futuros e re-roda Monte Carlo.
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

  ManualUI.render = function (App, container, callbacks) {
    const state = App.state;
    const baseline = App.stats;
    const scenario = App.scenarioStats;
    const overrides = App.overrides;

    // Jogos futuros da fase de grupos, ordenados por data depois grupo
    const future = state.matches
      .filter(m => !m.played && m.stage === "group")
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date) || a.group.localeCompare(b.group));

    const overrideCount = Object.keys(overrides).length;

    container.innerHTML = `
      <div class="manual-layout">
        <div class="manual-left">
          <div class="manual-header">
            <h2>Cenários hipotéticos</h2>
            <p class="muted">
              Digite o placar dos jogos da fase de grupos que você quer fixar. Os campos vazios continuam sendo simulados.
              Atalho: pressione <kbd>Tab</kbd> entre os campos.
            </p>
          </div>

          ${future.length === 0
            ? '<div class="empty-state">Fase de grupos já terminou — sem jogos para fixar.</div>'
            : renderMatchList(future, overrides, state)}

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

    // Wiring inputs
    container.querySelectorAll("input.score-input").forEach(inp => {
      inp.addEventListener("input", (e) => {
        const matchId = e.target.dataset.matchid;
        const side = e.target.dataset.side; // "home" or "away"
        const row = container.querySelector(`tr[data-matchid="${matchId}"]`);
        const homeInp = row.querySelector('input[data-side="home"]');
        const awayInp = row.querySelector('input[data-side="away"]');
        const h = clampScore(homeInp.value);
        const a = clampScore(awayInp.value);

        if (h !== null && a !== null) {
          App.overrides[matchId] = { score_home: h, score_away: a };
          row.classList.add("locked");
        } else {
          delete App.overrides[matchId];
          row.classList.remove("locked");
        }
        updateControlsState(container, App);
      });
    });

    // Clear individual row
    container.querySelectorAll("button.row-clear").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const matchId = e.currentTarget.dataset.matchid;
        delete App.overrides[matchId];
        const row = container.querySelector(`tr[data-matchid="${matchId}"]`);
        if (row) {
          row.querySelector('input[data-side="home"]').value = "";
          row.querySelector('input[data-side="away"]').value = "";
          row.classList.remove("locked");
        }
        updateControlsState(container, App);
      });
    });

    // Apply button
    const runBtn = container.querySelector("#manual-run");
    if (runBtn) runBtn.addEventListener("click", () => callbacks.onApply());

    // Clear all
    const clearBtn = container.querySelector("#manual-clear");
    if (clearBtn) clearBtn.addEventListener("click", () => callbacks.onClear());
  };

  function updateControlsState(container, App) {
    const runBtn = container.querySelector("#manual-run");
    const clearBtn = container.querySelector("#manual-clear");
    const count = Object.keys(App.overrides).length;
    const countSpan = container.querySelector(".manual-count");
    if (runBtn) runBtn.disabled = count === 0;
    if (clearBtn) clearBtn.disabled = count === 0;
    if (countSpan) countSpan.textContent = `${count} jogo${count === 1 ? "" : "s"} fixado${count === 1 ? "" : "s"}`;
  }

  function renderMatchList(matches, overrides, state) {
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

    // Calcula deltas por time
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

    // Top movers para título (positivo e negativo) e classificação
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
