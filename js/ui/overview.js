// Aba "Visão geral": tabela das 48 seleções ordenada por P(título), com prob de cada estágio.

(function (global) {
  const OverviewUI = {};

  function pct(x) { return (x * 100).toFixed(1) + "%"; }
  function pctSmall(x) { return (x * 100).toFixed(2) + "%"; }

  function pbar(p, big) {
    return `<div class="pbar"><div class="pbar-fill" style="width:${Math.max(2, p*100).toFixed(1)}%"></div><span class="pbar-text">${big ? pctSmall(p) : pct(p)}</span></div>`;
  }

  OverviewUI.render = function (state, stats, container) {
    if (!stats) {
      container.innerHTML = `<div class="empty-state">Rode a simulação pra preencher as probabilidades.</div>`;
      return;
    }
    const rows = state.teams.map(t => ({
      ...t,
      ...stats.byTeam[t.code],
    }));
    rows.sort((a, b) => b.pChampion - a.pChampion);

    const html = `
      <div class="overview-header">
        <h2>Probabilidades agregadas — ${stats.N.toLocaleString()} simulações</h2>
        <span class="muted">Ordenado por P(título). Clique no time pra ver detalhe.</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Seleção</th>
            <th class="num">Elo inicial</th>
            <th class="num">Elo final médio</th>
            <th>Conf.</th>
            <th>G</th>
            <th>Avançar</th>
            <th>Oitavas</th>
            <th>Quartas</th>
            <th>Semis</th>
            <th>Final</th>
            <th>Título</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr data-team="${r.code}" style="cursor:pointer">
              <td class="num muted">${i+1}</td>
              <td>${Flags.html(r.code)}<strong>${r.name_pt}</strong></td>
              <td class="num">${r.elo_initial}</td>
              <td class="num">${r.avgFinalElo.toFixed(0)}</td>
              <td class="muted">${r.confederation}</td>
              <td class="muted">${r.group}</td>
              <td>${pbar(r.pAdvanceGroup)}</td>
              <td>${pbar(r.pR16)}</td>
              <td>${pbar(r.pQF)}</td>
              <td>${pbar(r.pSF)}</td>
              <td>${pbar(r.pFinal)}</td>
              <td>${pbar(r.pChampion, true)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
    container.innerHTML = html;

    // Click → ir pra aba "Por seleção" com aquele time
    container.querySelectorAll("tr[data-team]").forEach(tr => {
      tr.addEventListener("click", () => {
        const code = tr.dataset.team;
        // Switch tab
        document.querySelector('nav .tab[data-tab="team"]').click();
        // Selecionar time
        const sel = document.querySelector("#tab-team select");
        if (sel) { sel.value = code; sel.dispatchEvent(new Event("change")); }
      });
    });
  };

  global.OverviewUI = OverviewUI;
})(window);
