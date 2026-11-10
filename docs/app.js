/**
 * Project NEXUS — Client-side simulation for GitHub Pages.
 *
 * Runs entirely in the browser: Kademlia-inspired discovery, weighted
 * resource-matching scheduler, sandboxed execution stubs, zk-style
 * verification, reputation engine, credit ledger, and live topology.
 */

"use strict";

/* ---------- shared constants ---------- */
const ComputeType = { CPU:"cpu", GPU:"gpu", TPU:"tpu", NPU:"npu", ZK_PROOF:"zk-proof", RENDER:"render", FEDERATED_LEARNING:"federated-learning" };
const PrivacyLevel = { PUBLIC:"public", ENCRYPTED:"encrypted", TEE_REQUIRED:"tee-required" };
const TaskState = { PENDING:"pending", ASSIGNED:"assigned", RUNNING:"running", CHECKPOINTED:"checkpointed", COMPLETED:"completed", FAILED:"failed", REASSIGNED:"reassigned", VERIFIED:"verified" };
const VerificationMethod = { ZK_SNARK:"zk-snark", ZK_STARK:"zk-stark", SIGNED_HASH:"signed-hash", TEE_ATTESTATION:"tee-attestation", COLLABORATIVE:"collaborative", RE_EXEC:"re-exec" };
const SandboxType = { WASM:"wasm", FIRECRACKER:"firecracker", DOCKER:"docker", TEE:"tee" };
const NodeMode = { SERVER:"server", CLIENT:"client" };

