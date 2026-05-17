# CheapBugs - Features

This is the living feature map for CheapBugs. It follows the FEATURES.md pattern: each feature declares stability, testable properties, and verification criteria for humans and coding agents.

Update this file whenever feature behavior, system boundaries, deployment assumptions, integrations, or test expectations materially change.

## Project Map

CheapBugs is a static Vite + TypeScript application with Solidity contracts, Node and Foundry deployment scripts, Playwright browser tests, and an optional Python XMTP broker bot.

```text
cheapbugs/
├── bots/                   # Python broker bot package and tests
├── contracts/              # Solidity bug index and BUGZ extension contracts
├── script/                 # Foundry deployment scripts
├── scripts/                # Deployment, XMTP, and maintenance scripts
├── test/                   # Foundry contract tests
├── tests/                  # Playwright browser tests
├── lib/                    # Foundry libraries
├── public/                 # Static assets and SPA hosting helpers
├── src/
│   ├── attest/             # EAS write adapters
│   ├── auth/               # Thirdweb and local XMTP identity helpers
│   ├── config/             # chain, env, reviewer, and integration config
│   ├── contracts/          # frontend contract ABI and adapters
│   ├── lib/                # domain logic, crypto, IPFS, caching, utilities
│   ├── storage/            # storage-provider implementations
│   ├── types/              # domain and integration types
│   ├── xmtp/               # browser XMTP identity and broker DM helpers
│   └── views/              # route-level UI rendering
├── README.md
├── DEPLOY.md
├── TODO.md
├── AGENTS.md
├── SECURITY.md
└── FEATURES.md
```

## System Boundaries

- The hosted app is static assets from `dist/`; do not add SSR or an app-owned backend database.
- Public-safe report metadata is stored on Base in `CheapBugsBugIndex`.
- Sensitive dossier content must be encrypted in the browser before IPFS upload on the legacy path.
- XMTP broker submissions are private XMTP DMs to the broker and are not encrypted into IPFS by the static app path.
- Reviewer verdicts are EAS attestations on Base and are read through EAS GraphQL.
- The Python broker is an optional off-static runtime with SQLite state; it does not change the frontend deployment model.

## Features

### Static Web App Shell

- **Stability**: stable
- **Description**: Vite/TypeScript browser app with routes for `index`, `submit`, `review`, `token`, and `patrons`, a compact header session area, a GitHub icon link, build metadata, and a centralized development banner.
- **Properties**:
  - The first screen is the usable app, not a landing page.
  - Header login/session controls remain compact and do not reintroduce old chain/storage/wallet/SIWE debug rows.
  - Header build metadata shows the bundle commit hash and formats build time in the viewer's local timezone.
  - The development banner text is centralized in `src/app.ts`.
- **Test Criteria**:
  - [x] `npm run build` compiles the static app.
  - [x] `npm run test:e2e` covers the development banner, GitHub brand icon, and build metadata.

### Wallet Auth And Local XMTP Identity

- **Stability**: in-progress
- **Description**: Thirdweb wallet login with injected-wallet SIWE, WalletConnect QR fallback, session restore, ENS display, and site-generated local XMTP wallet identities.
- **Properties**:
  - `VITE_THIRDWEB_CLIENT_ID` has a committed public default for static deploys.
  - External wallet reconnect hints are stored in `cheapbugs.walletSession.v1`; SIWE proofs are stored in `cheapbugs.siweSession.v1`.
  - Local XMTP identities are stored in `cheapbugs.localXmtpIdentity.v1` and can sign XMTP messages and Base transactions.
  - ENS avatars are read from the raw `avatar` text record and sanitized to HTTPS or IPFS gateway URLs.
  - ENS profile results cache in `cheapbugs.ensProfileCache.v1` for 24 hours so page reloads do not re-query mainnet ENS, with a profile-modal refresh button for manual cache bypass.
- **Test Criteria**:
  - [x] Playwright covers ENS-backed profile modal behavior, avatar URL handling, local ENS cache reuse, and manual ENS refresh.
  - [x] `npm run build` catches Thirdweb/XMTP integration type drift.

### Onchain Bug Index

