// worker.js — Web Worker que roda o Monte Carlo em thread separada.
// Recebe { type: "run", N, state, seed } e devolve progresso + resultado.

importScripts("tournament.js?v=10", "model.js?v=10", "elo.js?v=10", "simulator.js?v=10");

self.onmessage = function (e) {
  const msg = e.data;
  if (msg.type === "run") {
    const rng = Simulator.mulberry32(msg.seed || 42);
    const stats = Simulator.run(msg.state, msg.N, rng, function (done, total) {
      self.postMessage({ type: "progress", done, total });
    }, msg.overrides);
    self.postMessage({ type: "result", stats });
  }
};
