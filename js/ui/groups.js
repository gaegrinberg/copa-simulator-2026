// Aba "Fase de grupos": 12 cards (um por grupo) com tabela atual + barra de probabilidades por posição.

(function (global) {
  const GroupsUI = {};

  function pct(x) { return (x * 100).toFixed(1) + "%"; }

  function buildStandingsFromMatches(groupCode, teamCodes, matches) {
    // Stats por time considerando apenas jogos played:true
    const stats = {};
    for (const c of teamCodes) stats[c] = { team: c, played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, pts: 0 };
    for (const m of matches) {
      if (m.group !== groupCode || !m.played) continue;
      const h = stats[m.home], a = stats[m.away];
      h.played++; a.played++;
      h.gf += m.score_home; h.ga += m.score_away;
      a.gf += m.score_away; a.ga += m.score_home;
      if (m.score_home > m.score_away) { h.wins++; h.pts += 3; a.losses++; }
      else if (m.score_home < m.score_away) { a.wins++; a.pts += 3; h.losses++; }
      else { h.draws++; a.draws++; h.pts++; a.pts++; }
    }
    return Object.values(stats).map(s => ({...s, gd: s.gf - s.ga}))
      .sort((x, y) => {
        if (y.pts !== x.pts) return y.pts - x.pts;
        if (y.gd !== x.gd) return y.gd - x.gd;
        return y.gf - x.gf;
      });
  }

  GroupsUI.render = function (state, stats, container) {
    const byGroup = {};
    for (const t of state.teams) {
      if (!byGroup[t.group]) byGroup[t.group] = [];
      byGroup[t.group].push(t);
    }

    const html = `
      <h2 style="margin: 0 0 14px; font-size: 16px;">Fase de grupos</h2>
      <div class="groups-grid">
        ${"ABCDEFGHIJKL".split("").map(g => renderGroup(g, byGroup[g], state, stats)).join("")}
      </div>
    `;
    container.innerHTML = html;
  };

  function renderGroup(g, teams, state, stats) {
    const standings = buildStandingsFromMatches(g, teams.map(t => t.code), state.matches);
    const played = state.matches.filter(m => m.group === g && m.played).length;
    const total = state.matches.filter(m => m.group === g).length;

    return `
      <div class="group-card">
        <h3>Grupo ${g} <span class="stat">${played}/${total} jogos</span></h3>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Time</th>
              <th class="num">J</th>
              <th class="num">V</th>
              <th class="num">E</th>
              <th class="num">D</th>
              <th class="num">GP</th>
              <th class="num">GC</th>
              <th class="num">SG</th>
              <th class="num">Pts</th>
              ${stats ? '<th style="min-width:130px;">Posição final</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${standings.map((s, i) => {
              const t = state.teamByCode[s.team];
              const probs = stats ? stats.byTeam[s.team].pGroupPos : null;
              return `
                <tr>
                  <td class="muted">${i+1}º</td>
                  <td class="col-team">${Flags.html(t.code)}${t.name_pt}</td>
                  <td class="num">${s.played}</td>
                  <td class="num">${s.wins}</td>
                  <td class="num">${s.draws}</td>
                  <td class="num">${s.losses}</td>
                  <td class="num">${s.gf}</td>
                  <td class="num">${s.ga}</td>
                  <td class="num">${s.gd > 0 ? '+' : ''}${s.gd}</td>
                  <td class="num"><strong>${s.pts}</strong></td>
                  ${probs ? renderPosBar(probs) : ''}
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
        ${stats ? `
          <div class="pp-legend">
            <span><i class="pp-seg pp-1"></i>1º</span>
            <span><i class="pp-seg pp-2"></i>2º</span>
            <span><i class="pp-seg pp-3"></i>3º</span>
            <span><i class="pp-seg pp-4"></i>4º</span>
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderPosBar(probs) {
    const widths = [probs[1], probs[2], probs[3], probs[4]].map(p => (p * 100).toFixed(1));
    return `
      <td>
        <div class="pp" title="1º:${pct(probs[1])} · 2º:${pct(probs[2])} · 3º:${pct(probs[3])} · 4º:${pct(probs[4])}">
          ${widths.map((w, i) => `<div class="pp-seg pp-${i+1}" style="width:${w}%"></div>`).join("")}
        </div>
      </td>
    `;
  }

  global.GroupsUI = GroupsUI;
})(window);