- **Stability**: stable
- **Description**: `CheapBugsBugIndex` stores public-safe report metadata and future reviewer vote data on Base.
- **Properties**:
  - Public records include report hash, report id, reporter, created time, disclosure mode, public summary, encrypted payload CID, target kind, target hash, tags, and private content hash.
  - Contract-specific values stay behind `src/config/chains.ts`, `src/config/env.ts`, and `src/contracts/bugIndex.ts`.
  - Launcher scripts refresh frontend ABI files after compilation.
- **Test Criteria**:
  - [x] `npm run contracts:build` compiles Solidity contracts.
  - [x] `npm run contracts:test` covers report submission and reviewer vote scenarios.
  - [x] `npm run launch:bug-index:dry-run` validates the Node launcher.
  - [x] `npm run launch:bug-index:forge:dry-run` validates the Foundry launcher.

### Legacy Encrypted IPFS Submission Path

- **Stability**: in-progress
- **Description**: Browser builds `SubmissionPrivate` and `SubmissionPublic`, encrypts private dossier JSON, uploads it through a storage provider, and files the public record onchain.
- **Properties**:
  - Private dossier content is encrypted before leaving the browser.
  - Pinata credentials never enter browser code; Pinata uploads require presigned URLs.
  - The default IPFS gateway provider can read JSON but cannot upload.
  - All IPFS content is untrusted input.
- **Test Criteria**:
  - [x] `npm run build` type-checks storage and crypto paths.
  - [ ] Add browser coverage for a mocked encrypted submission once the legacy path becomes primary again.

### XMTP Broker Submission

- **Stability**: in-progress
- **Description**: The submit route sends bug submissions as strict JSON XMTP DMs to the default broker wallet `0xea6995fc3674e1e94736766f5eeefb0506e4ef32`.
- **Properties**:
  - `VITE_BROKER_XMTP_ADDRESS` overrides the default broker wallet only when a different broker is needed; `VITE_BOUNCER_XMTP_ADDRESS` is a legacy alias.
  - The frontend form currently collects only title, public summary, and private details; repro steps, evidence, severity, Signal recipient, contact hints, target fields, tags, and review access keys are intentionally not user-facing.
  - The frontend sends schema `cheapbugs.bug_submission.v1`, version `1`, type `submission`, reporter address, title, public summary, private details, and client metadata.
  - The frontend does not yet attach a reporter signature over the submission payload; broker-relayed onchain attribution must stay disabled until the reporter-signed relay feature exists.
  - The submit route shows an inline XMTP status indicator for wallet/signing readiness, send progress, success, and failure.
  - The submit route opens a wallet-signature waiting modal while an external wallet or WalletConnect device must approve XMTP registration.
  - XMTP submission status persists across incidental app rerenders so wallet registration progress and failures are not hidden by header/session updates.
  - Browser XMTP registration skips redundant registration for already-registered installations and surfaces wallet-signature progress before any broker DM is attempted.
  - The submit button remains clickable when disconnected so the form can explain the missing XMTP wallet instead of appearing inert.
  - The broker owns review-key generation and retention for this flow.
  - The broker rejects malformed JSON, missing required core fields, unexpected fields, invalid provided target references, and invalid reporter credentials.
  - The broker replies over XMTP after each successful validation stage: JSON valid, fields well formed, target valid, credentials valid.
  - Submission credential checks use `BROKER_SUBMISSION_MIN_BUGZ` and `BROKER_REPUTATION_BLOCKLIST`; the old `BOUNCER_*` names are accepted as aliases.
- **Test Criteria**:
  - [x] Python unit tests cover strict JSON parsing, required fields, target validation, staged replies, and credential failure.
  - [x] Playwright covers the default broker wallet, inline XMTP status, disconnected submit feedback, and structured XMTP submit UI.
  - [ ] Add reporter-signed payload envelopes before the broker can submit user-attributed records onchain.
  - [ ] End-to-end live XMTP inbox testing is still manual because it requires registered XMTP wallets.

### Reporter-Signed Broker Relay

