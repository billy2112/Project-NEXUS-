"use strict";

const { sha256, now } = require("./types");

/**
 * IPFS-style content-addressed storage stub.
 * Stores arbitrary blobs keyed by content hash (CID).
 */

class IpfsStore {
  constructor() {
    this.store = new Map(); // cid -> { data, size, pinCount, providers: Set }
    this.pins = new Set();
  }

  add(data) {
    const cid = `cid:${sha256(typeof data === "string" ? data : JSON.stringify(data))}`;
    const existing = this.store.get(cid);
    if (existing) {
      existing.size = Buffer.byteLength(JSON.stringify(data));
      return existing.cid;
    }
    const entry = { cid, data, size: Buffer.byteLength(JSON.stringify(data)), pinCount: 0, providers: new Set() };
    this.store.set(cid, entry);
    return cid;
  }

  get(cid) {
    const entry = this.store.get(cid);
    return entry ? entry.data : null;
  }

  pin(cid, providerId) {
    const entry = this.store.get(cid);
    if (!entry) return false;
    if (!entry.providers.has(providerId)) entry.providers.add(providerId);
    entry.pinCount = entry.providers.size;
    this.pins.add(cid);
    return true;
  }

  unpin(cid, providerId) {
    const entry = this.store.get(cid);
    if (!entry) return false;
    entry.providers.delete(providerId);
    entry.pinCount = entry.providers.size;
    if (entry.pinCount === 0) this.pins.delete(cid);
    return true;
  }

  stats() {
    return {
      totalObjects: this.store.size,
      pinnedObjects: this.pins.size,
      totalSize: Array.from(this.store.values()).reduce((s, e) => s + e.size, 0),
    };
  }
}

module.exports = { IpfsStore };
