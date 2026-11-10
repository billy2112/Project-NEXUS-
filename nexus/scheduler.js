"use strict";

const { now, TaskState, ComputeType } = require("./types");
const { Discovery } = require("./discovery");

class SchedulingDecision {
  constructor({ microWorkloadId, nodeId, score, reason } = {}) {
    this.microWorkloadId = microWorkloadId;
    this.nodeId = nodeId;
    this.score = score;
    this.reason = reason;
    this.timestamp = now();
  }
}

class NodeScore {
  constructor({ record, telemetry, score, breakdown } = {}) {
    this.record = record;
    this.telemetry = telemetry;
    this.score = score;
    this.breakdown = breakdown;
    this.timestamp = now();
  }
}

class Scheduler {
  constructor(discovery) {
    this.discovery = discovery;
    this.telemetry = {};
    this.nodeTasks = {};
    this.decisions = [];
    this.jobDags = {}; // jobId -> { mwId -> deps[] }
  }

  static W_CAPABILITY = 0.30;
  static W_TELEMETRY = 0.20;
  static W_REPUTATION = 0.20;
  static W_GEO = 0.15;
  static W_LOAD = 0.10;
  static W_COST = 0.05;

  updateTelemetry(telemetry) {
    this.telemetry[telemetry.nodeId] = telemetry;
  }

  getTelemetry(nodeId) {
    return this.telemetry[nodeId] || null;
  }

  registerJobDag(jobId, microWorkloads) {
    const deps = {};
    for (const mw of microWorkloads) {
      deps[mw.id] = (mw.dependsOn || []).slice();
    }
    this.jobDags[jobId] = deps;
  }

  getReadyTasks(jobId, completedMwIds) {
    const deps = this.jobDags[jobId];
    if (!deps) return [];
    const ready = [];
    for (const [mwId, depList] of Object.entries(deps)) {
      if (completedMwIds.has(mwId)) continue;
      if (depList.every((d) => completedMwIds.has(d))) ready.push(mwId);
    }
    return ready;
  }

  scoreNode(record, requirements, submitterRegion = "unknown") {
    const telemetry = this.getTelemetry(record.nodeId);
    if (!telemetry) return null;

    const capMatch = record.hasCapability(requirements.computeType) ? 1.0 : 0.0;
    const utilPenalty = Math.max(telemetry.cpuUtil, telemetry.gpuUtil) / 100.0;
    const telemetryScore = Math.max(0, 1 - utilPenalty);
    const reputationScore = Math.min(1, Math.max(0, record.reputation));
    const geoScore = record.geoRegion === submitterRegion ? 1.0 : 0.5;
    const loadScore = 1 - telemetry.loadFactor;
    const costScore = 1 / (1 + record.priceCreditsPerCycle);

    const score =
      Scheduler.W_CAPABILITY * capMatch +
      Scheduler.W_TELEMETRY * telemetryScore +
      Scheduler.W_REPUTATION * reputationScore +
      Scheduler.W_GEO * geoScore +
      Scheduler.W_LOAD * loadScore +
      Scheduler.W_COST * costScore;

    return new NodeScore({
      record,
      telemetry,
      score,
      breakdown: {
        capability: capMatch,
        telemetry: telemetryScore,
        reputation: reputationScore,
        geo: geoScore,
        load: loadScore,
        cost: costScore,
      },
    });
  }

  schedule(microWorkload, submitterRegion = "unknown", excludeNodes = []) {
    const candidates = this.discovery.lookupByCapability({
      capType: microWorkload.requirements.computeType,
      minCount: 1,
      minReputation: 0.3,
    }).filter((r) => !excludeNodes.includes(r.nodeId));

    if (!candidates.length) return null;

    const scored = [];
    for (const rec of candidates) {
      const ns = this.scoreNode(rec, microWorkload.requirements, submitterRegion);
      if (!ns) continue;
      if (ns.telemetry.loadFactor >= 1.0) continue;
      scored.push(ns);
    }
    if (!scored.length) return null;

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    const task = {
      id: `task:${microWorkload.id}`,
      microWorkloadId: microWorkload.id,
      nodeId: best.record.nodeId,
      state: TaskState.ASSIGNED,
      assignedAt: now(),
    };
    if (!this.nodeTasks[best.record.nodeId]) this.nodeTasks[best.record.nodeId] = [];
    this.nodeTasks[best.record.nodeId].push(task);

    const decision = new SchedulingDecision({
      microWorkloadId: microWorkload.id,
      nodeId: best.record.nodeId,
      score: best.score,
      reason: Object.entries(best.breakdown)
        .map(([k, v]) => `${k}=${v.toFixed(2)}`)
        .join(" "),
    });
    this.decisions.push(decision);
    return { decision, task };
  }

  reassignOnFailure(task, microWorkload, submitterRegion = "unknown") {
    task.state = TaskState.REASSIGNED;
    const candidates = this.discovery
      .lookupByCapability({
        capType: microWorkload.requirements.computeType,
        minCount: 1,
        minReputation: 0.3,
      })
      .filter((r) => r.nodeId !== task.nodeId);
    if (!candidates.length) return null;
    const bestRec = candidates[0];
    const ns = this.scoreNode(bestRec, microWorkload.requirements, submitterRegion);
    if (!ns) return null;
    const newTask = {
      id: `task:${microWorkload.id}:retry`,
      microWorkloadId: microWorkload.id,
      nodeId: bestRec.nodeId,
      state: TaskState.ASSIGNED,
      assignedAt: now(),
    };
    if (!this.nodeTasks[bestRec.nodeId]) this.nodeTasks[bestRec.nodeId] = [];
    this.nodeTasks[bestRec.nodeId].push(newTask);
    const decision = new SchedulingDecision({
      microWorkloadId: microWorkload.id,
      nodeId: bestRec.nodeId,
      score: ns.score,
      reason: "reassignment after node failure",
    });
    this.decisions.push(decision);
    return { decision, task: newTask };
  }

  getTasksForNode(nodeId) {
    return this.nodeTasks[nodeId] || [];
  }
}

module.exports = { Scheduler, SchedulingDecision, NodeScore };