function generateId(prefix){ return `${prefix}:${crypto.randomBytes?crypto.randomBytes(8).toString("hex"):Math.random().toString(36).slice(2)}`; }
function sha256(data){
  // fallback for environments without subtle crypto handled below
  return crypto.subtle
    ? (async()=>{ const buf=await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data)); return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join(""); })()
    : Promise.resolve(data.split("").reduce((a,b)=>{a=((a<<5)-a)+b.charCodeAt(0)|0;return a;},0).toString(16));
}
function now(){ return Date.now()/1000; }
function shortId(id){ return id ? (id.length>14? id.slice(0,12)+"…" : id) : "—"; }
function formatTime(ts){ if(!ts) return "—"; return new Date(ts*1000).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"}); }
function esc(t){ const d=document.createElement("div"); d.textContent=t==null?"":String(t); return d.innerHTML; }

/* ---------- simulation state ---------- */
const discovery = {
  records:{}, capIndex:{}, kBuckets:{}, bootstrapPeers:[],
  HEARTBEAT_TTL:60, K:20,
  register(rec){
    this.records[rec.nodeId]=rec; this._reindex(); this._touch(rec.nodeId,rec.multiaddrs);
  },
  lookupByCapability(capType,minCount=1,minRep=0){
    const out=[]; const ids=this.capIndex[capType]||new Set();
    for(const id of ids){ const r=this.records[id]; if(!r)continue; if(!r.hasCapability(capType,minCount))continue; if(r.reputation<minRep)continue; if(now()-r.lastSeen>this.HEARTBEAT_TTL)continue; out.push(r); }
    out.sort((a,b)=>b.reputation-a.reputation||a.priceCreditsPerCycle-b.priceCreditsPerCycle);
    return out;
  },
  getRecord(id){ return this.records[id]||null; },
  ingestHeartbeat(id,addrs,tel){
    let r=this.records[id]; if(!r){ r=new NodeRecord({nodeId:id,multiaddrs:addrs,capabilities:[]}); this.records[id]=r; }
    r.lastSeen=now(); r.multiaddrs=addrs; if(tel&&tel.natStatus) r.natStatus=tel.natStatus; this._touch(id,addrs);
  },
  staleNodes(){ const t=now(); return Object.entries(this.records).filter(([,r])=>t-r.lastSeen>this.HEARTBEAT_TTL).map(([id])=>id); },
  _reindex(){ this.capIndex={}; for(const r of Object.values(this.records)) for(const c of r.capabilities){ if(!this.capIndex[c.type]) this.capIndex[c.type]=new Set(); this.capIndex[c.type].add(r.nodeId);} },
  _touch(id,addrs){ const p=sha256(id).then(h=>h.slice(0,2)); // async-safe fallback below
    const prefix = id.split(":")[1]? id.split(":")[1].slice(0,2) : "00";
    let b=this.kBuckets[prefix]; if(!b){ b=[]; this.kBuckets[prefix]=b; }
    b=b.filter(x=>x.nodeId!==id); b.unshift({nodeId:id,multiaddrs:addrs}); if(b.length>this.K)b.pop(); this.kBuckets[prefix]=b;
  }
};

class Capability{ constructor({type,version="1.0",count=1,details={}}={}){ this.type=type;this.version=version;this.count=count;this.details=details;} matches(o){ return this.type===o.type&&this.count>=o.count;} toDict(){ return{type:this.type,version:this.version,count:this.count,details:this.details};} }
class Telemetry{ constructor({nodeId,seq=0,cpuUtil=0,gpuUtil=0,gpuMemUsedMib=0,memUsedMib=0,memTotalMib=0,netRxMbps=0,netTxMbps=0,latencyMs=0,activeTasks=0,maxConcurrentTasks=4,uptimeS=0,timestamp=now()}={}){ Object.assign(this,{nodeId,seq,cpuUtil,gpuUtil,gpuMemUsedMib,memUsedMib,memTotalMib,netRxMbps,netTxMbps,latencyMs,activeTasks,maxConcurrentTasks,uptimeS,timestamp});} get loadFactor(){ return this.maxConcurrentTasks<=0?1:Math.min(1,this.activeTasks/this.maxConcurrentTasks);} get isHealthy(){ return this.cpuUtil<95&&this.loadFactor<1;} toDict(){ return{nodeId:this.nodeId,seq:this.seq,cpuUtil:this.cpuUtil,gpuUtil:this.gpuUtil,gpuMemUsedMib:this.gpuMemUsedMib,memUsedMib:this.memUsedMib,memTotalMib:this.memTotalMib,netRxMbps:this.netRxMbps,netTxMbps:this.netTxMbps,latencyMs:this.latencyMs,activeTasks:this.activeTasks,maxConcurrentTasks:this.maxConcurrentTasks,uptimeS:this.uptimeS,loadFactor:this.loadFactor,isHealthy:this.isHealthy,timestamp:this.timestamp};} }
class NodeRecord{ constructor({nodeId,multiaddrs=[],capabilities=[],reputation=1,geoRegion="unknown",bandwidthMbps=100,lastSeen=now(),priceCreditsPerCycle=1,stakeCredits=0,mode=NodeMode.CLIENT,natStatus="unknown",sandboxTypes=["wasm"],hardwareFingerprint=null}={}){ this.nodeId=nodeId;this.multiaddrs=multiaddrs;this.capabilities=capabilities;this.reputation=reputation;this.geoRegion=geoRegion;this.bandwidthMbps=bandwidthMbps;this.lastSeen=lastSeen;this.priceCreditsPerCycle=priceCreditsPerCycle;this.stakeCredits=stakeCredits;this.mode=mode;this.natStatus=natStatus;this.sandboxTypes=sandboxTypes;this.hardwareFingerprint=hardwareFingerprint||("fp:"+Math.random().toString(36).slice(2)); this.joinTimestamp=lastSeen; this.totalTasksCompleted=0; this.totalTasksFailed=0; this.totalCreditsEarned=0;} toDict(){ return{nodeId:this.nodeId,multiaddrs:this.multiaddrs,capabilities:this.capabilities.map(c=>c.toDict()),reputation:this.reputation,geoRegion:this.geoRegion,bandwidthMbps:this.bandwidthMbps,lastSeen:this.lastSeen,priceCreditsPerCycle:this.priceCreditsPerCycle,stakeCredits:this.stakeCredits,mode:this.mode,natStatus:this.natStatus,sandboxTypes:this.sandboxTypes,hardwareFingerprint:this.hardwareFingerprint,joinTimestamp:this.joinTimestamp,totalTasksCompleted:this.totalTasksCompleted,totalTasksFailed:this.totalTasksFailed,totalCreditsEarned:this.totalCreditsEarned};}   hasCapability(t,c=1){ return this.capabilities.some(x=>x.type===t&&x.count>=c); }
}

function generateNodeId(){ return `node:${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`; }

class Scheduler{ constructor(discovery){ this.discovery=discovery; this.telemetry={}; this.nodeTasks={}; this.decisions=[]; this.jobDags={}; }
  static W={CAP:0.30,TEL:0.20,REP:0.20,GEO:0.15,LOAD:0.10,COST:0.05};
  updateTelemetry(t){ this.telemetry[t.nodeId]=t; }
  registerJobDag(jobId,mws){ this.jobDags[jobId]=Object.fromEntries(mws.map(m=>[m.id,(m.dependsOn||[]).slice()])); }
  getReady(jobId,completed){
    const deps=this.jobDags[jobId]; if(!deps)return[]; const ready=[]; for(const [mwId,depList] of Object.entries(deps)){ if(completed.has(mwId))continue; if(depList.every(d=>completed.has(d))) ready.push(mwId);} return ready;
  }
  scoreNode(rec,reqs,subRegion="unknown"){
    const t=this.telemetry[rec.nodeId]; if(!t)return null;
    const cap=rec.hasCapability(reqs.computeType)?1:0;
    const telScore=Math.max(0,1-Math.max(t.cpuUtil,t.gpuUtil)/100);
    const rep=Math.min(1,Math.max(0,rec.reputation));
    const geo=rec.geoRegion===subRegion?1:0.5;
    const load=1-t.loadFactor;
    const cost=1/(1+rec.priceCreditsPerCycle);
    const score=Scheduler.W.CAP*cap+Scheduler.W.TEL*telScore+Scheduler.W.REP*rep+Scheduler.W.GEO*geo+Scheduler.W.LOAD*load+Scheduler.W.COST*cost;
    return {record:rec,telemetry:t,score,breakdown:{capability:cap,telemetry:telScore,reputation:rep,geo,load,cost}};
  }
  schedule(mw,subRegion="unknown",exclude=[]){
    const cands=this.discovery.lookupByCapability({capType:mw.requirements.computeType,minCount:1,minReputation:0.3}).filter(r=>!exclude.includes(r.nodeId));
    if(!cands.length)return null;
    const scored=[]; for(const r of cands){ const s=this.scoreNode(r,mw.requirements,subRegion); if(!s)continue; if(s.telemetry.loadFactor>=1)continue; scored.push(s); }
    if(!scored.length)return null;
    scored.sort((a,b)=>b.score-a.score); const best=scored[0];
    const task={id:`task:${mw.id}`,microWorkloadId:mw.id,nodeId:best.record.nodeId,state:TaskState.ASSIGNED,assignedAt:now(),parentJob:null};
    if(!this.nodeTasks[best.record.nodeId])this.nodeTasks[best.record.nodeId]=[]; this.nodeTasks[best.record.nodeId].push(task);
    const decision={microWorkloadId:mw.id,nodeId:best.record.nodeId,score:best.score,reason:Object.entries(best.breakdown).map(([k,v])=>k+"="+v.toFixed(2)).join(" "),timestamp:now()};
    this.decisions.push(decision); return {decision,task};
  }
  reassignOnFailure(task,mw,subRegion="unknown"){
    task.state=TaskState.REASSIGNED; task.failureCount=(task.failureCount||0)+1;
    const cands=this.discovery.lookupByCapability({capType:mw.requirements.computeType,minCount:1,minReputation:0.3}).filter(r=>r.nodeId!==task.nodeId);
    if(!cands.length)return null; const rec=cands[0]; const s=this.scoreNode(rec,mw.requirements,subRegion); if(!s)return null;
    const nt={id:`task:${mw.id}:retry${task.failureCount}`,microWorkloadId:mw.id,nodeId:rec.nodeId,state:TaskState.ASSIGNED,assignedAt:now(),parentJob:null};
    if(!this.nodeTasks[rec.nodeId])this.nodeTasks[rec.nodeId]=[]; this.nodeTasks[rec.nodeId].push(nt);
    const decision={microWorkloadId:mw.id,nodeId:rec.nodeId,score:s.score,reason:"reassignment after failure",timestamp:now()}; this.decisions.push(decision);
    return {decision,task:nt};
  }
  getTasksForNode(id){ return this.nodeTasks[id]||[]; }
}

class Executor{ constructor({nodeId,sandbox}={}){ this.nodeId=nodeId; this.sandbox=sandbox||new StubSandbox(); this.checkpoints={}; }
  async execute(task,mw){
    task.state=TaskState.RUNNING; task.startedAt=now();
    const workdir=`/tmp/nexus/${task.id}`;
    let seq=0,lastCid=null;
    for(let step=0;step<3;step++){
      const cid=`cid:${sha256(JSON.stringify({taskId:task.id,seq,step,node:this.nodeId}))}`;
      lastCid=cid; if(!this.checkpoints[task.id])this.checkpoints[task.id]=[]; this.checkpoints[task.id].push({taskId:task.id,seq,statePayload:JSON.stringify({step,node:this.nodeId}),outputPartial:`partial-${step}`,cid,timestamp:now()});
      task.checkpointCid=lastCid; task.state=TaskState.CHECKPOINTED; seq++;
      await new Promise(r=>setTimeout(r,120));
    }
    const outputUri=await this.sandbox.run(mw,workdir);
    task.state=TaskState.COMPLETED; task.completedAt=now(); task.resultCid=outputUri;
    return {taskId:task.id,nodeId:this.nodeId,outputUri,metrics:{durationS:(task.completedAt-task.startedAt),checkpoints:seq},checkpointCid:lastCid};
  }
  resumeFromCheckpoint(id,cid){ const c=this.checkpoints[id]||[]; return c.find(x=>x.cid===cid)||null; }
}
class Sandbox{ run(mw,dir){ throw new Error("implement"); } }
class StubSandbox extends Sandbox{ constructor({latencyS=0.05}={}){ super(); this.latencyS=latencyS;} async run(mw,dir){ await new Promise(r=>setTimeout(r,this.latencyS*1000)); return `ipfs://output:${mw.id}:${Math.random().toString(36).slice(2,6)}`; } }
class WasmSandbox extends Sandbox{ async run(mw,dir){ await new Promise(r=>setTimeout(r,40)); return `ipfs://wasm:${mw.id}:${Math.random().toString(36).slice(2,6)}`; } }
class FirecrackerSandbox extends Sandbox{ async run(mw,dir){ await new Promise(r=>setTimeout(r,250)); return `ipfs://fc:${mw.id}:${Math.random().toString(36).slice(2,6)}`; } }

class Verifier{ constructor({samplingRate=0.05}={}){ this.samplingRate=samplingRate; this.verifications=[]; }
  verify(result){
    const p=result.proof; if(!p)return this._reExec(result);
    let vr; switch(p.method){
      case VerificationMethod.ZK_SNARK: vr=this._zk(p,result,0.99);break;
      case VerificationMethod.ZK_STARK: vr=this._zk(p,result,0.98);break;
      case VerificationMethod.SIGNED_HASH: vr=this._signedHash(p,result);break;
      case VerificationMethod.TEE_ATTESTATION: vr=this._zk(p,result,0.95);break;
      case VerificationMethod.COLLABORATIVE: vr=this._collab(p,result);break;
      default: vr=this._reExec(result);
    }
    this.verifications.push(vr); return vr;
  }
  _zk(p,r,c){ const v=p.payload&&p.payload.length>0; return{valid:v,method:p.method,confidence:v?c:0,details:`${p.method.toUpperCase()} (sim)`}; }
  _signedHash(p,r){ const exp=sha256(p.inputHash+r.outputUri); const v=p.outputHash===exp; return{valid:v,method:p.method,confidence:v?0.85:0,details:"signed-hash chain (sim)"}; }
  _collab(p,r){ const v=p.payload&&p.payload.length>0&&p.participants&&p.participants.length>=2; return{valid:v,method:p.method,confidence:v?0.97:0,details:"collaborative zk (sim)"}; }
  _reExec(r){ const s=Math.random()<this.samplingRate; return{valid:true,method:VerificationMethod.RE_EXEC,confidence:0.70,details:`re-exec sampling (${s})`}; }
  generateProof({method,nodeId,inputHash,outputHash,payload="",participants=[]}){ return{method,payload,inputHash,outputHash,timestamp:now(),nodeId,participants}; }
}

class IpfsStore{ constructor(){ this.store=new Map(); this.pins=new Set(); }
  add(data){ const cid=`cid:${sha256(typeof data==="string"?data:JSON.stringify(data))}`; const e=this.store.get(cid); if(e) return cid; this.store.set(cid,{cid,data,size:JSON.stringify(data).length,pinCount:0,providers:new Set()}); return cid; }
  get(cid){ const e=this.store.get(cid); return e?e.data:null; }
  pin(cid,pid){ const e=this.store.get(cid); if(!e)return false; e.providers.add(pid); e.pinCount=e.providers.size; this.pins.add(cid); return true; }
  stats(){ return{totalObjects:this.store.size,pinnedObjects:this.pins.size,totalSize:Array.from(this.store.values()).reduce((s,e)=>s+e.size,0)}; }
}

class ReputationEngine{ constructor(){ this.scores={}; this.history={}; }
  update(id,event){
    if(!this.scores[id]){ this.scores[id]={uptime:1,completion:1,verification:1,latency:1,updatedAt:now()}; this.history[id]=[]; }
    const s=this.scores[id]; s.updatedAt=now(); this.history[id].push({...event,at:now()}); if(this.history[id].length>1000)this.history[id].shift();
    switch(event.type){ case"task_complete": s.completion=Math.min(1,s.completion+0.01);break; case"task_fail": s.completion=Math.max(0,s.completion-0.05);break; case"verify_pass": s.verification=Math.min(1,s.verification+0.02);break; case"verify_fail": s.verification=Math.max(0,s.verification-0.1); s.latency=Math.max(0,s.latency-0.1);break; case"heartbeat": s.uptime=Math.min(1,s.uptime+0.001);break; }
    if(event.latencyMs!==undefined){ s.latency=event.latencyMs<100?Math.min(1,s.latency+0.01):Math.max(0,s.latency-0.02); }
    return this.compute(id);
  }
  compute(id){ const s=this.scores[id]; if(!s)return 0; return 0.4*s.uptime+0.25*s.completion+0.2*s.verification+0.15*s.latency; }
  get(id){ return this.scores[id]||{uptime:0,completion:0,verification:0,latency:0,updatedAt:now()}; }
}
class CreditLedger{ constructor(){ this.balances={}; this.transactions=[]; this.rates={computeCycle:1,gpuCycle:5,gbHour:0.1,mb:0.001}; }
  ensure(id){ if(this.balances[id]===undefined)this.balances[id]=0; }
  credit(id,amount,type,ref){ this.ensure(id); this.balances[id]+=amount; this._tx(null,id,amount,type,ref); return this.balances[id]; }
  debit(id,amount,type,ref){ this.ensure(id); if(this.balances[id]<amount)return false; this.balances[id]-=amount; this._tx(id,null,amount,type,ref); return true; }
  transfer(f,t,amount,type,ref){ if(!this.debit(f,amount,type,ref))return false; this.credit(t,amount,type,ref); return true; }
  _tx(f,t,amount,type,ref){ this.transactions.push({from:f,to:t,amount,type,ref,timestamp:now()}); if(this.transactions.length>10000)this.transactions.shift(); }
  balance(id){ this.ensure(id); return this.balances[id]; }
  metered({cpuSeconds=0,gpuSeconds=0,gbHours=0,mb=0}={}){ return cpuSeconds*this.rates.computeCycle+gpuSeconds*this.rates.gpuCycle+gbHours*this.rates.gbHour+mb*this.rates.mb; }
  stats(){ return{totalSupply:Object.values(this.balances).reduce((a,b)=>a+b,0),accountCount:Object.keys(this.balances).length,txCount:this.transactions.length,rates:this.rates}; }
}

/* ---------- NEXUS simulation engine ---------- */
class NexusSim{
  constructor(){
    this.discovery=discovery;
    this.scheduler=new Scheduler(discovery);
    this.executor=new Executor({nodeId:"nexus-coordinator",sandbox:new StubSandbox()});
    this.wasmExecutor=new Executor({nodeId:"nexus-wasm",sandbox:new WasmSandbox()});
    this.fcExecutor=new Executor({nodeId:"nexus-fc",sandbox:new FirecrackerSandbox()});
    this.verifier=new Verifier();
    this.storage=new IpfsStore();
    this.reputation=new ReputationEngine();
    this.credits=new CreditLedger();
    this.nodes=new Map(); // id -> {record,telemetry,sandboxType,executor}
    this.jobs=new Map();
    this.tasks=new Map();
    this.listeners=new Map(); // event -> Set(cb)
    this.running=false;
    this.heartbeatInterval=1500;
    this._hbTimer=null;
    this._seq=0;
  }
  on(event,cb){ if(!this.listeners.has(event))this.listeners.set(event,new Set()); this.listeners.get(event).add(cb); return()=>{ const s=this.listeners.get(event); if(s)s.delete(cb);};}
  emit(event,data){ const s=this.listeners.get(event); if(s){ for(const cb of s){ try{cb(data);}catch(e){} } } }

  registerNode({nodeId,geoRegion="unknown",capabilities=null,multiaddrs=null,mode=NodeMode.CLIENT,sandboxTypes=[SandboxType.WASM],stakeCredits=0}={}){
    const id=nodeId||generateNodeId();
    const caps=capabilities||[new Capability({type:ComputeType.CPU,count:2}),new Capability({type:ComputeType.GPU,count:1})];
    const addrs=multiaddrs||[`/ip4/127.0.0.1/tcp/0/p2p/${id}`];
    const rec=new NodeRecord({nodeId:id,multiaddrs:addrs,capabilities:caps,reputation:1,geoRegion,bandwidthMbps:100,priceCreditsPerCycle:1,stakeCredits,mode,sandboxTypes,hardwareFingerprint:"fp:"+Math.random().toString(36).slice(2)});
    this.discovery.register(rec);
    const sandboxType = sandboxTypes.includes(SandboxType.FIRECRACKER)?SandboxType.FIRECRACKER : sandboxTypes.includes(SandboxType.WASM)?SandboxType.WASM : SandboxType.WASM;
    const executor = sandboxType===SandboxType.FIRECRACKER?this.fcExecutor : sandboxType===SandboxType.WASM?this.wasmExecutor : this.executor;
    this.nodes.set(id,{record:rec,telemetry:new Telemetry({nodeId:id}),sandboxType,executor,socketId:null});
    this.credits.ensure(id); this.reputation.get(id);
    this.emit("node:joined",{nodeId:id,record:rec.toDict()});
    this._heartbeat(id);
    return {nodeId:id,record:rec.toDict()};
  }

  heartbeat(nodeId,telData={}){
    const n=this.nodes.get(nodeId); if(!n)return{ok:false,error:"not registered"};
    const tel=new Telemetry({nodeId,seq:telData.seq||0,cpuUtil:telData.cpuUtil??25,gpuUtil:telData.gpuUtil??40,memUsedMib:telData.memUsedMib??2048,memTotalMib:telData.memTotalMib??8192,netRxMbps:telData.netRxMbps??50,netTxMbps:telData.netTxMbps??50,latencyMs:telData.latencyMs??10,activeTasks:telData.activeTasks??this.scheduler.getTasksForNode(nodeId).length,maxConcurrentTasks:telData.maxConcurrentTasks??4,uptimeS:telData.uptimeS??now(),natStatus:telData.natStatus});
    n.telemetry=tel; this.scheduler.updateTelemetry(tel); this.discovery.ingestHeartbeat(nodeId,n.record.multiaddrs,tel);
    this.reputation.update(nodeId,{type:"heartbeat",latencyMs:tel.latencyMs});
    this.emit("node:heartbeat",{nodeId,telemetry:tel.toDict()});
    return {ok:true,seq:tel.seq};
  }

  submitJob({submitterId="user:web",requirements,inputDataUri="ipfs://QmExampleInput",outputDataUri=null,budgetCredits=1000,deadline=now()+3600,numPartitions=1,requiresSequential=false,estimatedRuntimeS=300,privacyLevel=PrivacyLevel.PUBLIC,verificationMethod=VerificationMethod.SIGNED_HASH}={}){
    const id=generateId("job");
    const outUri=outputDataUri||`ipfs://QmOutput:${id}`;
    const job={id,submitterId,requirements,inputDataUri,outputDataUri:outUri,budgetCredits,deadline,numPartitions,requiresSequential,estimatedRuntimeS,privacyLevel,verificationMethod,state:"submitted",createdAt:now(),microWorkloads:[]};
    const mws=[];
    for(let i=0;i<numPartitions;i++){
      mws.push({id:`${id}:mw:${i}`,parentJob:id,index:i,inputs:[inputDataUri],outputs:[`${outUri}:part:${i}`],requirements,dependsOn:requiresSequential?(i>0?[`${id}:mw:${i-1}`]:[]):[],estimatedRuntimeS});
    }
    job.microWorkloads=mws;
    this.scheduler.registerJobDag(id,mws);
    this.jobs.set(id,job);
    const cost=this.credits.metered({cpuSeconds:numPartitions*estimatedRuntimeS});
    if(submitterId)this.credits.debit(submitterId,cost,"job_escrow",id);
    this.emit("job:submitted",{job});
    this.scheduleReady(id);
    return {job};
  }

  scheduleReady(jobId){
    const job=this.jobs.get(jobId); if(!job)return{scheduled:0,reason:"not found"};
    const completed=new Set(Array.from(this.tasks.values()).filter(t=>t.parentJob===jobId&&t.state===TaskState.COMPLETED).map(t=>t.microWorkloadId));
    const scheduledBefore=new Set(Array.from(this.tasks.values()).filter(t=>t.parentJob===jobId).map(t=>t.microWorkloadId));
    const ready=this.scheduler.getReady(jobId,completed); let scheduled=0;
    for(const mwId of ready){ if(scheduledBefore.has(mwId))continue; const mw=job.microWorkloads.find(m=>m.id===mwId); if(!mw)continue; const out=this.scheduler.schedule(mw,"web-user"); if(!out)continue; const {decision,task}=out; task.parentJob=jobId; this.tasks.set(task.id,task); job.state="scheduling"; scheduled++; this.emit("task:assigned",{task,microWorkload:mw,decision,jobId}); this._executeTask(task.id,mw); }
    if(scheduled>0)this.emit("network:state",this.snapshot());
    return {scheduled};
  }

  async _executeTask(taskId,mw){
    const task=this.tasks.get(taskId); if(!task)return;
    const node=this.nodes.get(task.nodeId); if(!node){ task.state=TaskState.FAILED; this.emit("task:failed",{taskId,reason:"node not found"}); return; }
    task.state=TaskState.RUNNING; task.startedAt=now(); this.emit("task:running",{taskId,nodeId:task.nodeId});
    try{
      const result=await node.executor.execute(task,mw);
      task.state=TaskState.COMPLETED; task.completedAt=now(); task.resultCid=result.outputUri;
      this.storage.add(result.outputUri);
      // verify
      const inputHash=sha256(mw.inputs.join(",")); const outputHash=sha256(inputHash+result.outputUri);
      const proof=this.verifier.generateProof({method:jobVerifMethod(jobId),nodeId:task.nodeId,inputHash,outputHash,payload:`proof:${taskId}`});
      const verdict=this.verifier.verify({...result,proof});
      if(!verdict.valid){ this.reputation.update(task.nodeId,{type:"verify_fail"}); task.state=TaskState.FAILED; this.emit("task:verification_failed",{taskId,verdict}); return; }
      this.reputation.update(task.nodeId,{type:"verify_pass"});
      // credits after verification
      this.reputation.update(task.nodeId,{type:"task_complete"});
      const cost=this.credits.metered({cpuSeconds:result.metrics.durationS||1});
      const owner=this.jobs.get(task.parentJob)?.submitterId;
      if(owner)this.credits.debit(owner,cost,"task_execution",taskId);
      this.credits.credit(task.nodeId,cost,"task_reward",taskId);
      task.state=TaskState.VERIFIED;
      const job=this.jobs.get(task.parentJob); if(job)job.state="completed";
      this.emit("task:completed",{task,result,proof,verdict,jobId:task.parentJob});
      this.emit("network:state",this.snapshot());
      this.scheduleReady(task.parentJob);
    }catch(e){
      console.error("exec error",e); task.state=TaskState.FAILED; task.failureCount=(task.failureCount||0)+1;
      this.reputation.update(task.nodeId,{type:"task_fail"});
      this.emit("task:failed",{taskId,reason:e.message});
      const mw2=this.jobMw(jobId?task.parentJob:null,task.microWorkloadId);
      if(mw2&&task.failureCount<3){
        setTimeout(()=>{ const r=this.scheduler.reassignOnFailure(task,mw2,"web-user"); if(r){ const {decision,task:nt}=r; nt.parentJob=task.parentJob; this.tasks.set(nt.id,nt); this.emit("task:reassigned",{oldTaskId:taskId,newTask:nt,decision}); this._executeTask(nt.id,mw2);} },1000);
      }
    }
  }

  jobMw(jobId,mwId){ const j=this.jobs.get(jobId); return j?j.microWorkloads.find(m=>m.id===mwId):null; }

  snapshot(){
    const nodes=Array.from(this.nodes.keys()).map(id=>{ const n=this.nodes.get(id); const rec=n.record.toDict(); rec.telemetry=n.telemetry?n.telemetry.toDict():null; rec.connected=!!n.socketId; rec.tasks=this.scheduler.getTasksForNode(id).length; return rec; });
    return {nodes,nodeCount:this.nodes.size,jobCount:this.jobs.size,taskCount:this.tasks.size,timestamp:now()};
  }

  start(){ this.running=true; this._loop(); }
  stop(){ this.running=false; if(this._hbTimer)clearInterval(this._hbTimer); }
  _loop(){
    if(!this.running)return;
    // heartbeats for all nodes
    for(const id of this.nodes.keys()){ this.heartbeat(id,{seq:++this._seq}); }
    // random node telemetry jitter
    for(const [id,n] of this.nodes){
      const tel=n.telemetry; if(!tel)continue;
      tel.cpuUtil=Math.max(0,Math.min(100,tel.cpuUtil+(Math.random()-0.5)*15));
      tel.gpuUtil=Math.max(0,Math.min(100,tel.gpuUtil+(Math.random()-0.5)*15));
      tel.activeTasks=this.scheduler.getTasksForNode(id).length;
    }
    this.emit("network:state",this.snapshot());
    this._hbTimer=setTimeout(()=>this._loop(),this.heartbeatInterval);
  }
}

function jobVerifMethod(jobId){ const j=sim.jobs.get(jobId); return j?j.verificationMethod:VerificationMethod.SIGNED_HASH; }

/* ---------- UI ---------- */
const sim=new NexusSim();
let activityFeed=document.getElementById("activityFeed");
function addActivity(html,meta){
  const d=document.createElement("div"); d.className="feed-item";
  d.innerHTML=`<span>${html}</span>${meta?`<span class="meta">${meta}</span>`:""}`;
  if(activityFeed.children.length===1&&activityFeed.children[0].classList.contains("empty")) activityFeed.innerHTML="";
  activityFeed.prepend(d); while(activityFeed.children.length>50) activityFeed.lastElementChild.remove();
}

function renderStats(s){
  document.getElementById("statNodes").textContent=s.nodeCount||0;
  document.getElementById("statJobs").textContent=s.jobCount||0;
  document.getElementById("statTasks").textContent=s.taskCount||0;
  document.getElementById("statCredits").textContent=(s.creditsTotalSupply||0).toFixed(0);
}
function renderNodes(nodes){
  const b=document.getElementById("nodesBody"); b.innerHTML="";
  if(!nodes.length){ b.innerHTML=`<tr><td colspan="10" style="color:var(--text-muted)">No nodes registered.</td></tr>`; return; }
  for(const n of nodes){
    const tr=document.createElement("tr");
    const caps=(n.capabilities||[]).map(c=>`${c.type}×${c.count}`).join(", ")||"—";
    const tel=n.telemetry||{};
    const rep=(n.reputation||0).toFixed(2);
    const rc=rep>=0.8?"var(--success)":rep>=0.5?"var(--warn)":"var(--danger)";
    const conn=n.connected?"Online":"Offline";
    tr.innerHTML=`
      <td><code>${shortId(n.nodeId)}</code></td>
      <td>${esc(n.geoRegion||"unknown")}</td>
      <td style="font-size:.75rem">${esc(caps)}</td>
      <td>${tel.cpuUtil!==undefined?tel.cpuUtil.toFixed(0)+"%":"—"}</td>
      <td>${tel.gpuUtil!==undefined?tel.gpuUtil.toFixed(0)+"%":"—"}</td>
      <td>${tel.memUsedMib!==undefined?(tel.memUsedMib/1024).toFixed(1)+" GiB":"—"}</td>
      <td>${tel.activeTasks!==undefined?tel.activeTasks:0}</td>
      <td><span class="state-badge" style="color:${rc}">${rep}</span></td>
      <td><span class="state-badge ${n.connected?"state-running":"state-failed"}">${conn}</span></td>
      <td><button class="btn btn-outline" style="padding:4px 8px;font-size:.7rem" onclick="simulateHeartbeat('${esc(n.nodeId)}')">Heartbeat</button></td>
    `; b.appendChild(tr);
  }
}
function renderJobs(jobs){
  const b=document.getElementById("jobsBody"); b.innerHTML="";
  if(!jobs.length){ b.innerHTML=`<tr><td colspan="7" style="color:var(--text-muted)">No jobs.</td></tr>`; return; }
  for(const j of jobs){
    const tr=document.createElement("tr");
    tr.innerHTML=`
      <td><code>${shortId(j.id)}</code></td>
      <td>${esc(j.submitterId||"—")}</td>
      <td>${esc(j.requirements?j.requirements.computeType:"—")}</td>
      <td>${j.microWorkloads?j.microWorkloads.length:0}</td>
      <td><span class="state-badge state-${(j.state||"submitted").toLowerCase()}">${esc(j.state||"submitted")}</span></td>
      <td>${j.budgetCredits!==undefined?j.budgetCredits:0}</td>
      <td>${formatTime(j.createdAt)}</td>
    `; b.appendChild(tr);
  }
}
function renderEconomy(nodes){
  const tS=document.getElementById("econTotalSupply"),tA=document.getElementById("econAccountCount"),tT=document.getElementById("econTxCount");
  const b=document.getElementById("creditsBody"); b.innerHTML="";
  let supply=0;
  for(const n of nodes){
    const tr=document.createElement("tr");
    const rep=(n.reputation||0).toFixed(2); const stake=n.stakeCredits!==undefined?n.stakeCredits:0; supply+=stake;
    tr.innerHTML=`<td><code>${shortId(n.nodeId)}</code></td><td>${stake}</td><td><span class="state-badge">${rep}</span></td><td>${stake}</td><td>${esc(n.mode||"client")}</td>`; b.appendChild(tr);
  }
  if(tS)tS.textContent=supply.toFixed(0); if(tA)tA.textContent=nodes.length; if(tT)tT.textContent="—";
}
function renderTopology(nodes){
  const svg=document.getElementById("topologySvg"); const w=svg.clientWidth||700, h=svg.clientHeight||420; svg.innerHTML="";
  if(!nodes.length)return;
  const cx=w/2, cy=h/2, r=Math.min(w,h)*0.35; const pos=[];
  for(let i=0;i<nodes.length;i++){ const a=(i/nodes.length)*2*Math.PI+Math.PI/2; pos.push({x:cx+Math.cos(a)*(r+(Math.random()-0.5)*40),y:cy+Math.sin(a)*(r+(Math.random()-0.5)*40)}); }
  const servers=nodes.filter(n=>n.mode===NodeMode.SERVER); const eps=servers.length?servers:nodes;
  for(let i=0;i<eps.length;i++) for(let j=i+1;j<eps.length;j++){
    const ln=document.createElementNS("http://www.w3.org/2000/svg","line"); ln.setAttribute("x1",pos[i].x); ln.setAttribute("y1",pos[i].y); ln.setAttribute("x2",pos[j].x); ln.setAttribute("y2",pos[j].y); ln.setAttribute("stroke","#262c3a"); ln.setAttribute("stroke-width","1"); ln.setAttribute("opacity","0.35"); svg.appendChild(ln);
  }
  for(let i=0;i<nodes.length;i++){
    const g=document.createElementNS("http://www.w3.org/2000/svg","g"); g.setAttribute("transform",`translate(${pos[i].x},${pos[i].y})`);
    const c=document.createElementNS("http://www.w3.org/2000/svg","circle"); c.setAttribute("r",nodes[i].mode===NodeMode.SERVER?14:10); c.setAttribute("fill",nodes[i].mode===NodeMode.SERVER?varAccent(): "#64748b"); c.setAttribute("stroke",nodes[i].connected?"#22c55e":"#ef4444"); c.setAttribute("stroke-width","2"); g.appendChild(c);
    const t=document.createElementNS("http://www.w3.org/2000/svg","text"); t.setAttribute("x",0); t.setAttribute("y",nodes[i].mode===NodeMode.SERVER?20:16); t.setAttribute("text-anchor","middle"); t.setAttribute("font-family","JetBrains Mono, mono"); t.setAttribute("font-size","10"); t.setAttribute("fill","#e8eaed"); t.textContent=shortId(nodes[i].nodeId); g.appendChild(t);
    svg.appendChild(g);
  }
}
function varAccent(){ return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()||"#3b82f6"; }

function render(s){
  renderStats(s); renderNodes(s.nodes||[]); renderEconomy(s.nodes||[]); renderTopology(s.nodes||[]);
}

/* ---------- navigation ---------- */
const sections=document.querySelectorAll(".section");
const navLinks=document.querySelectorAll(".nav-link");
const menuToggle=document.getElementById("menuToggle"); const navLinksEl=document.getElementById("navLinks");
function showSection(id){ sections.forEach(s=>s.classList.remove("active")); document.getElementById(id).classList.add("active"); navLinks.forEach(l=>l.classList.toggle("active",l.dataset.section===id)); if(navLinksEl.classList.contains("open"))navLinksEl.classList.remove("open"); window.scrollTo({top:0,behavior:"smooth"}); }
navLinks.forEach(l=>l.addEventListener("click",e=>{ e.preventDefault(); showSection(l.dataset.section); }));
menuToggle.addEventListener("click",()=>navLinksEl.classList.toggle("open"));

/* ---------- sim event wiring ---------- */
sim.on("network:state",(s)=>{ render(s); });
sim.on("node:joined",(n)=>{ addActivity(`Node joined <code>${shortId(n.nodeId)}</code>`,formatTime(now())); });
sim.on("node:heartbeat",(d)=>{ const el=document.getElementById("healthHeartbeat"); if(el)el.textContent=`last ${formatTime(now())}`; });
sim.on("task:assigned",(d)=>{ addActivity(`Task <code>${shortId(d.task.id)}</code> → <code>${shortId(d.task.nodeId)}</code>`); });
sim.on("task:running",(d)=>{ addActivity(`Task running on <code>${shortId(d.nodeId)}</code>`); });
sim.on("task:completed",(d)=>{ addActivity(`Task verified <code>${shortId(d.task.id)}</code> (conf ${(d.verdict.confidence*100).toFixed(0)}%)`); });
sim.on("task:failed",(d)=>{ addActivity(`Task failed <code>${shortId(d.taskId)}</code>: ${esc(d.reason||"unknown")}`); });
sim.on("task:reassigned",(d)=>{ addActivity(`Task reassigned → <code>${shortId(d.newTask.nodeId)}</code>`); });
sim.on("job:submitted",(d)=>{ addActivity(`Job <code>${shortId(d.job.id)}</code> — ${d.job.numPartitions} partitions`); });

/* ---------- actions ---------- */
async function registerNode(){
  const geo=prompt("Geo region:","us-east"); if(geo===null)return;
  const caps=prompt("Capabilities (cpu:2,gpu:1):","cpu:2,gpu:1"); if(caps===null)return;
  const capList=caps.split(",").map(c=>{const[t,count=1]=c.trim().split(":"); return{type,count:parseInt(count)||1};}).filter(c=>c.type);
  const res=sim.registerNode({geoRegion:geo,capabilities:capList,mode:NodeMode.CLIENT,sandboxTypes:[SandboxType.WASM],stakeCredits:10});
  addActivity(`Registered <code>${shortId(res.nodeId)}</code>`);
  render(sim.snapshot());
}
function seedDemo(){
  sim.registerNode({nodeId:"node:alpha",geoRegion:"us-east",capabilities:[new Capability({type:ComputeType.CPU,count:4}),new Capability({type:ComputeType.GPU,count:1})],mode:NodeMode.SERVER,sandboxTypes:[SandboxType.WASM,SandboxType.FIRECRACKER],stakeCredits:50});
  sim.registerNode({nodeId:"node:beta",geoRegion:"eu-west",capabilities:[new Capability({type:ComputeType.CPU,count:8}),new Capability({type:ComputeType.GPU,count:2})],mode:NodeMode.CLIENT,sandboxTypes:[SandboxType.WASM],stakeCredits:30});
  sim.registerNode({nodeId:"node:gamma",geoRegion:"ap-south",capabilities:[new Capability({type:ComputeType.CPU,count:2}),new Capability({type:ComputeType.TPU,count:1})],mode:NodeMode.CLIENT,sandboxTypes:[SandboxType.WASM],stakeCredits:20});
  for(const id of sim.nodes.keys()) sim.heartbeat(id,{seq:1});
  addActivity("Demo network seeded with 3 nodes");
  render(sim.snapshot());
}
function showJobForm(){ document.getElementById("jobFormCard").style.display="block"; document.getElementById("jobFormCard").scrollIntoView({behavior:"smooth"}); }
function hideJobForm(){ document.getElementById("jobFormCard").style.display="none"; }
document.getElementById("jobForm").addEventListener("submit",async(e)=>{
  e.preventDefault(); const fd=new FormData(e.target);
  const body={ submitterId:fd.get("submitterId"), requirements:{ computeType:fd.get("computeType"), minCores:parseInt(fd.get("minCores")||1), minMemMib:parseInt(fd.get("minMemMib")||512), minGpuMemMib:parseInt(fd.get("minGpuMemMib")||0), maxLatencyMs:parseInt(fd.get("maxLatencyMs")||5000), geoRegion:[], privacyLevel:fd.get("privacyLevel") }, numPartitions:parseInt(fd.get("numPartitions")||1), requiresSequential:fd.get("requiresSequential")==="true", estimatedRuntimeS:parseInt(fd.get("estimatedRuntimeS")||300), budgetCredits:parseInt(fd.get("budgetCredits")||1000), privacyLevel:fd.get("privacyLevel"), verificationMethod:fd.get("verificationMethod") };
  try{ const res=sim.submitJob(body); addActivity(`Job submitted <code>${shortId(res.job.id)}</code> — ${res.job.numPartitions} partitions`); hideJobForm(); e.target.reset(); }catch(err){ alert("Failed: "+err.message); }
});
function simulateHeartbeat(nodeId){ sim.heartbeat(nodeId,{seq:++sim._seq}); addActivity(`Heartbeat <code>${shortId(nodeId)}</code>`); }

// start simulation
sim.start();
render(sim.snapshot());
addActivity("NEXUS simulation started — register nodes or seed a demo network.");
