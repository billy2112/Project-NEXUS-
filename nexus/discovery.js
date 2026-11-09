"use strict";

const { NodeRecord } = require("./node");
const { ComputeType } = require("./task");

/**
 * Kademlia-inspired discovery and registration for Project NEXUS nodes.
 *
 * Skeleton keeps an in-memory routing table and record store so the
 * heartbeat + task-distribution demo runs standalone. Production would back
 * this with libp2p Kademlia DHT + GossipSub.
 */

const HEARTBEAT_TTL_S = 60;

class PeerInfo {
  constructor({ nodeId, multiaddrs = [], lastSeen = Date.now() / 1000 } = {}) {
    this.nodeId = nodeId;
    this.multiaddrs = multiaddrs;
    this.lastSeen = lastSeen;
  }
}

class Discovery {
  constructor({ nodeId } = {}) {
    this.nodeId = nodeId || require("./index").generateNodeId();
    this.records = {}; // nodeId -> NodeRecord
    this.capIndex = {}; // capType -> Set of nodeIds
    this.kBuckets = {}; // prefix -> PeerInfo[]
    this.bootstrapPeers = [];
    this._seq = 0;
  }

  register(record) {
    this.records[record.nodeId] = record;
    this._reindexCapabilities();
    this._touchRouting(record.nodeId, record.multiaddrs);
  }

  lookupByCapability({ capType, minCount = 1, minReputation = 0 } = {}) {
    const candidates = [];
    const ids = this.capIndex[capType] || new Set();
    for (const nodeId of ids) {
      const rec = this.records[nodeId];
      if (!rec) continue;
      if (!rec.hasCapability(capType, minCount)) continue;
      if (rec.reputation < minReputation) continue;
      if (Date.now() / 1000 - rec.lastSeen > HEARTBEAT_TTL_S) continue;
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

  ingestHeartbeat(nodeId, multiaddrs) {
    let rec = this.records[nodeId];
    if (!rec) {
      rec = new NodeRecord({ nodeId, multiaddrs, capabilities: [] });
    }
    rec.lastSeen = Date.now() / 1000;
    rec.multiaddrs = multiaddrs;
    this.records[nodeId] = rec;
    this._touchRouting(nodeId, multiaddrs);
  }

  staleNodes() {
    const now = Date.now() / 1000;
    return Object.entries(this.records)
      .filter(([, rec]) => now - rec.lastSeen > HEARTBEAT_TTL_S)
      .map(([nodeId]) => nodeId);
  }

  nextSeq() {
    this._seq += 1;
    return this._seq;
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
    if (bucket.length > 20) bucket.pop();
    this.kBuckets[prefix] = bucket;
  }

  _bucketPrefix(nodeId) {
    const crypto = require("crypto");
    return crypto.createHash("sha256").update(nodeId).digest("hex").slice(0, 2);
  }
}

module.exports = { Discovery, HEARTBEAT_TTL_S };
