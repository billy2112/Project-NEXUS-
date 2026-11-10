"use strict";

const { sha256, now, ComputeType, NodeMode } = require("./types");
const { NodeRecord, Capability } = require("./node");

/**
 * Kademlia-inspired discovery and registration.
 *
 * Features:
 *  - DHT record store (node_id -> NodeRecord)
 *  - Capability index (cap_type -> set of node_ids)
 *  - k-bucket routing table with client/server mode distinction
 *  - NAT traversal status tracking
 *  - Heartbeat TTL and stale-node detection
 *  - Sybil resistance via hardware fingerprint + stake
 */

const HEARTBEAT_TTL_S = 60;
const K_BUCKET_SIZE = 20;

class PeerInfo {
  constructor({ nodeId, multiaddrs = [], lastSeen = now() } = {}) {
    this.nodeId = nodeId;
    this.multiaddrs = multiaddrs;
    this.lastSeen = lastSeen;
  }
}

class Discovery {
  constructor({ nodeId, mode = NodeMode.CLIENT, bootstrapPeers = [] } = {}) {
    this.nodeId = nodeId || `node:${require("crypto").randomBytes(16).toString("hex")}`;
    this.mode = mode;
    this.records = {};
    this.capIndex = {};
    this.kBuckets = {};
    this.bootstrapPeers = bootstrapPeers;
    this._seq = 0;
    this.gossipSubscribers = new Map(); // topic -> Set of callbacks
  }

  register(record) {
    // Sybil resistance: reject records with missing hardware fingerprint unless staked
    if (!record.hardwareFingerprint && record.stakeCredits < 10) {
      throw new Error("Sybil check failed: hardware fingerprint or stake required");
    }
    this.records[record.nodeId] = record;
    this._reindexCapabilities();
    this._touchRouting(record.nodeId, record.multiaddrs);
  }

  lookupByCapability({ capType, minCount = 1, minReputation = 0, mode = null } = {}) {
    const candidates = [];
    const ids = this.capIndex[capType] || new Set();
    for (const nodeId of ids) {
      const rec = this.records[nodeId];
      if (!rec) continue;
      if (!rec.hasCapability(capType, minCount)) continue;
      if (rec.reputation < minReputation) continue;
      if (now() - rec.lastSeen > HEARTBEAT_TTL_S) continue;
      if (mode && rec.mode !== mode) continue;
      candidates.push(rec);
    }
    candidates.sort((a, b) => b.reputation - a.reputation || a.priceCreditsPerCycle - b.priceCreditsPerCycle);
    return candidates;
  }

  getRecord(nodeId) {
    return this.records[nodeId] || null;
  }

  allRecords() {
    return Object.values(this.records);
  }

  ingestHeartbeat(nodeId, multiaddrs, telemetryOverride) {
    let rec = this.records[nodeId];
    if (!rec) {
      rec = new NodeRecord({ nodeId, multiaddrs, capabilities: [] });
    }
    rec.lastSeen = now();
    rec.multiaddrs = multiaddrs;
    if (telemetryOverride && telemetryOverride.natStatus) rec.natStatus = telemetryOverride.natStatus;
    this.records[nodeId] = rec;
    this._touchRouting(nodeId, multiaddrs);
    return rec;
  }

  staleNodes() {
    const t = now();
    return Object.entries(this.records)
      .filter(([, rec]) => t - rec.lastSeen > HEARTBEAT_TTL_S)
      .map(([nodeId]) => nodeId);
  }

  nextSeq() {
    this._seq += 1;
    return this._seq;
  }

  // GossipSub-style pub/sub
  subscribe(topic, cb) {
    if (!this.gossipSubscribers.has(topic)) this.gossipSubscribers.set(topic, new Set());
    this.gossipSubscribers.get(topic).add(cb);
    return () => {
      const set = this.gossipSubscribers.get(topic);
      if (set) set.delete(cb);
    };
  }

  publish(topic, message) {
    const set = this.gossipSubscribers.get(topic);
    if (!set) return;
    for (const cb of set) {
      try { cb(message); } catch (e) { /* ignore subscriber errors */ }
    }
  }

  _reindexCapabilities() {
    this.capIndex = {};
    for (const rec of Object.values(this.records)) {
      for (const cap of rec.capabilities) {
        if (!this.capIndex[cap.type]) this.capIndex[cap.type] = new Set();
        this.capIndex[cap.type].add(rec.nodeId);
      }
    }
  }

  _touchRouting(nodeId, multiaddrs) {
    const prefix = this._bucketPrefix(nodeId);
    let bucket = this.kBuckets[prefix];
    if (!bucket) { bucket = []; this.kBuckets[prefix] = bucket; }
    bucket = bucket.filter((p) => p.nodeId !== nodeId);
    bucket.unshift(new PeerInfo({ nodeId, multiaddrs }));
    if (bucket.length > K_BUCKET_SIZE) bucket.pop();
    this.kBuckets[prefix] = bucket;
  }

  _bucketPrefix(nodeId) {
    return sha256(nodeId).slice(0, 2);
  }
}

module.exports = { Discovery, HEARTBEAT_TTL_S, PeerInfo };
