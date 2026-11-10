"use strict";

const { sha256, now, ComputeType } = require("./types");

/**
 * Node identity, capabilities, telemetry, and reputation.
 */

class Capability {
  constructor({ type, version = "1.0", count = 1, details = {} } = {}) {
    this.type = type;
    this.version = version;
    this.count = count;
    this.details = details;
  }
  matches(other) {
    return this.type === other.type && this.count >= other.count;
  }
  toDict() {
    return { type: this.type, version: this.version, count: this.count, details: this.details };
  }
  static fromDict(d) {
    return new Capability({ type: d.type, version: d.version, count: d.count, details: d.details });
  }
}

class Telemetry {
  constructor({
    nodeId,
    seq = 0,
    cpuUtil = 0,
    gpuUtil = 0,
    gpuMemUsedMib = 0,
    memUsedMib = 0,
    memTotalMib = 0,
    netRxMbps = 0,
    netTxMbps = 0,
    latencyMs = 0,
    activeTasks = 0,
    maxConcurrentTasks = 4,
    uptimeS = 0,
    timestamp = now(),
  } = {}) {
    this.nodeId = nodeId;
    this.seq = seq;
    this.cpuUtil = cpuUtil;
    this.gpuUtil = gpuUtil;
    this.gpuMemUsedMib = gpuMemUsedMib;
    this.memUsedMib = memUsedMib;
    this.memTotalMib = memTotalMib;
    this.netRxMbps = netRxMbps;
    this.netTxMbps = netTxMbps;
    this.latencyMs = latencyMs;
    this.activeTasks = activeTasks;
    this.maxConcurrentTasks = maxConcurrentTasks;
    this.uptimeS = uptimeS;
    this.timestamp = timestamp;
  }
  get loadFactor() {
    if (this.maxConcurrentTasks <= 0) return 1.0;
    return Math.min(1.0, this.activeTasks / this.maxConcurrentTasks);
  }
  get isHealthy() {
    return this.cpuUtil < 95 && this.loadFactor < 1.0;
  }
  toDict() {
    return {
      nodeId: this.nodeId,
      seq: this.seq,
      cpuUtil: this.cpuUtil,
      gpuUtil: this.gpuUtil,
      gpuMemUsedMib: this.gpuMemUsedMib,
      memUsedMib: this.memUsedMib,
      memTotalMib: this.memTotalMib,
      netRxMbps: this.netRxMbps,
      netTxMbps: this.netTxMbps,
      latencyMs: this.latencyMs,
      activeTasks: this.activeTasks,
      maxConcurrentTasks: this.maxConcurrentTasks,
      uptimeS: this.uptimeS,
      loadFactor: this.loadFactor,
      isHealthy: this.isHealthy,
      timestamp: this.timestamp,
    };
  }
}

class NodeRecord {
  constructor({
    nodeId,
    multiaddrs = [],
    capabilities = [],
    reputation = 1.0,
    geoRegion = "unknown",
    bandwidthMbps = 100,
    lastSeen = now(),
    priceCreditsPerCycle = 1.0,
    stakeCredits = 0,
    mode = "client",
    natStatus = "unknown",
    sandboxTypes = ["wasm"],
    hardwareFingerprint = null,
  } = {}) {
    this.nodeId = nodeId;
    this.multiaddrs = multiaddrs;
    this.capabilities = capabilities;
    this.reputation = reputation;
    this.geoRegion = geoRegion;
    this.bandwidthMbps = bandwidthMbps;
    this.lastSeen = lastSeen;
    this.priceCreditsPerCycle = priceCreditsPerCycle;
    this.stakeCredits = stakeCredits;
    this.mode = mode;
    this.natStatus = natStatus;
    this.sandboxTypes = sandboxTypes;
    this.hardwareFingerprint = hardwareFingerprint || sha256(nodeId + now());
    this.joinTimestamp = lastSeen;
    this.totalTasksCompleted = 0;
    this.totalTasksFailed = 0;
    this.totalCreditsEarned = 0;
  }

  toDict() {
    return {
      nodeId: this.nodeId,
      multiaddrs: this.multiaddrs,
      capabilities: this.capabilities.map((c) => c.toDict()),
      reputation: this.reputation,
      geoRegion: this.geoRegion,
      bandwidthMbps: this.bandwidthMbps,
      lastSeen: this.lastSeen,
      priceCreditsPerCycle: this.priceCreditsPerCycle,
      stakeCredits: this.stakeCredits,
      mode: this.mode,
      natStatus: this.natStatus,
      sandboxTypes: this.sandboxTypes,
      hardwareFingerprint: this.hardwareFingerprint,
      joinTimestamp: this.joinTimestamp,
      totalTasksCompleted: this.totalTasksCompleted,
      totalTasksFailed: this.totalTasksFailed,
      totalCreditsEarned: this.totalCreditsEarned,
    };
  }
  static fromDict(d) {
    const rec = new NodeRecord({
      nodeId: d.nodeId,
      multiaddrs: d.multiaddrs || [],
      reputation: d.reputation,
      geoRegion: d.geoRegion,
      bandwidthMbps: d.bandwidthMbps,
      lastSeen: d.lastSeen,
      priceCreditsPerCycle: d.priceCreditsPerCycle,
      stakeCredits: d.stakeCredits,
      mode: d.mode,
      natStatus: d.natStatus,
      sandboxTypes: d.sandboxTypes,
      hardwareFingerprint: d.hardwareFingerprint,
      joinTimestamp: d.joinTimestamp,
      totalTasksCompleted: d.totalTasksCompleted,
      totalTasksFailed: d.totalTasksFailed,
      totalCreditsEarned: d.totalCreditsEarned,
    });
    rec.capabilities = (d.capabilities || []).map(Capability.fromDict);
    return rec;
  }

  hasCapability(capType, count = 1) {
    return this.capabilities.some((c) => c.type === capType && c.count >= count);
  }

  supportsSandbox(type) {
    return this.sandboxTypes.includes(type);
  }
}

function generateNodeId() {
  return `node:${crypto.randomBytes(16).toString("hex")}`;
}

module.exports = { Capability, Telemetry, NodeRecord, generateNodeId };
