"use strict";

const { now } = require("./types");

/**
 * Reputation & credit system.
 *
 * Reputation = 0.40*uptime + 0.25*completion + 0.20*verification + 0.15*latency
 * Credits metered per computeCycle, gpuCycle, gbHour, mb bandwidth.
 */

class ReputationEngine {
  constructor() {
    this.scores = {}; // nodeId -> { uptime, completion, verification, latency, updatedAt }
    this.history = {}; // nodeId -> event[]
  }

  update(nodeId, event) {
    // event: { type: 'task_complete'|'task_fail'|'verify_pass'|'verify_fail'|'heartbeat', latencyMs?, ... }
    if (!this.scores[nodeId]) {
      this.scores[nodeId] = { uptime: 1, completion: 1, verification: 1, latency: 1, updatedAt: now() };
      this.history[nodeId] = [];
    }
    const s = this.scores[nodeId];
    s.updatedAt = now();
    this.history[nodeId].push({ ...event, at: now() });
    if (this.history[nodeId].length > 1000) this.history[nodeId].shift();

    switch (event.type) {
      case "task_complete": s.completion = Math.min(1, s.completion + 0.01); break;
      case "task_fail": s.completion = Math.max(0, s.completion - 0.05); break;
      case "verify_pass": s.verification = Math.min(1, s.verification + 0.02); break;
      case "verify_fail": s.verification = Math.max(0, s.verification - 0.1); s.latency = Math.max(0, s.latency - 0.1); break;
      case "heartbeat": s.uptime = Math.min(1, s.uptime + 0.001); break;
    }
    if (event.latencyMs !== undefined) {
      s.latency = event.latencyMs < 100 ? Math.min(1, s.latency + 0.01) : Math.max(0, s.latency - 0.02);
    }
    return this.compute(nodeId);
  }

  compute(nodeId) {
    const s = this.scores[nodeId];
    if (!s) return 0;
    return 0.40 * s.uptime + 0.25 * s.completion + 0.20 * s.verification + 0.15 * s.latency;
  }

  get(nodeId) {
    return this.scores[nodeId] || { uptime: 0, completion: 0, verification: 0, latency: 0, updatedAt: now() };
  }

  decay() {
    // daily decay applied on call (simulate per-day)
    const t = now();
    for (const [nodeId, s] of Object.entries(this.scores)) {
      const days = (t - s.updatedAt) / 86400;
      if (days < 1) continue;
      const factor = Math.pow(0.99, Math.floor(days));
      s.uptime *= factor;
      s.completion *= factor;
      s.verification *= factor;
      s.latency *= factor;
      s.updatedAt = t;
    }
  }
}

class CreditLedger {
  constructor() {
    this.balances = {}; // nodeId -> credits
    this.transactions = []; // { from, to, amount, type, jobId, taskId, timestamp }
    this.meteringRates = {
      computeCycle: 1,    // per CPU-second
      gpuCycle: 5,        // per GPU-second
      gbHour: 0.1,        // per GB-hour storage
      mb: 0.001,          // per MB bandwidth
    };
  }

  ensure(nodeId) {
    if (this.balances[nodeId] === undefined) this.balances[nodeId] = 0;
  }

  credit(nodeId, amount, type, ref) {
    this.ensure(nodeId);
    this.balances[nodeId] += amount;
    this._tx(null, nodeId, amount, type, ref);
    return this.balances[nodeId];
  }

  debit(nodeId, amount, type, ref) {
    this.ensure(nodeId);
    if (this.balances[nodeId] < amount) return false;
    this.balances[nodeId] -= amount;
    this._tx(nodeId, null, amount, type, ref);
    return true;
  }

  transfer(from, to, amount, type, ref) {
    if (!this.debit(from, amount, type, ref)) return false;
    this.credit(to, amount, type, ref);
    return true;
  }

  _tx(from, to, amount, type, ref) {
    this.transactions.push({ from, to, amount, type, ref, timestamp: now() });
    if (this.transactions.length > 10000) this.transactions.shift();
  }

  balance(nodeId) {
    this.ensure(nodeId);
    return this.balances[nodeId];
  }

  getMeteredCost({ cpuSeconds = 0, gpuSeconds = 0, gbHours = 0, mb = 0 } = {}) {
    return (
      cpuSeconds * this.meteringRates.computeCycle +
      gpuSeconds * this.meteringRates.gpuCycle +
      gbHours * this.meteringRates.gbHour +
      mb * this.meteringRates.mb
    );
  }

  stats() {
    return {
      totalSupply: Object.values(this.balances).reduce((a, b) => a + b, 0),
      accountCount: Object.keys(this.balances).length,
      transactionCount: this.transactions.length,
      rates: this.meteringRates,
    };
  }
}

module.exports = { ReputationEngine, CreditLedger };
