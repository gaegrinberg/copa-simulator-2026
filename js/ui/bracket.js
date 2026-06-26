// Aba "Mata-mata": bracket visual em formato árvore (SVG) ao estilo FMD/ESPN.
//
// Layout: lado esquerdo = top half (chega na SF M101), lado direito = bottom half
// (SF M102), Final + disputa de 3º no centro.
//
// Cada caixa mostra os 2 candidatos mais prováveis para aquele slot + vencedor
// mais provável. Linhas conectoras desenhadas em SVG.

(function (global) {
  const BracketUI = {};

  // Layout — ordem das R32 de cima pra baixo em cada lado, mantendo
  // o pareamento do bracket: dois R32 vizinhos se enfrentam no R16.
  // Top half (alimentam M101): M097 = M089+M090, M098 = M093+M094
  //   M090 = M073+M075, M089 = M074+M077, M094 = M081+M082, M093 = M083+M084
  const LEFT_R32 = ["M073", "M075", "M074", "M077", "M081", "M082", "M083", "M084"];
  const LEFT_R16 = ["M090", "M089", "M094", "M093"];
  const LEFT_QF  = ["M097", "M098"];
  const LEFT_SF  = ["M101"];
  // Bottom half (alimentam M102): M099 = M091+M092, M100 = M095+M096
  //   M091 = M076+M078, M092 = M079+M080, M096 = M085+M087, M095 = M086+M088
  const RIGHT_R32 = ["M076", "M078", "M079", "M080", "M085", "M087", "M086", "M088"];
  const RIGHT_R16 = ["M091", "M092", "M096", "M095"];
  const RIGHT_QF  = ["M099", "M100"];
  const RIGHT_SF  = ["M102"];
  const FINAL     = "M104";
  const THIRD     = "M103";

  // Dimensões
  const BOX_W = 140;
  const BOX_H = 56;
  const GAP_Y = 12;
  const COL_GAP = 28;
  const MARGIN = 16;

  // Posições x das colunas (esquerda + centro + direita)
  const COLS_LEFT = [MARGIN, MARGIN + (BOX_W + COL_GAP), MARGIN + 2*(BOX_W + COL_GAP), MARGIN + 3*(BOX_W + COL_GAP)];
  const CENTER_X  = MARGIN + 4*(BOX_W + COL_GAP);
  const COLS_RIGHT = [CENTER_X + (BOX_W + COL_GAP), CENTER_X + 2*(BOX_W + COL_GAP), CENTER_X + 3*(BOX_W + COL_GAP), CENTER_X + 4*(BOX_W + COL_GAP)];
  const TOTAL_W = COLS_RIGHT[3] + BOX_W + MARGIN;

  // Cálculo de y por posição na coluna
  function yForR32(idx) { return MARGIN + idx * (BOX_H + GAP_Y); }
  function yForRound(round, idx) {
    // round 0 = R32 (espaço 1 box), 1 = R16 (espaço 2), 2 = QF (espaço 4), 3 = SF (espaço 8)
    const spacing = (BOX_H + GAP_Y) * (1 << round);
    const startOffset = ((1 << round) - 1) * (BOX_H + GAP_Y) / 2;
    return MARGIN + startOffset + idx * spacing;
  }
  const TOTAL_H = yForR32(8); // 8 R32 boxes + algum espaço

  BracketUI.render = function (state, stats, container) {
    if (!stats) {
      container.innerHTML = `<div class="empty-state">Rode a simulação pra ver os confrontos prováveis.</div>`;
      return;
    }
    const mc = stats.matchupCounts || {};

    // Constrói SVG
    const boxes = [];
    const lines = [];

    // === LADO ESQUERDO ===
    LEFT_R32.forEach((id, i) => {
      boxes.push(box(COLS_LEFT[0], yForRound(0, i), id, mc[id], stats.N, state));
    });
    LEFT_R16.forEach((id, i) => {
      boxes.push(box(COLS_LEFT[1], yForRound(1, i), id, mc[id], stats.N, state));
      // Linhas dos 2 R32 que alimentam esta R16
      const r32IdxA = i * 2, r32IdxB = i * 2 + 1;
      lines.push(connector(COLS_LEFT[0] + BOX_W, yForRound(0, r32IdxA) + BOX_H/2, COLS_LEFT[1], yForRound(1, i) + BOX_H/2));
      lines.push(connector(COLS_LEFT[0] + BOX_W, yForRound(0, r32IdxB) + BOX_H/2, COLS_LEFT[1], yForRound(1, i) + BOX_H/2));
    });
    LEFT_QF.forEach((id, i) => {
      boxes.push(box(COLS_LEFT[2], yForRound(2, i), id, mc[id], stats.N, state));
      const r16IdxA = i * 2, r16IdxB = i * 2 + 1;
      lines.push(connector(COLS_LEFT[1] + BOX_W, yForRound(1, r16IdxA) + BOX_H/2, COLS_LEFT[2], yForRound(2, i) + BOX_H/2));
      lines.push(connector(COLS_LEFT[1] + BOX_W, yForRound(1, r16IdxB) + BOX_H/2, COLS_LEFT[2], yForRound(2, i) + BOX_H/2));
    });
    LEFT_SF.forEach((id, i) => {
      boxes.push(box(COLS_LEFT[3], yForRound(3, i), id, mc[id], stats.N, state, "Semi"));
      lines.push(connector(COLS_LEFT[2] + BOX_W, yForRound(2, 0) + BOX_H/2, COLS_LEFT[3], yForRound(3, 0) + BOX_H/2));
      lines.push(connector(COLS_LEFT[2] + BOX_W, yForRound(2, 1) + BOX_H/2, COLS_LEFT[3], yForRound(3, 0) + BOX_H/2));
    });

    // === LADO DIREITO ===
    RIGHT_R32.forEach((id, i) => {
      boxes.push(box(COLS_RIGHT[3], yForRound(0, i), id, mc[id], stats.N, state));
    });
    RIGHT_R16.forEach((id, i) => {
      boxes.push(box(COLS_RIGHT[2], yForRound(1, i), id, mc[id], stats.N, state));
      const r32IdxA = i * 2, r32IdxB = i * 2 + 1;
      lines.push(connector(COLS_RIGHT[3], yForRound(0, r32IdxA) + BOX_H/2, COLS_RIGHT[2] + BOX_W, yForRound(1, i) + BOX_H/2));
      lines.push(connector(COLS_RIGHT[3], yForRound(0, r32IdxB) + BOX_H/2, COLS_RIGHT[2] + BOX_W, yForRound(1, i) + BOX_H/2));
    });
    RIGHT_QF.forEach((id, i) => {
      boxes.push(box(COLS_RIGHT[1], yForRound(2, i), id, mc[id], stats.N, state));
      const r16IdxA = i * 2, r16IdxB = i * 2 + 1;
      lines.push(connector(COLS_RIGHT[2], yForRound(1, r16IdxA) + BOX_H/2, COLS_RIGHT[1] + BOX_W, yForRound(2, i) + BOX_H/2));
      lines.push(connector(COLS_RIGHT[2], yForRound(1, r16IdxB) + BOX_H/2, COLS_RIGHT[1] + BOX_W, yForRound(2, i) + BOX_H/2));
    });
    RIGHT_SF.forEach((id, i) => {
      boxes.push(box(COLS_RIGHT[0], yForRound(3, i), id, mc[id], stats.N, state, "Semi"));
      lines.push(connector(COLS_RIGHT[1], yForRound(2, 0) + BOX_H/2, COLS_RIGHT[0] + BOX_W, yForRound(3, 0) + BOX_H/2));
      lines.push(connector(COLS_RIGHT[1], yForRound(2, 1) + BOX_H/2, COLS_RIGHT[0] + BOX_W, yForRound(3, 0) + BOX_H/2));
    });

    // === CENTRO: Final + 3º lugar ===
    const finalY = yForRound(3, 0);
    boxes.push(box(CENTER_X, finalY, FINAL, mc[FINAL], stats.N, state, "Final"));
    boxes.push(box(CENTER_X, finalY + BOX_H + 30, THIRD, mc[THIRD], stats.N, state, "3º lugar"));
    // Linhas das SFs pra final
    lines.push(connector(COLS_LEFT[3] + BOX_W, yForRound(3, 0) + BOX_H/2, CENTER_X, finalY + BOX_H/2));
    lines.push(connector(COLS_RIGHT[0], yForRound(3, 0) + BOX_H/2, CENTER_X + BOX_W, finalY + BOX_H/2));

    // Labels das fases no topo
    const labels = [
      { x: COLS_LEFT[0] + BOX_W/2,  text: "R32" },
      { x: COLS_LEFT[1] + BOX_W/2,  text: "Oitavas" },
      { x: COLS_LEFT[2] + BOX_W/2,  text: "Quartas" },
      { x: COLS_LEFT[3] + BOX_W/2,  text: "Semis" },
      { x: CENTER_X + BOX_W/2,      text: "Final" },
      { x: COLS_RIGHT[0] + BOX_W/2, text: "Semis" },
      { x: COLS_RIGHT[1] + BOX_W/2, text: "Quartas" },
      { x: COLS_RIGHT[2] + BOX_W/2, text: "Oitavas" },
      { x: COLS_RIGHT[3] + BOX_W/2, text: "R32" },
    ];
    const labelsHtml = labels.map(l => `<text x="${l.x}" y="6" text-anchor="middle" class="phase-label">${l.text}</text>`).join("");

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -16 ${TOTAL_W} ${TOTAL_H + 60}" class="bracket-svg" preserveAspectRatio="xMidYMid meet">
        <style>
          .phase-label { fill: #8b949e; font-size: 11px; font-family: -apple-system, sans-serif; text-transform: uppercase; letter-spacing: 1px; }
          .bx-bg { fill: #161b22; stroke: #2d333b; stroke-width: 1; rx: 4; }
          .bx-label { fill: #8b949e; font-size: 9px; font-family: ui-monospace, monospace; }
          .bx-team { fill: #c9d1d9; font-size: 11.5px; font-family: -apple-system, sans-serif; }
          .bx-team.likely { fill: #3fb950; font-weight: 600; }
          .bx-prob { fill: #8b949e; font-size: 10px; font-family: ui-monospace, monospace; }
          .bx-line { stroke: #30363d; stroke-width: 1.2; fill: none; }
          .bx-special { fill: #1f2630; stroke: #d29922; stroke-width: 1.5; }
        </style>
        ${labelsHtml}
        ${lines.join("")}
        ${boxes.join("")}
      </svg>
    `;

    container.innerHTML = `
      <h2 style="margin: 0 0 6px; font-size: 16px;">Mata-mata — chaveamento projetado</h2>
      <p class="muted" style="margin-top:0; font-size: 12px;">Cada caixa mostra os 2 candidatos mais prováveis de chegar nela e a probabilidade individual. O vencedor mais provável fica em verde. Conexões: cada par de R32 alimenta uma oitavas, cada par de oitavas alimenta uma quartas, e assim por diante.</p>
      <div style="overflow-x: auto; padding: 8px 0;">${svg}</div>
    `;
  };

  function topTwo(distribution, N, nameByCode) {
    if (!distribution) return [];
    const arr = Object.entries(distribution).map(([code, count]) => ({ code, p: count / N, name: nameByCode[code] || code }));
    arr.sort((a, b) => b.p - a.p);
    return arr.slice(0, 2);
  }

  function escapeXml(s) {
    return String(s).replace(/[<>&"']/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;' }[c]));
  }

  function box(x, y, matchId, mc, N, state, labelOverride) {
    const homeTop = mc ? topTwo(mc.home, N, state.nameByCode) : [];
    const awayTop = mc ? topTwo(mc.away, N, state.nameByCode) : [];
    const winnerTop = mc ? topTwo(mc.winner, N, state.nameByCode) : [];
    const homeMost = homeTop[0];
    const awayMost = awayTop[0];
    const winMost = winnerTop[0];
    const label = labelOverride || matchId;
    const homeLikely = winMost && homeMost && winMost.code === homeMost.code;
    const awayLikely = winMost && awayMost && winMost.code === awayMost.code;
    const special = labelOverride && labelOverride !== "Semi";

    const homeFlag = homeMost && Flags.url(homeMost.code)
      ? `<image href="${Flags.url(homeMost.code)}" x="4" y="20" width="18" height="13" preserveAspectRatio="xMidYMid slice"/>`
      : '';
    const awayFlag = awayMost && Flags.url(awayMost.code)
      ? `<image href="${Flags.url(awayMost.code)}" x="4" y="40" width="18" height="13" preserveAspectRatio="xMidYMid slice"/>`
      : '';

    return `
      <g transform="translate(${x},${y})">
        <rect class="${special ? 'bx-special' : 'bx-bg'}" width="${BOX_W}" height="${BOX_H}" rx="4" />
        <text class="bx-label" x="4" y="11">${escapeXml(label)}</text>
        ${homeFlag}
        <text class="bx-team ${homeLikely ? 'likely' : ''}" x="26" y="31">${homeMost ? escapeXml(truncate(homeMost.name, 13)) : '—'}</text>
        <text class="bx-prob" text-anchor="end" x="${BOX_W - 4}" y="31">${homeMost ? Math.round(homeMost.p*100) + '%' : ''}</text>
        ${awayFlag}
        <text class="bx-team ${awayLikely ? 'likely' : ''}" x="26" y="51">${awayMost ? escapeXml(truncate(awayMost.name, 13)) : '—'}</text>
        <text class="bx-prob" text-anchor="end" x="${BOX_W - 4}" y="51">${awayMost ? Math.round(awayMost.p*100) + '%' : ''}</text>
      </g>
    `;
  }

  function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  // Linha conectora estilo bracket: horizontal → vertical → horizontal
  function connector(x1, y1, x2, y2) {
    const midX = (x1 + x2) / 2;
    return `<path class="bx-line" d="M${x1},${y1} L${midX},${y1} L${midX},${y2} L${x2},${y2}"/>`;
  }

  global.BracketUI = BracketUI;
})(window);
