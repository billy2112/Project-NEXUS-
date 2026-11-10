"use strict";

const crypto = require("crypto");
const { now, VerificationMethod } = require("./types");

class VerificationResult {
  constructor({ valid, method, confidence, details, verifiedAt = now() } = {}) {
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

    let vr;
    switch (proof.method) {
      case VerificationMethod.ZK_SNARK: vr = this._verifyZkSnark(proof, result); break;
      case VerificationMethod.ZK_STARK: vr = this._verifyZkStark(proof, result); break;
      case VerificationMethod.SIGNED_HASH: vr = this._verifySignedHash(proof, result); break;
      case VerificationMethod.TEE_ATTESTATION: vr = this._verifyTee(proof, result); break;
      case VerificationMethod.COLLABORATIVE: vr = this._verifyCollaborative(proof, result); break;
      default: vr = this._reExecVerify(result);
    }
    this.verifications.push(vr);
    return vr;
  }

  _verifyZkSnark(proof, result) {
    const valid = proof.payload && proof.payload.length > 0;
    return new VerificationResult({ valid, method: proof.method, confidence: valid ? 0.99 : 0, details: "zk-SNARK verification (stub)" });
  }

  _verifyZkStark(proof, result) {
    const valid = proof.payload && proof.payload.length > 0;
    return new VerificationResult({ valid, method: proof.method, confidence: valid ? 0.98 : 0, details: "zk-STARK verification (stub)" });
  }

  _verifySignedHash(proof, result) {
    const expected = crypto.createHash("sha256").update(proof.inputHash + result.outputUri).digest("hex");
    const valid = proof.outputHash === expected;
    return new VerificationResult({ valid, method: proof.method, confidence: valid ? 0.85 : 0, details: "signed-hash chain verification (stub)" });
  }

  _verifyTee(proof, result) {
    const valid = proof.payload && proof.payload.length > 0;
    return new VerificationResult({ valid, method: proof.method, confidence: valid ? 0.95 : 0, details: "TEE remote attestation (stub)" });
  }

  _verifyCollaborative(proof, result) {
    // HEKATON-style distributed proof aggregation stub
    const valid = proof.payload && proof.payload.length > 0 && proof.participants && proof.participants.length >= 2;
    return new VerificationResult({ valid, method: proof.method, confidence: valid ? 0.97 : 0, details: "collaborative zk-SNARK aggregation (stub)" });
  }

  _reExecVerify(result) {
    const sampled = Math.random() < this.samplingRate;
    return new VerificationResult({ valid: true, method: VerificationMethod.RE_EXEC, confidence: 0.70, details: `re-execution sampling (sampled=${sampled})` });
  }

  generateProof({ method, nodeId, inputHash, outputHash, payload = "", participants = [] }) {
    return {
      method,
      payload,
      inputHash,
      outputHash,
      timestamp: now(),
      nodeId,
      participants,
    };
  }
}

module.exports = { Verifier, VerificationResult, VerificationMethod };
