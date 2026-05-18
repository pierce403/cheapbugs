# Deployment Manifests

This directory stores reproducible CheapBugs contract-suite deployment records.

The Node launcher writes `base-8453/cheapbugs-contract-suite.latest.json` on every dry run or real deployment. Real deployments also write an address-specific manifest named `cheapbugs-contract-suite.<index-address>.json`.

Each manifest records:

- the Base chain id and redacted RPC origin
- deployer address and key source, without private keys
- final owner and initial role lists
- Foundry, Node, npm, compiler, optimizer, and `via_ir` settings
- source, package lock, and generated-artifact hashes
- constructor arguments and explorer verification command inputs
- deployment transaction hashes and gas data for real broadcasts

Full generated Foundry contract artifacts are committed under `base-8453/generated/`. The `latest` directory reflects the most recent dry run or deployment, and real deployments also get an index-address-specific generated-artifact directory.

Private keys, explorer API keys, and full RPC URLs must not be recorded here.
