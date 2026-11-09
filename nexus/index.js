/**
 * Project NEXUS - Global Brain of Computers.
 *
 * Distributed, decentralized computational network starter skeleton.
 *
 * This package demonstrates:
 *  * Node peer-to-peer heartbeat broadcasting
 *  * Capability-based discovery (Kademlia-inspired)
 *  * Micro-workload task model and scheduling
 *  * Sandboxed execution stub with checkpointing
 *  * Proof-of-execution verification stub
 */

"use strict";

const crypto = require("crypto");

/** Generate a unique node id. */
function generateNodeId() {
  return `node:${crypto.randomBytes(16).toString("hex")}`;
}

/** SHA-256 helper. */
function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

module.exports = { generateNodeId, sha256 };
