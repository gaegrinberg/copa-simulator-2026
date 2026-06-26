// elo.js
// Atualização de Elo jogo a jogo segundo a fórmula do eloratings.net.
//
//   R' = R + K · G · (W − We)
//
//   K = peso da partida (60 para Copa do Mundo)
//   G = fator de saldo de gols
//        |GD|=1            → 1
//        |GD|=2            → 1.5
//        |GD|≥3            → (11 + |GD|) / 8
//   W = resultado (1 = vitória, 0.5 = empate, 0 = derrota)
//   We = probabilidade esperada de vitória dada por
//        We = 1 / (1 + 10^(-(R − R_oponente) / 400))
//
// Em mata-mata, prorrogação e pênaltis contam como W = 0.5 para Elo (padrão
// eloratings.net). O saldo de gols usado em G é o do tempo regulamentar + ET,
// sem incluir pênaltis.
//
// Aplicado dentro de cada simulação Monte Carlo: o Elo do time muta entre os
// jogos simulados; jogos com played:true NÃO geram update (os Elos iniciais
// já refletem essas variações via snapshot do eloratings.net de 25/06/2026).

(function (global) {
  const Elo = {};

  Elo.K_WORLD_CUP = 60;

  Elo.expectedScore = function (eloA, eloB) {
    return 1 / (1 + Math.pow(10, -(eloA - eloB) / 400));
  };

  Elo.goalDifferenceFactor = function (gd) {
    const ad = Math.abs(gd);
    if (ad <= 1) return 1;
    if (ad === 2) return 1.5;
    return (11 + ad) / 8;
  };

  // Atualiza os Elos dos dois times após uma partida.
  // result: { scoreHome, scoreAway, etHome, etAway, decided }
  //   decided ∈ {"ft", "et", "pens"}
  // Devolve { newHome, newAway, deltaHome, deltaAway }.
  Elo.applyMatch = function (eloHome, eloAway, result, opts) {
    opts = opts || {};
    const K = opts.k != null ? opts.k : Elo.K_WORLD_CUP;

    // Resultado consolidado em 90' + ET (sem pênaltis para Elo)
    const totalH = result.scoreHome + (result.etHome || 0);
    const totalA = result.scoreAway + (result.etAway || 0);

    let wHome;
    if (result.decided === "pens") {
      // Empate em 90+ET — pênaltis decidem o avanço mas Elo trata como empate.
      wHome = 0.5;
    } else if (totalH > totalA) {
      wHome = 1;
    } else if (totalH < totalA) {
      wHome = 0;
    } else {
      wHome = 0.5;
    }
    const wAway = 1 - wHome;

    const weHome = Elo.expectedScore(eloHome, eloAway);
    const weAway = 1 - weHome;

    const gd = totalH - totalA;
    const g = Elo.goalDifferenceFactor(gd);

    const deltaHome = K * g * (wHome - weHome);
    const deltaAway = K * g * (wAway - weAway);

    return {
      newHome: eloHome + deltaHome,
      newAway: eloAway + deltaAway,
      deltaHome,
      deltaAway,
      g,
      weHome,
      wHome,
    };
  };

  global.Elo = Elo;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
