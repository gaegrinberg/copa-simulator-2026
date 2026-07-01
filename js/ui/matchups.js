// Aba "Confrontos": pra cada fase do mata-mata, mostra os confrontos mais
// prováveis de acontecer em cada jogo, segundo o Monte Carlo (contagem
// conjunta casa×fora em matchupCounts[id].pair).
//
// Jogos já realizados aparecem com o placar real (badge azul "Encerrado");
// jogos fixados no modo cenário aparecem com badge amarela "Cenário".
// Como a aba renderiza viewState() + activeStats(), ela reflete
// automaticamente as simulações manuais.

(function (global) {
  const MatchupsUI = {};

  const PHASES = [
    { stage: "r32",   label: "16 avos de final",     sub: "R32" },
    { stage: "r16",   label: "Oitavas de final",     sub: "R16" },
    { stage: "qf",    label: "Quartas de final",     sub: "QF" },
    { stage: "sf",    label: "Semifinais",           sub: "SF" },
    { stage: "third", label: "Disputa de 3º lugar",  sub: "" },
    { stage: "final", label: "Final",                sub: "" },
  ];

  function pct(p) {
    if (p >= 0.995) return "100%";
    return (p * 100).toFixed(1) + "%";
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const parts = iso.split("-");
    return parts.length === 3 ? `${parts[2]}/${parts[1]}` : iso;
  }

  function escapeHtml(s) {
    return String(s).replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  }

  function teamHtml(code, state, side) {
    const name = state.nameByCode[code] || code;
    if (side === "away") {
      return `<span class="mu-team away" title="${escapeHtml(name)}">${Flags.html(code)}<span class="mu-name">${escapeHtml(name)}</span></span>`;
    }
    return `<span class="mu-team home" title="${escapeHtml(name)}"><span class="mu-name">${escapeHtml(name)}</span>${Flags.html(code)}</span>`;
  }

  // Ordena os pares por probabilidade (contagem conjunta)
  function sortedPairs(mc, N) {
    if (!mc || !mc.pair) return [];
    const arr = Object.entries(mc.pair).map(([key, cnt]) => {
      const [home, away] = key.split("|");
      return { home, away, p: cnt / N };
    });
    arr.sort((a, b) => b.p - a.p);
    return arr;
  }

  function topWinner(mc, N) {
    if (!mc || !mc.winner) return null;
    let best = null;
    for (const code in mc.winner) {
      const p = mc.winner[code] / N;
      if (!best || p > best.p) best = { code, p };
    }
    return best;
  }

  MatchupsUI.render = function (state, stats, container) {
    if (!stats) {
      container.innerHTML = `<div class="empty-state">Rode a simulação pra ver os confrontos mais prováveis de cada fase.</div>`;
      return;
    }
    if (!stats.matchupCounts) {
      container.innerHTML = `<div class="empty-state">Estatísticas antigas — clique em "Re-simular" pra gerar os confrontos.</div>`;
      return;
    }

    const koMatches = state.matches.filter(m => m.stage !== "group");
    const byStage = {};
    for (const m of koMatches) {
      if (!byStage[m.stage]) byStage[m.stage] = [];
      byStage[m.stage].push(m);
    }
    for (const s in byStage) byStage[s].sort((a, b) => a.id.localeCompare(b.id));

    const sections = PHASES
      .filter(ph => byStage[ph.stage] && byStage[ph.stage].length)
      .map(ph => renderPhase(ph, byStage[ph.stage], state, stats))
      .join("");

    container.innerHTML = `
      <div class="mu-header">
        <h2>Confrontos mais prováveis por fase</h2>
        <p class="muted">
          Pra cada jogo do mata-mata, os confrontos com maior chance de acontecer nas
          ${stats.N.toLocaleString()} simulações. Jogos <span class="mu-badge real">encerrados</span>
          mostram o placar real; jogos <span class="mu-badge manual">cenário</span> foram fixados
          na aba Simulação manual e valem 100%.
        </p>
      </div>
      ${sections}
    `;
  };

  function renderPhase(ph, matches, state, stats) {
    const decided = matches.filter(m => m.played).length;
    const statTxt = matches.length > 1 ? `${decided}/${matches.length} definidos` : (decided ? "definido" : "a definir");
    return `
      <section class="mu-phase">
        <h3>
          ${ph.label}
          ${ph.sub ? `<span class="mu-phase-sub">${ph.sub}</span>` : ""}
          <span class="mu-phase-stat">${statTxt}</span>
        </h3>
        <div class="mu-grid">
          ${matches.map(m => renderCard(m, state, stats)).join("")}
        </div>
      </section>
    `;
  }

  function renderCard(m, state, stats) {
    const mc = stats.matchupCounts[m.id];
    const pairs = sortedPairs(mc, stats.N);

    if (m.played) return renderPlayedCard(m, state, stats, pairs, mc);

    const win = topWinner(mc, stats.N);
    const TOP = 3;
    const top = pairs.slice(0, TOP);
    const rest = pairs.slice(TOP);
    const restP = rest.reduce((s, x) => s + x.p, 0);

    const rows = top.map((pr, i) => `
      <div class="mu-pair${i === 0 ? " top" : ""}">
        <div class="mu-pair-fill" style="width:${Math.max(1.5, pr.p * 100).toFixed(1)}%"></div>
        <div class="mu-pair-inner">
          ${teamHtml(pr.home, state, "home")}
          <span class="mu-x">×</span>
          ${teamHtml(pr.away, state, "away")}
          <span class="mu-p">${pct(pr.p)}</span>
        </div>
      </div>
    `).join("");

    return `
      <div class="mu-card">
        <div class="mu-head">
          <span class="mu-id">${m.id}</span>
          <span class="mu-date">${fmtDate(m.date)}</span>
        </div>
        <div class="mu-pairs">
          ${rows || `<div class="muted" style="padding:6px 0">Sem dados — re-simule.</div>`}
          ${rest.length ? `<div class="mu-rest">+ ${rest.length} outros confrontos (${pct(restP)})</div>` : ""}
        </div>
        ${win ? `
          <div class="mu-foot">
            Vencedor mais provável:
            ${Flags.html(win.code, { size: 12 })}<b>${escapeHtml(state.nameByCode[win.code] || win.code)}</b>
            <span class="mu-p">${pct(win.p)}</span>
          </div>` : ""}
      </div>
    `;
  }

  function renderPlayedCard(m, state, stats, pairs, mc) {
    // Confronto de jogo played é determinístico nas sims → par com p≈1.
    const pr = pairs[0];
    const isManual = !!m.manual;
    const badge = isManual
      ? `<span class="mu-badge manual">Cenário</span>`
      : `<span class="mu-badge real">Encerrado</span>`;

    if (!pr) {
      return `
        <div class="mu-card played">
          <div class="mu-head"><span class="mu-id">${m.id}</span><span class="mu-date">${fmtDate(m.date)}</span>${badge}</div>
          <div class="muted" style="padding:6px 0">Re-simule pra atualizar este jogo.</div>
        </div>
      `;
    }

    const sh = m.score_home, sa = m.score_away;
    const draw = sh === sa;
    const win = topWinner(mc, stats.N);
    let footer = "";
    if (draw && win) {
      footer = `<div class="mu-foot">${Flags.html(win.code, { size: 12 })}<b>${escapeHtml(state.nameByCode[win.code] || win.code)}</b> avança nos pênaltis</div>`;
    }

    return `
      <div class="mu-card played${isManual ? " manual" : ""}">
        <div class="mu-head">
          <span class="mu-id">${m.id}</span>
          <span class="mu-date">${fmtDate(m.date)}</span>
          ${badge}
        </div>
        <div class="mu-result">
          ${teamHtml(pr.home, state, "home")}
          <span class="mu-score">${sh}<i>×</i>${sa}</span>
          ${teamHtml(pr.away, state, "away")}
        </div>
        ${footer}
      </div>
    `;
  }

  global.MatchupsUI = MatchupsUI;
})(window);
