"use strict";

/**
 * Core task and job data models for Project NEXUS.
 */

class ComputeType {
  static CPU = "cpu";
  static GPU = "gpu";
  static TPU = "tpu";
  static NPU = "npu";
  static ZK_PROOF = "zk-proof";
  static RENDER = "render";
  static FEDERATED_LEARNING = "federated-learning";
}

class PrivacyLevel {
  static PUBLIC = "public";
  static ENCRYPTED = "encrypted";
  static TEE_REQUIRED = "tee-required";
}

class TaskState {
  static PENDING = "pending";
  static ASSIGNED = "assigned";
  static RUNNING = "running";
  static CHECKPOINTED = "checkpointed";
  static COMPLETED = "completed";
  static FAILED = "failed";
  static REASSIGNED = "reassigned";
}

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
}

class JobRequirements {
  constructor({
    computeType,
    minCores = 1,
    minMemMib = 512,
    minGpuMemMib = 0,
    maxLatencyMs = 5000,
    geoRegion = [],
    privacyLevel = PrivacyLevel.PUBLIC,
  } = {}) {
    this.computeType = computeType;
    this.minCores = minCores;
    this.minMemMib = minMemMib;
    this.minGpuMemMib = minGpuMemMib;
    this.maxLatencyMs = maxLatencyMs;
    this.geoRegion = geoRegion;
    this.privacyLevel = privacyLevel;
  }
}

class MicroWorkload {
  constructor({
    id,
    parentJob,
    index,
    inputs,
    outputs,
    requirements,
    dependsOn = [],
    estimatedRuntimeS = 300,
  } = {}) {
    this.id = id;
    this.parentJob = parentJob;
    this.index = index;
    this.inputs = inputs;
    this.outputs = outputs;
    this.requirements = requirements;
    this.dependsOn = dependsOn;
    this.estimatedRuntimeS = estimatedRuntimeS;
  }

  static create({
    parentJob,
    index,
    inputs,
    outputs,
    requirements,
    dependsOn,
    estimatedRuntimeS = 300,
  }) {
    const id = `${parentJob}:mw:${index}`;
    return new MicroWorkload({
      id,
      parentJob,
      index,
      inputs,
      outputs,
      requirements,
      dependsOn: dependsOn || [],
      estimatedRuntimeS,
    });
  }
}

class Job {
  constructor({
    id,
    submitterId,
    requirements,
    microWorkloads,
    inputDataUri,
    outputDataUri,
    budgetCredits,
    deadline,
    createdAt = Date.now() / 1000,
  } = {}) {
    this.id = id;
    this.submitterId = submitterId;
    this.requirements = requirements;
    this.microWorkloads = microWorkloads;
    this.inputDataUri = inputDataUri;
    this.outputDataUri = outputDataUri;
    this.budgetCredits = budgetCredits;
    this.deadline = deadline;
    this.createdAt = createdAt;
  }

  static create({
    submitterId,
    requirements,
    inputDataUri,
    outputDataUri,
    budgetCredits,
    deadline,
    numPartitions = 1,
  }) {
    const id = `job:${require("crypto").randomBytes(8).toString("hex")}`;
    const microWorkloads = [];
    for (let i = 0; i < numPartitions; i++) {
      microWorkloads.push(
        MicroWorkload.create({
          parentJob: id,
          index: i,
          inputs: [inputDataUri],
          outputs: [`${outputDataUri}:part:${i}`],
          requirements,
          estimatedRuntimeS: 300,
        })
      );
    }
    return new Job({
      id,
      submitterId,
      requirements,
      microWorkloads,
      inputDataUri,
      outputDataUri,
      budgetCredits,
      deadline,
    });
  }
}

class Task {
  constructor({
    id,
    microWorkloadId,
    nodeId,
    state = TaskState.PENDING,
    assignedAt = Date.now() / 1000,
    startedAt = null,
    completedAt = null,
    checkpointCid = null,
    resultCid = null,
    failureCount = 0,
    lastHeartbeat = null,
  } = {}) {
    this.id = id;
    this.microWorkloadId = microWorkloadId;
    this.nodeId = nodeId;
    this.state = state;
    this.assignedAt = assignedAt;
    this.startedAt = startedAt;
    this.completedAt = completedAt;
    this.checkpointCid = checkpointCid;
    this.resultCid = resultCid;
    this.failureCount = failureCount;
    this.lastHeartbeat = lastHeartbeat;
  }

  markRunning() {
    this.state = TaskState.RUNNING;
    this.startedAt = Date.now() / 1000;
  }

  markCompleted(resultCid) {
    this.state = TaskState.COMPLETED;
    this.completedAt = Date.now() / 1000;
    this.resultCid = resultCid;
  }

  markFailed() {
    this.state = TaskState.FAILED;
    this.failureCount += 1;
  }
}

class TaskResult {
  constructor({ taskId, nodeId, outputUri, proof = null, metrics = {} } = {}) {
    this.taskId = taskId;
    this.nodeId = nodeId;
    this.outputUri = outputUri;
    this.proof = proof;
    this.metrics = metrics;
    this.timestamp = Date.now() / 1000;
  }
}

class ProofOfExecution {
  constructor({
    method,
    payload = "",
    inputHash,
    outputHash,
    timestamp = Date.now() / 1000,
    nodeId = "",
  } = {}) {
    this.method = method;
    this.payload = payload;
    this.inputHash = inputHash;
    this.outputHash = outputHash;
    this.timestamp = timestamp;
    this.nodeId = nodeId;
  }
}

module.exports = {
  ComputeType,
  PrivacyLevel,
  TaskState,
  Capability,
  JobRequirements,
  MicroWorkload,
  Job,
  Task,
  TaskResult,
  ProofOfExecution,
};
