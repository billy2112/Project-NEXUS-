requirements:
  - Python 3.9+
  - No external dependencies (stdlib-only skeleton)

Run the demo:
  python -m nexus.node_app

Extend:
  - Wire `discovery.Discovery` to libp2p Kademlia + GossipSub
  - Replace `executor.StubSandbox` with wasmtime / Firecracker / Docker
  - Replace `verification.Verifier` stubs with real zk-SNARK/STARK verification
  - Add a credit ledger and reputation-weighted governance
