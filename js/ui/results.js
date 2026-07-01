// Aba "Resultados": registrar o placar REAL dos jogos que já terminaram, sem
// precisar editar data/matches.json na mão.
//
// Os resultados são salvos no localStorage do navegador e aplicados ao estado
// como jogos played:true (flag .local) — ou seja, entram no baseline de todas
// as abas e a simulação re-roda na hora. Diferente da aba Simulação manual,
// que cria cenários hipotéticos temporários.
//
// Pra tornar permanente no projeto: botão "Baixar matches.json" gera o arquivo
// já com os resultados mesclados; basta substituir data/matches.json e rodar
// python scripts/build_data_js.py.
//
// Depende de ManualUI.computeScenarioState (manual.js) pra resolver o bracket.

(function (global) {
  const ResultsUI = {};

  const LS_KEY = "copa2026.realResults";

  const STAGE_LABEL = {
    group: "Fase de grupos",
    r32: "16 avos de final (R32)",
    r16: "Oitavas de final",
    qf: "Quartas de final",
    sf: "Semifinais",
    third: "Disputa de 3º lugar",
    final: "Final",
  };
  const KO_STAGES = ["r32", "r16", "qf", "sf", "third", "final"];

  // Placar digitado mas ainda não salvo
  let draft = {};

  // ---------------------------------------------------------------------------
  // Store (localStorage)
  // ---------------------------------------------------------------------------
  ResultsUI.loadStore = function () {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? (JSON.parse(raw) || {}) : {};
    } catch (e) {
      console.warn("localStorage indisponível:", e);
      return {};
    }
  };

  function saveStore(store) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(store));
    } catch (e) {
      alert("Não consegui salvar no navegador (localStorage bloqueado?): " + e.message);
    }
  }

  function clampScore(v) {
    if (v === "" || v === null || v === undefined) return null;
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n < 0 || n > 15) return null;
    return n;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  ResultsUI.render = function (App, container, callbacks) {
    const state = App.state;
    const store = ResultsUI.loadStore();
    const matchById = {};
    for (const m of state.matches) matchById[m.id] = m;

    // Bracket determinístico só com resultados reais (overrides vazios)
    const scen = ManualUI.computeScenarioState(state, {});

    // Jogos de grupo ainda não jogados (normalmente nenhum a esta altura)
    const pendingGroup = state.matches
      .filter(m => m.stage === "group" && !m.played)
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date));

    let sections = "";
    if (pendingGroup.length) {
      sections += `<h3 class="ko-round-title">${STAGE_LABEL.group} — jogos pendentes</h3>`;
      sections += renderRows(pendingGroup.map(m => ({
        id: m.id, home: m.home, away: m.away, date: m.date,
        source: "pending", score_home: null, score_away: null, isKO: false,
      })), state, matchById);
    }

    let pendingCount = 0;
    for (const stage of KO_STAGES) {
      const list = (scen.rounds && scen.rounds[stage]) || [];
      if (!list.length) continue;
      pendingCount += list.filter(e => e.source === "pending").length;
      sections += `<h3 class="ko-round-title">${STAGE_LABEL[stage]}</h3>`;
      sections += renderRows(list.map(e => ({
        ...e,
        date: matchById[e.id] ? matchById[e.id].date : "",
        isKO: true,
      })), state, matchById);
    }
    if (!sections) {
      sections = `<div class="manual-section-note muted">Nenhum jogo disponível pra registrar ainda.</div>`;
    }

    const savedIds = Object.keys(store).filter(id => matchById[id] && matchById[id].local);
    const savedNote = savedIds.length
      ? `${savedIds.length} resultado${savedIds.length > 1 ? "s" : ""} salvo${savedIds.length > 1 ? "s" : ""} neste navegador`
      : "nenhum resultado salvo neste navegador";

    container.innerHTML = `
      <div class="results-layout">
        <div class="mu-header">
          <h2>Registrar resultados reais</h2>
          <p class="muted">
            Terminou um jogo de verdade? Digite o placar aqui e clique em
            <strong>Salvar e re-simular</strong>. O resultado vira jogo
            <span class="mu-badge real">encerrado</span> em todas as abas, fica salvo neste
            navegador (mesmo fechando a página) e a simulação re-roda na hora.
            Em caso de empate no mata-mata, escolha quem avançou nos pênaltis.
          </p>
        </div>

        ${sections}

        <div class="manual-controls">
          <button id="results-save" disabled>Salvar e re-simular</button>
          <button id="results-export" class="secondary" title="Baixa data/matches.json com os resultados salvos mesclados">Baixar matches.json</button>
          ${savedIds.length ? `<button id="results-clear" class="secondary">Apagar salvos (${savedIds.length})</button>` : ""}
          <span class="manual-count" id="results-count">${savedNote}</span>
        </div>

        <div class="manual-section-note muted">
          <strong>Pra gravar de vez no projeto:</strong> clique em <em>Baixar matches.json</em>,
          substitua <code>data/matches.json</code> pelo arquivo baixado e rode
          <code>python scripts/build_data_js.py</code>. Depois disso os resultados salvos no
          navegador viram redundantes e são ignorados automaticamente.
        </div>
      </div>
    `;

    wire(App, container, callbacks, matchById);
  };

  function renderRows(list, state, matchById) {
    const rows = list.map(e => {
      const hn = state.nameByCode[e.home] || e.home;
      const an = state.nameByCode[e.away] || e.away;
      const date = e.date ? e.date.slice(5).replace("-", "/") : "";
      const def = matchById[e.id];

      if (e.source === "real") {
        const isLocal = !!(def && def.local);
        const tied = e.score_home === e.score_away;
        const pens = tied && e.winner
          ? `<span class="ko-winner-badge">→ ${state.nameByCode[e.winner] || e.winner} nos pênaltis</span>` : "";
        return `
          <tr data-matchid="${e.id}" class="real-played">
            <td class="muted mono cell-date">${date}</td>
            <td class="cell-team home">${hn} ${Flags.html(e.home)}</td>
            <td class="cell-score"><span class="mono">${e.score_home} × ${e.score_away}</span></td>
            <td class="cell-team away">${Flags.html(e.away)}${an}</td>
            <td class="cell-ko-extra"><div class="ko-extra-inner">
              ${pens}
              ${isLocal
                ? `<span class="ls-badge">Salvo aqui</span>`
                : `<span class="ko-real-badge">OFICIAL</span>`}
            </div></td>
            <td class="cell-action">
              ${isLocal ? `<button class="row-unsave" data-matchid="${e.id}" title="Remover este resultado salvo">↺</button>` : ""}
            </td>
          </tr>
        `;
      }

      // pending → inputs
      const pensSel = e.isKO ? `
        <div class="ko-winner-pick">
          <span class="muted small">Pênaltis:</span>
          <select class="pens-select" data-matchid="${e.id}" disabled>
            <option value="home">${hn}</option>
            <option value="away">${an}</option>
          </select>
        </div>
      ` : "";

      return `
        <tr data-matchid="${e.id}">
          <td class="muted mono cell-date">${date}</td>
          <td class="cell-team home">${hn} ${Flags.html(e.home)}</td>
          <td class="cell-score">
            <input class="score-input" type="number" min="0" max="15" inputmode="numeric"
                   data-matchid="${e.id}" data-side="home" value="" />
            <span class="x">×</span>
            <input class="score-input" type="number" min="0" max="15" inputmode="numeric"
                   data-matchid="${e.id}" data-side="away" value="" />
          </td>
          <td class="cell-team away">${Flags.html(e.away)}${an}</td>
          <td class="cell-ko-extra"><div class="ko-extra-inner">${pensSel}</div></td>
          <td class="cell-action"></td>
        </tr>
      `;
    }).join("");

    return `
      <table class="manual-matches ko-matches results-matches">
        <thead><tr>
          <th>Data</th>
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

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------
  function wire(App, container, callbacks, matchById) {
    function updateSaveBtn() {
      const btn = container.querySelector("#results-save");
      const n = Object.keys(draft).length;
      if (btn) {
        btn.disabled = n === 0;
        btn.textContent = n === 0 ? "Salvar e re-simular" : `Salvar ${n} resultado${n > 1 ? "s" : ""} e re-simular`;
      }
    }

    container.querySelectorAll("input.score-input").forEach(inp => {
      inp.addEventListener("input", () => {
        const id = inp.dataset.matchid;
        const row = container.querySelector(`tr[data-matchid="${id}"]`);
        const h = clampScore(row.querySelector('input[data-side="home"]').value);
        const a = clampScore(row.querySelector('input[data-side="away"]').value);
        const sel = row.querySelector("select.pens-select");
        if (h !== null && a !== null) {
          draft[id] = { score_home: h, score_away: a };
          const tied = h === a;
          if (sel) {
            sel.disabled = !tied;
            if (tied) draft[id].ko_winner = sel.value;
          } else if (tied && matchById[id] && matchById[id].stage !== "group") {
            draft[id].ko_winner = "home";
          }
          row.classList.add("locked");
        } else {
          delete draft[id];
          row.classList.remove("locked");
          if (sel) sel.disabled = true;
        }
        updateSaveBtn();
      });
    });

    container.querySelectorAll("select.pens-select").forEach(sel => {
      sel.addEventListener("change", () => {
        const id = sel.dataset.matchid;
        if (draft[id]) draft[id].ko_winner = sel.value;
      });
    });

    const saveBtn = container.querySelector("#results-save");
    if (saveBtn) saveBtn.addEventListener("click", () => {
      const store = ResultsUI.loadStore();
      for (const id in draft) store[id] = draft[id];
      saveStore(store);
      draft = {};
      callbacks.onChange();
    });

    container.querySelectorAll("button.row-unsave").forEach(btn => {
      btn.addEventListener("click", () => {
        const store = ResultsUI.loadStore();
        delete store[btn.dataset.matchid];
        saveStore(store);
        callbacks.onChange();
      });
    });

    const clearBtn = container.querySelector("#results-clear");
    if (clearBtn) clearBtn.addEventListener("click", () => {
      saveStore({});
      callbacks.onChange();
    });

    const exportBtn = container.querySelector("#results-export");
    if (exportBtn) exportBtn.addEventListener("click", exportMatchesJson);

    // Restaura rascunho não salvo (sobrevive ao re-render que acontece quando
    // uma simulação termina enquanto o usuário digita).
    for (const id of Object.keys(draft)) {
      const row = container.querySelector(`tr[data-matchid="${id}"]`);
      const hi = row && row.querySelector('input[data-side="home"]');
      const ai = row && row.querySelector('input[data-side="away"]');
      if (!hi || !ai) { delete draft[id]; continue; } // jogo virou real/saiu da lista
      hi.value = draft[id].score_home;
      ai.value = draft[id].score_away;
      row.classList.add("locked");
      const sel = row.querySelector("select.pens-select");
      if (sel && draft[id].score_home === draft[id].score_away) {
        sel.disabled = false;
        if (draft[id].ko_winner) sel.value = draft[id].ko_winner;
      }
    }
    updateSaveBtn();
  }

  // ---------------------------------------------------------------------------
  // Export: matches.json original + resultados salvos mesclados
  // ---------------------------------------------------------------------------
  function exportMatchesJson() {
    const store = ResultsUI.loadStore();
    const bundle = JSON.parse(JSON.stringify(window.APP_DATA.matches));
    for (const m of bundle.matches) {
      const r = store[m.id];
      if (!r || m.played) continue;
      m.score_home = r.score_home;
      m.score_away = r.score_away;
      if (r.score_home === r.score_away && r.ko_winner) m.ko_winner = r.ko_winner;
      m.played = true;
    }
    const blob = new Blob([JSON.stringify(bundle, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "matches.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  global.ResultsUI = ResultsUI;
})(window);
