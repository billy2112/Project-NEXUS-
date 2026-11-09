"use strict";

const crypto = require("crypto");
const { TaskResult } = require("./task");

/**
 * Cryptographic verification stub for Project NEXUS.
 */

const VerificationMethod = {
  ZK_SNARK: "zk-snark",
  ZK_STARK: "zk-stark",
  SIGNED_HASH: "signed-hash",
  TEE_ATTESTATION: "tee-attestation",
  RE_EXEC: "re-exec",
};

class VerificationResult {
  constructor({ valid, method, confidence, details, verifiedAt = Date.now() / 1000 } = {}) {
    this.valid = valid;
    this.method = method;
    this.confidence = confidence;
    this.details = details;
    this.verifiedAt = verifiedAt;
  }
}

class Verifier {
  constructor({ samplingRate = 0.05 } = {}) {
    this.samplingRate = samplingRate;
    this.verifications = [];
  }

  verify(result) {
    const proof = result.proof;
    if (!proof) return this._reExecVerify(result);

    const method = proof.method;
    let vr;
    if (method === VerificationMethod.ZK_SNARK) vr = this._verifyZkSnark(proof, result);
    else if (method === VerificationMethod.ZK_STARK) vr = this._verifyZkStark(proof, result);
    else if (method === VerificationMethod.SIGNED_HASH) vr = this._verifySignedHash(proof, result);
    else if (method === VerificationMethod.TEE_ATTESTATION) vr = this._verifyTee(proof, result);
    else vr = this._reExecVerify(result);

    this.verifications.push(vr);
    return vr;
  }

  _verifyZkSnark(proof, result) {
    const valid = proof.payload.length > 0;
    return new VerificationResult({
      valid, method: proof.method,
      confidence: valid ? 0.99 : 0.0,
      details: "zk-SNARK verification (stub)",
    });
  }

  _verifyZkStark(proof, result) {
    const valid = proof.payload.length > 0;
    return new VerificationResult({
      valid, method: proof.method,
      confidence: valid ? 0.98 : 0.0,
      details: "zk-STARK verification (stub)",
    });
  }

  _verifySignedHash(proof, result) {
    const expected = crypto
      .createHash("sha256")
      .update(proof.inputHash + result.outputUri)
      .digest("hex");
    const valid = proof.outputHash === expected;
    return new VerificationResult({
      valid, method: proof.method,
      confidence: valid ? 0.85 : 0.0,
      details: "signed-hash chain verification (stub)",
    });
  }

  _verifyTee(proof, result) {
    const valid = proof.payload.length > 0;
    return new VerificationResult({
      valid, method: proof.method,
      confidence: valid ? 0.95 : 0.0,
      details: "TEE remote attestation (stub)",
    });
  }

  _reExecVerify(result) {
    const sampled = Math.random() < this.samplingRate;
    return new VerificationResult({
      valid: true, // skeleton: accept unless explicitly fraudulent
      method: VerificationMethod.RE_EXEC,
      confidence: 0.70,
      details: `re-execution sampling (sampled=${sampled})`,
    });
  }

  generateProof({ method, nodeId, inputHash, outputHash, payload = "" }) {
    return {
      method,
      payload,
      inputHash,
      outputHash,
      timestamp: Date.now() / 1000,
      nodeId,
    };
  }
}

module.exports = { Verifier, VerificationMethod, VerificationResult };
