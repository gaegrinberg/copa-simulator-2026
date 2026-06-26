// Aba "Por seleção": detalhe de um time específico — Elo, próximos jogos, probabilidades.

(function (global) {
  const TeamUI = {};

  let selectedCode = null;

  function pct(x) { return (x * 100).toFixed(1) + "%"; }

  TeamUI.render = function (state, stats, container) {
    // Inicializa seleção se vazia
    if (!selectedCode) selectedCode = state.teams[0].code;

    const teams = state.teams.slice().sort((a, b) => a.name_pt.localeCompare(b.name_pt));
    const opts = teams.map(t => `<option value="${t.code}" ${t.code===selectedCode?'selected':''}>${t.name_pt} (${t.code})</option>`).join("");

    container.innerHTML = `
      <div class="team-picker">
        <label>Selecione: <select id="team-select">${opts}</select></label>
      </div>
      <div id="team-detail"></div>
    `;

    const sel = container.querySelector("#team-select");
    sel.addEventListener("change", (e) => {
      selectedCode = e.target.value;
      renderDetail(state, stats, container.querySelector("#team-detail"));
    });

    renderDetail(state, stats, container.querySelector("#team-detail"));
  };

  function renderDetail(state, stats, host) {
    const t = state.teamByCode[selectedCode];
    if (!t) { host.innerHTML = ''; return; }

    const teamStats = stats ? stats.byTeam[t.code] : null;

    const futureMatches = state.matches.filter(m => !m.played && m.stage === "group" && (m.home === t.code || m.away === t.code));
    const playedMatches = state.matches.filter(m => m.played && m.stage === "group" && (m.home === t.code || m.away === t.code));

    host.innerHTML = `
      <div class="team-detail-grid">
        <div class="team-info-card">
          <h3>${Flags.html(t.code, {size: 18, cls: 'lg'})}${t.name_pt}</h3>
          <dl>
            <dt>Código</dt><dd>${t.code}</dd>
            <dt>Confederação</dt><dd>${t.confederation}</dd>
            <dt>Grupo</dt><dd>${t.group} (Pote ${t.pot})</dd>
            <dt>Elo inicial</dt><dd>${t.elo_initial}</dd>
            ${teamStats ? `<dt>Elo final médio</dt><dd>${teamStats.avgFinalElo.toFixed(0)}</dd>` : ''}
          </dl>

          <h3 style="margin-top: 16px;">Fase de grupos</h3>
          ${renderMatchList([...playedMatches, ...futureMatches], state, t.code)}
        </div>

        <div class="team-path-card">
          <h3>Caminho até a final</h3>
          ${teamStats ? renderPath(teamStats) : '<div class="muted">Rode a simulação primeiro.</div>'}

          ${teamStats ? `
            <h3 style="margin-top: 16px;">Posição final no grupo</h3>
            ${renderGroupPos(teamStats.pGroupPos)}
          ` : ''}
        </div>
      </div>
    `;
  }

  function renderMatchList(matches, state, teamCode) {
    if (matches.length === 0) return '<div class="muted" style="font-size:12px;">Sem jogos.</div>';
    return `
      <table>
        <thead><tr><th>Data</th><th>Adversário</th><th>Resultado</th></tr></thead>
        <tbody>
          ${matches.sort((a,b) => a.date.localeCompare(b.date)).map(m => {
            const isHome = m.home === teamCode;
            const opp = isHome ? state.nameByCode[m.away] : state.nameByCode[m.home];
            let result = "—";
            if (m.played) {
              const my = isHome ? m.score_home : m.score_away;
              const oth = isHome ? m.score_away : m.score_home;
              const r = my > oth ? '✓' : (my < oth ? '✗' : '=');
              const tag = m.manual ? ' <span class="manual-tag" title="placar do cenário hipotético">cenário</span>' : '';
              result = `<span style="color:${my>oth?'var(--accent)':my<oth?'var(--danger)':'var(--warn)'}">${my}-${oth} ${r}</span>${tag}`;
            } else {
              result = '<span class="muted">a jogar</span>';
            }
            const oppCode = isHome ? m.away : m.home;
            return `<tr><td class="muted" style="font-size:11px;">${m.date}</td><td>${isHome ? '' : '@ '}${Flags.html(oppCode)}${opp}</td><td>${result}</td></tr>`;
          }).join("")}
        </tbody>
      </table>
    `;
  }

  function renderPath(s) {
    const stages = [
      ["Avançar da fase de grupos", s.pAdvanceGroup],
      ["Chegar às oitavas (R16)", s.pR16],
      ["Chegar às quartas", s.pQF],
      ["Chegar às semis", s.pSF],
      ["Chegar à final", s.pFinal],
      ["Ser campeão", s.pChampion],
    ];
    return stages.map(([label, p]) => `
      <div class="path-row">
        <span class="label">${label}</span>
        <span class="bar"><span class="fill" style="width:${(p*100).toFixed(1)}%"></span></span>
        <span class="val">${pct(p)}</span>
      </div>
    `).join("");
  }

  function renderGroupPos(probs) {
    return [1,2,3,4].map(pos => `
      <div class="path-row">
        <span class="label">${pos}º lugar</span>
        <span class="bar"><span class="fill" style="width:${(probs[pos]*100).toFixed(1)}%"></span></span>
        <span class="val">${pct(probs[pos])}</span>
      </div>
    `).join("");
  }

  global.TeamUI = TeamUI;
})(window);
