"use strict";

const { generateNodeId } = require("./index");
const { Capability, ComputeType } = require("./task");

/**
 * Node identity, capabilities, and telemetry for Project NEXUS.
 */

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
    timestamp = Date.now() / 1000,
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
}

class NodeRecord {
  constructor({
    nodeId,
    multiaddrs = [],
    capabilities = [],
    reputation = 1.0,
    geoRegion = "unknown",
    bandwidthMbps = 100,
    lastSeen = Date.now() / 1000,
    priceCreditsPerCycle = 1.0,
  } = {}) {
    this.nodeId = nodeId;
    this.multiaddrs = multiaddrs;
    this.capabilities = capabilities;
    this.reputation = reputation;
    this.geoRegion = geoRegion;
    this.bandwidthMbps = bandwidthMbps;
    this.lastSeen = lastSeen;
    this.priceCreditsPerCycle = priceCreditsPerCycle;
  }

  toDict() {
    return {
      nodeId: this.nodeId,
      multiaddrs: this.multiaddrs,
      capabilities: this.capabilities.map((c) => ({
        type: c.type,
        version: c.version,
        count: c.count,
        details: c.details,
      })),
      reputation: this.reputation,
      geoRegion: this.geoRegion,
      bandwidthMbps: this.bandwidthMbps,
      lastSeen: this.lastSeen,
      priceCreditsPerCycle: this.priceCreditsPerCycle,
    };
  }

  static fromDict(d) {
    const caps = (d.capabilities || []).map(
      (c) => new Capability({ type: c.type, version: c.version, count: c.count, details: c.details })
    );
    return new NodeRecord({
      nodeId: d.nodeId,
      multiaddrs: d.multiaddrs || [],
      capabilities: caps,
      reputation: d.reputation,
      geoRegion: d.geoRegion,
      bandwidthMbps: d.bandwidthMbps,
      lastSeen: d.lastSeen,
      priceCreditsPerCycle: d.priceCreditsPerCycle,
    });
  }

  hasCapability(capType, count = 1) {
    return this.capabilities.some((c) => c.type === capType && c.count >= count);
  }
}

module.exports = { Telemetry, NodeRecord, generateNodeId };
