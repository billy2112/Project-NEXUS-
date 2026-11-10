"use strict";

/**
 * Project NEXUS - Core constants, types, and shared utilities.
 *
 * Canonical data shapes used across discovery, scheduling, execution,
 * verification, reputation, and credits subsystems.
 */

const crypto = require("crypto");

function generateId(prefix) {
  return `${prefix}:${crypto.randomBytes(8).toString("hex")}`;
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function now() {
  return Date.now() / 1000;
}

const ComputeType = {
  CPU: "cpu",
  GPU: "gpu",
  TPU: "tpu",
  NPU: "npu",
  ZK_PROOF: "zk-proof",
  RENDER: "render",
  FEDERATED_LEARNING: "federated-learning",
};

const PrivacyLevel = {
  PUBLIC: "public",
  ENCRYPTED: "encrypted",
  TEE_REQUIRED: "tee-required",
};

const TaskState = {
  PENDING: "pending",
  ASSIGNED: "assigned",
  RUNNING: "running",
  CHECKPOINTED: "checkpointed",
  COMPLETED: "completed",
  FAILED: "failed",
  REASSIGNED: "reassigned",
  VERIFIED: "verified",
  SLASHED: "slashed",
};

const VerificationMethod = {
  ZK_SNARK: "zk-snark",
  ZK_STARK: "zk-stark",
  SIGNED_HASH: "signed-hash",
  TEE_ATTESTATION: "tee-attestation",
  RE_EXEC: "re-exec",
  COLLABORATIVE: "collaborative",
};

const SandboxType = {
  WASM: "wasm",
  FIRECRACKER: "firecracker",
  DOCKER: "docker",
  TEE: "tee",
};

const NodeMode = {
  SERVER: "server",
  CLIENT: "client",
};

module.exports = {
  generateId,
  sha256,
  now,
  ComputeType,
  PrivacyLevel,
  TaskState,
  VerificationMethod,
  SandboxType,
  NodeMode,
};
