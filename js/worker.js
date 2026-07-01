// worker.js — Web Worker que roda o Monte Carlo em thread separada.
// Recebe { type: "run", N, state, seed } e devolve progresso + resultado.

importScripts("tournament.js?v=19", "model.js?v=19", "elo.js?v=19", "simulator.js?v=19");

self.onmessage = function (e) {
  const msg = e.data;
  if (msg.type === "run") {
    const runId = msg.runId;
    const rng = Simulator.mulberry32(msg.seed || 42);
    const stats = Simulator.run(msg.state, msg.N, rng, function (done, total) {
      self.postMessage({ type: "progress", done, total, runId });
    }, msg.overrides);
    self.postMessage({ type: "result", stats, runId });
  }
};