- **Stability**: planned, not implemented
- **Description**: Let the broker pin private submission material to IPFS and optionally submit EAS or bug-index records without being able to forge reports from other users.
- **Properties**:
  - The browser must create a canonical submission payload hash and an EIP-712 signature from the reporter before sending the XMTP message.
  - The signed message must bind at least schema, version, reporter, broker wallet, Base chain id, bug-index contract address, payload hash, created time, and a nonce or deadline.
  - The broker may transform storage details, pin IPFS, and pay gas, but it must not be able to choose or alter the reporter address accepted by the registry.
  - `CheapBugsBugIndex` must reject broker-relayed submissions unless the reporter signature recovers to the claimed reporter, or validates through EIP-1271 if contract-wallet support is added.
  - The contract must prevent replay of the same signed submission across brokers, chains, contracts, or duplicate report hashes.
  - XMTP sender identity is useful broker-side evidence, but it is not enough for the smart-contract-level anti-forgery claim.
  - Private plaintext details must never be placed onchain; onchain records should contain public metadata, IPFS CIDs or commitments, and content hashes only.
- **Test Criteria**:
  - [ ] Contract tests prove a broker cannot submit a forged report for an arbitrary reporter.
  - [ ] Contract tests prove valid reporter signatures are accepted through the broker-relay path.
  - [ ] Contract tests prove wrong broker, wrong chain/contract domain, expired/deadline, and replayed submissions fail.
  - [ ] Browser tests cover the signature prompt and envelope generation.
  - [ ] Broker tests verify signed envelopes before any IPFS, EAS, or bug-index write.

### Python Broker Bot

- **Stability**: in-progress
- **Description**: Optional Python runtime receives XMTP DMs, validates commands, relays accepted submissions to a private Signal group, stores broker state in SQLite, tracks Signal reactions, and pays BUGZ rewards.
- **Properties**:
  - Runtime config comes from `BROKER_*` environment variables and `BrokerConfig`, with `BouncerConfig` kept as a compatibility alias.
  - `BOUNCER_*` environment variables and `scripts/bouncer-bot.py` are compatibility aliases for older local configs.
  - SQLite tracks processed XMTP message IDs, relayed submissions, Signal message timestamps, active reactions, settlement status, reward amounts, and payout transaction hashes.
  - Signal access requests are gated by `BROKER_ACCESS_MIN_BUGZ`.
  - Live payouts require `BUGZ_PAYOUT_PRIVATE_KEY` and should run only from an intentionally funded wallet.
- **Test Criteria**:
  - [x] `python3 -m unittest discover -s bots/tests -t bots` covers command parsing, staged broker validation, SQLite maturity, reaction parsing, and reward math.
  - [x] `python3 -m compileall bots scripts/broker-bot.py scripts/bouncer-bot.py` checks Python syntax.
  - [ ] Add integration smoke tests with a disposable XMTP wallet and Signal group before production broker launch.

### EAS Reviewer Verdicts

- **Stability**: in-progress
- **Description**: Reviewers write verdict attestations to EAS on Base; the frontend reads verdict state from EAS GraphQL.
- **Properties**:
  - `@ethereum-attestation-service/eas-sdk` is intentionally not used because it pulled Hardhat-era dependencies into npm audit.
  - Writes use direct ethers contract calls in `src/attest/eas.ts`.
  - `ReviewVerdict` is active; `PayoutRecord` remains a placeholder for future public payout records.
- **Test Criteria**:
  - [x] `npm run build` type-checks EAS reads/writes.
  - [ ] Add browser tests for mocked verdict submission once schema UIDs are stable in test config.

### BUGZ Token And Trading

- **Stability**: in-progress
- **Description**: The `/token` route reads BUGZ balances and performs browser-signed Uniswap v4 buy/sell swaps on Base.
- **Properties**:
  - BUGZ defaults to Base token `0x60Df4a0C9A5050c337010cb29C9694cE4d8fbb07`.
  - Buy/sell uses the Clanker-created Uniswap v4 WETH/BUGZ pool key, v4 Quoter, and Universal Router 2.1.1.
  - Buy wraps ETH through the router; sell requires ERC20 plus Permit2 approvals.
  - Trading does not depend on `VITE_BUGZ_TREASURY_ADDRESS`.
- **Test Criteria**:
  - [x] `npm run build` type-checks trade adapters.
  - [ ] Add mocked router/quote Playwright coverage for buy/sell form states.

