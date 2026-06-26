// main.js — bootstrap do app: carrega dados, gerencia abas, dispara Monte Carlo.
//
// Tenta Web Worker primeiro. Se falhar (file:// no Chrome bloqueia worker local),
// roda no main thread em chunks com requestAnimationFrame pra não travar a UI.

(function () {
  const App = {
    state: null,
    stats: null,            // baseline (sem overrides)
    scenarioStats: null,    // último cenário manual rodado
    overrides: {},          // map matchId → {score_home, score_away}
    pendingMode: null,      // "baseline" | "scenario" — qual run está rodando
    lastBaselineSeed: null, // seed usada na última baseline (reusada nos cenários)
    activeTab: "overview",
    worker: null,
    workerOK: false,
  };

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------
  function init() {
    if (!window.APP_DATA) {
      document.body.innerHTML = "<div style='padding:40px;color:#f85149'>Erro: data/data.js não carregou. Rode <code>python scripts/build_data_js.py</code> primeiro.</div>";
      return;
    }
    const data = window.APP_DATA;
    App.state = {
      teams: data.teams.teams,
      matches: data.matches.matches,
      bracket: data.bracket,
      thirdTable: data.thirdTable,
      teamByCode: {},
      nameByCode: {},
    };
    for (const t of App.state.teams) {
      App.state.teamByCode[t.code] = t;
      App.state.nameByCode[t.code] = t.name_pt;
    }

    setupTabs();
    setupControls();
    setupWorker();
    renderInfo();

    // Renderiza tudo sem stats ainda (cada aba mostra "rode a simulação")
    renderActiveTab();

    // Dispara primeira simulação automaticamente
    runSimulation();
  }

  function setupTabs() {
    const tabs = Array.from(document.querySelectorAll("nav .tab"));

    function activate(idx, focus) {
      tabs.forEach((b, i) => {
        const isActive = i === idx;
        b.classList.toggle("active", isActive);
        b.setAttribute("aria-selected", isActive ? "true" : "false");
        b.setAttribute("tabindex", isActive ? "0" : "-1");
      });
      document.querySelectorAll(".tab-content").forEach(s => s.classList.remove("active"));
      const tab = tabs[idx].dataset.tab;
      document.getElementById("tab-" + tab).classList.add("active");
      App.activeTab = tab;
      if (focus) tabs[idx].focus();
      renderActiveTab();
    }

    tabs.forEach((btn, idx) => {
      btn.addEventListener("click", () => activate(idx, false));
      btn.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight") { e.preventDefault(); activate((idx + 1) % tabs.length, true); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); activate((idx - 1 + tabs.length) % tabs.length, true); }
        else if (e.key === "Home") { e.preventDefault(); activate(0, true); }
        else if (e.key === "End") { e.preventDefault(); activate(tabs.length - 1, true); }
      });
    });
  }

  function setupControls() {
    document.getElementById("run-sim").addEventListener("click", runSimulation);
  }

  function setupWorker() {
    try {
      App.worker = new Worker("js/worker.js?v=11");
      App.worker.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === "progress") onProgress(msg.done, msg.total);
        else if (msg.type === "result") onResult(msg.stats);
      };
      App.worker.onerror = (err) => {
        console.warn("Worker falhou, vou rodar no main thread:", err);
        App.workerOK = false;
        App.worker = null;
      };
      App.workerOK = true;
    } catch (err) {
      console.warn("Sem Worker disponível, main thread fallback.", err);
      App.workerOK = false;
    }
  }

  function renderInfo() {
    const m = window.APP_DATA.teams.meta;
    document.getElementById("data-info").textContent =
      `Elos: snapshot ${m.elo_snapshot_date} (eloratings.net) · ${App.state.teams.length} seleções, ${App.state.matches.length} jogos · jogos disputados: ${App.state.matches.filter(x => x.played).length}/72 (fase de grupos)`;
  }

  // ---------------------------------------------------------------------------
  // Execução do Monte Carlo
  // ---------------------------------------------------------------------------
  function runSimulation(opts) {
    opts = opts || {};
    const mode = opts.mode || "baseline";
    const overrides = mode === "scenario" ? App.overrides : null;
    App.pendingMode = mode;

    const N = parseInt(document.getElementById("n-sims").value, 10);
    const btn = document.getElementById("run-sim");
    btn.disabled = true;
    btn.textContent = "Simulando...";
    document.getElementById("progress-wrap").classList.add("active");
    onProgress(0, N);

    // Desabilita botão da aba manual também enquanto roda
    const manualBtn = document.getElementById("manual-run");
    if (manualBtn) { manualBtn.disabled = true; manualBtn.textContent = "Simulando..."; }

    // Common random numbers: cenário reusa a seed da última baseline,
    // isolando o efeito causal dos jogos fixados.
    let seed;
    if (mode === "scenario" && App.lastBaselineSeed !== null) {
      seed = App.lastBaselineSeed;
    } else {
      seed = (Date.now() & 0xFFFFFFFF) >>> 0;
      App.lastBaselineSeed = seed;
    }

    if (App.workerOK && App.worker) {
      App.worker.postMessage({ type: "run", N, state: App.state, seed, overrides });
    } else {
      runMainThread(N, overrides, seed);
    }
  }

  function runMainThread(N, overrides, seed) {
    // Roda em chunks de 200 sims pra atualizar progresso sem travar.
    const CHUNK = 200;
    const rng = Simulator.mulberry32(seed);
    const tally = { byTeam: {}, fifaCombo: {}, matchupCounts: {} };

    // Inicializa
    const teamCodes = App.state.teams.map(t => t.code);
    for (const c of teamCodes) tally.byTeam[c] = { stage: { group:0, r32:0, r16:0, qf:0, sf:0, final:0, champion:0 }, groupPos: {1:0,2:0,3:0,4:0}, finalElo: 0, groupGF:0, groupGA:0, groupPts:0 };

    let i = 0;
    function chunk() {
      const end = Math.min(i + CHUNK, N);
      for (; i < end; i++) {
        const sim = Simulator.runOne(App.state, rng, overrides);
        // Stage
        for (const code in sim.stageReached) {
          const stage = sim.stageReached[code];
          tally.byTeam[code].stage[stage]++;
          tally.byTeam[code].finalElo += sim.finalElo[code];
        }
        // Group pos
        for (const g in sim.standings) {
          sim.standings[g].forEach((t, idx) => {
            tally.byTeam[t.team].groupPos[idx + 1]++;
            tally.byTeam[t.team].groupGF += t.gf;
            tally.byTeam[t.team].groupGA += t.ga;
            tally.byTeam[t.team].groupPts += t.points;
          });
        }
        // Combo
        const combo = sim.thirds.advancing.map(t => t.group).slice().sort().join("");
        tally.fifaCombo[combo] = (tally.fifaCombo[combo] || 0) + 1;
        // Matchups
        for (const id in sim.knockoutResults) {
          const r = sim.knockoutResults[id];
          if (!tally.matchupCounts[id]) tally.matchupCounts[id] = { home: {}, away: {}, winner: {} };
          const mc = tally.matchupCounts[id];
          mc.home[r.sim.home] = (mc.home[r.sim.home] || 0) + 1;
          mc.away[r.sim.away] = (mc.away[r.sim.away] || 0) + 1;
          if (r.winner) mc.winner[r.winner] = (mc.winner[r.winner] || 0) + 1;
        }
      }
      onProgress(i, N);
      if (i < N) {
        setTimeout(chunk, 0);
      } else {
        // Normaliza
        const stats = { N, byTeam: {}, fifaCombo: tally.fifaCombo, matchupCounts: tally.matchupCounts };
        for (const code in tally.byTeam) {
          const t = tally.byTeam[code];
          const c = t.stage;
          const cumChampion = c.champion;
          const cumFinal    = c.final + cumChampion;
          const cumSF       = c.sf + cumFinal;
          const cumQF       = c.qf + cumSF;
          const cumR16      = c.r16 + cumQF;
          const cumR32      = c.r32 + cumR16;
          stats.byTeam[code] = {
            pAdvanceGroup: cumR32 / N, pR16: cumR16 / N, pQF: cumQF / N,
            pSF: cumSF / N, pFinal: cumFinal / N, pChampion: cumChampion / N,
            pGroupPos: { 1: t.groupPos[1]/N, 2: t.groupPos[2]/N, 3: t.groupPos[3]/N, 4: t.groupPos[4]/N },
            avgFinalElo: t.finalElo / N,
            avgGroupPts: t.groupPts / N, avgGroupGF: t.groupGF / N, avgGroupGA: t.groupGA / N,
          };
        }
        onResult(stats);
      }
    }
    chunk();
  }

  function onProgress(done, total) {
    const pct = total ? (done / total * 100) : 0;
    document.getElementById("progress-bar").style.width = pct + "%";
    document.getElementById("progress-text").textContent = `${done.toLocaleString()} / ${total.toLocaleString()}`;
  }

  function onResult(stats) {
    if (App.pendingMode === "scenario") {
      App.scenarioStats = stats;
    } else {
      App.stats = stats;
    }
    App.pendingMode = null;

    const btn = document.getElementById("run-sim");
    btn.disabled = false;
    btn.textContent = "Re-simular";

    const manualBtn = document.getElementById("manual-run");
    if (manualBtn) {
      manualBtn.disabled = Object.keys(App.overrides).length === 0;
      manualBtn.textContent = "Aplicar cenário e simular";
    }

    setTimeout(() => document.getElementById("progress-wrap").classList.remove("active"), 1500);
    renderActiveTab();
  }

  function scenarioActive() {
    return !!(App.scenarioStats && Object.keys(App.overrides).length > 0);
  }

  function activeStats() {
    return scenarioActive() ? App.scenarioStats : App.stats;
  }

  // Estado "efetivo" para renderização: quando há cenário ativo, os jogos
  // manualmente fixados aparecem como played (com flag .manual) — assim as
  // tabelas de grupo e o histórico do time refletem o cenário.
  function viewState() {
    if (!scenarioActive()) return App.state;
    const overrides = App.overrides;
    const matches = App.state.matches.map(m => {
      if (m.played || !overrides[m.id]) return m;
      const ov = overrides[m.id];
      return { ...m, played: true, score_home: ov.score_home, score_away: ov.score_away, manual: true };
    });
    return { ...App.state, matches };
  }

  function updateScenarioBanner() {
    const banner = document.getElementById("scenario-banner");
    if (!banner) return;
    if (scenarioActive()) {
      const n = Object.keys(App.overrides).length;
      banner.innerHTML = `
        <span class="banner-label">Modo cenário</span>
        <span class="banner-text">
          ${n} jogo${n > 1 ? "s" : ""} fixado${n > 1 ? "s" : ""} —
          todas as abas mostram o cenário hipotético.
        </span>
        <button id="banner-back">Voltar ao baseline</button>
      `;
      banner.hidden = false;
      document.getElementById("banner-back").addEventListener("click", () => {
        App.overrides = {};
        App.scenarioStats = null;
        renderActiveTab();
      });
    } else {
      banner.hidden = true;
      banner.innerHTML = "";
    }
  }

  function renderActiveTab() {
    const containers = {
      overview: document.getElementById("tab-overview"),
      groups: document.getElementById("tab-groups"),
      bracket: document.getElementById("tab-bracket"),
      team: document.getElementById("tab-team"),
      manual: document.getElementById("tab-manual"),
    };
    updateScenarioBanner();

    if (App.activeTab === "manual") {
      ManualUI.render(App, containers.manual, {
        onApply: () => runSimulation({ mode: "scenario" }),
        onClear: () => {
          App.overrides = {};
          App.scenarioStats = null;
          renderActiveTab();
        },
      });
      return;
    }
    const renderer = {
      overview: OverviewUI,
      groups: GroupsUI,
      bracket: BracketUI,
      team: TeamUI,
    }[App.activeTab];
    if (renderer && containers[App.activeTab]) {
      renderer.render(viewState(), activeStats(), containers[App.activeTab]);
    }
  }

  // Exporta App pra debug
  window.App = App;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