### Patrons Leaderboard

- **Stability**: in-progress
- **Description**: `/patrons` shows a daily-cached BUGZ holder leaderboard using Etherscan V2 holder data when configured, with a Base RPC Transfer-log fallback.
- **Properties**:
  - Holder snapshots cache in localStorage for 24 hours.
  - The home page patron preview is cache-only and must not trigger fresh scans.
  - The RPC fallback reads 10,000-block Transfer-log pages from `VITE_BUGZ_TOKEN_DEPLOYMENT_BLOCK`.
  - RPC failures render setup guidance for `VITE_ETHERSCAN_API_KEY` or `VITE_BASESCAN_API_KEY`.
- **Test Criteria**:
  - [x] Playwright covers RPC-safe paging, cache reuse, manual refresh, and API-key guidance.

### GitHub Pages Deployment

- **Stability**: stable
- **Description**: GitHub Actions builds `dist/` and deploys to GitHub Pages for the `cheapbugs.net` custom domain.
- **Properties**:
  - Pages uses workflow-based publishing, not legacy branch publishing.
  - Production custom-domain deployments use root-relative Vite base paths.
  - Hash routing is supported for SPA compatibility.
  - Only set `VITE_BASE_PATH` when deploying under a non-root subpath.
- **Test Criteria**:
  - [x] `.github/workflows/deploy-pages.yml` builds the app with GitHub Pages settings.
  - [x] `npm run build` validates local production assets.

### Development Tooling

- **Stability**: stable
- **Description**: Local commands cover frontend, browser, contract, launcher, and broker validation.
- **Properties**:
  - `forge-std` is tracked as `lib/forge-std`; fresh clones need `git submodule update --init --recursive`.
  - The XMTP browser SDK needs the Vite alias and `scripts/fix-xmtp-wasm-worker.mjs` sqlite worker shim.
  - `artifacts/` and `dist/` are generated outputs and should not be committed unless explicitly requested.
- **Test Criteria**:
  - [x] `npm install`
  - [x] `npm run build`
  - [x] `npm run test:e2e`
  - [x] `npm run contracts:build`
  - [x] `npm run contracts:test`
  - [x] `python3 -m unittest discover -s bots/tests -t bots`
  - [x] `python3 -m compileall bots scripts/broker-bot.py scripts/bouncer-bot.py`

## External Integrations

- **Base RPC**: contract reads, writes, BUGZ balances, holder scans, deployments.
- **Thirdweb**: installed-wallet login, WalletConnect QR, signer adapters.
- **ENS**: mainnet name/avatar resolution for session UI.
- **IPFS / Pinata**: encrypted dossier storage and gateway reads.
- **EAS**: reviewer verdict attestations and indexed reads.
- **XMTP**: browser-to-broker report submission and broker replies.
- **Signal**: private reviewer channel relay and reaction source.
- **Uniswap v4 / Clanker**: browser-signed BUGZ market trading.
- **Foundry**: contract builds, tests, and Solidity-native deployment.

## Verification Commands

```bash
npm install
npm run dev
npm run build
npm run test:e2e
npm run contracts:build
npm run contracts:test
npm run launch:bug-index:dry-run
npm run launch:bug-index:forge:dry-run
npm run launch:token:dry-run
python3 -m unittest discover -s bots/tests -t bots
python3 -m compileall bots scripts/broker-bot.py scripts/bouncer-bot.py
```

## Future Milestones

- Implement reporter-signed broker relay before allowing broker-created user-attributed bug-index records.
- Replace frontend reviewer allowlist with an onchain reviewer registry or resolver-backed trust model.
- Add public payout records for broker settlements while keeping `PayoutRecord` as the public record layer.
- Add live XMTP broker smoke tests with disposable identities.
- Add mocked browser tests for verdict submission and BUGZ trading workflows.
- Reduce WalletConnect/XMTP bundle size with route or adapter-level code splitting.
- Add automated CI and ABI drift checks.

## Project Identification

- **Project Name**: CheapBugs
- **Repository URL**: `git@github.com:pierce403/cheapbugs.git`
- **Primary Contact/Team**: `pierce403`
- **Date of Last Update**: 2026-05-17
