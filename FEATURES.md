# CheapBugs - Features

This is the living feature map for CheapBugs. It follows the FEATURES.md pattern: each feature declares stability, testable properties, and verification criteria for humans and coding agents.

Update this file whenever feature behavior, system boundaries, deployment assumptions, integrations, or test expectations materially change.

## Project Map

CheapBugs is a static Vite + TypeScript application with Solidity contracts, Node and Foundry deployment scripts, Playwright browser tests, and an optional Python XMTP broker bot.

```text
cheapbugs/
├── bots/                   # Python broker bot package and tests
├── contracts/              # Solidity bug index, bond vault, and treasury vault contracts
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
├── run-broker.sh
├── AGENTS.md
├── SECURITY.md
└── FEATURES.md
```

## System Boundaries

- The hosted app is static assets from `dist/`; do not add SSR or an app-owned backend database.
- Public-safe report metadata is stored on Base in `CheapBugsBugIndex`, which now accepts broker-published records only when backed by a reporter EIP-712 signature.
- The verified Base deployment is `CheapBugsBugIndex` `0x515FDbc9876aC26870794E26605c7DD04c18679b`, `CheapBugsBondVault` `0x2Eab99B6d6F1FBDa4fa78a00662E0cf9aBd9f3d3`, and `CheapBugsTreasuryVault` `0x4A080668d9848928dc6D48921cbDc4273fe27A9d`.
- BUGZ bonds are held in `CheapBugsBondVault`; pending withdrawals remain slashable through the 7-day delay.
- Detail-key purchases and ordered broker rewards settle through `CheapBugsTreasuryVault`.
- The vaults hardcode the live Base BUGZ token address `0x60Df4a0C9A5050c337010cb29C9694cE4d8fbb07`; this repo no longer deploys a BUGZ token contract.
- XMTP broker submissions are private XMTP DMs to the broker; the browser builds an encrypted `BugBundle`, signs a contract-verifiable EIP-712 `PublishBug` authorization, sends the out-of-bundle reveal key to the broker, and the broker verifies, pins the bundle through local Kubo IPFS, then calls `CheapBugsBugIndex.publishBug`.
- The remaining broker lifecycle work is post-window details-key reveal and ordered payout completion through the bug index.
- Reviewer verdicts are EAS attestations on Base and are read through EAS GraphQL.
- The Python broker is an optional off-static runtime with SQLite state; it does not change the frontend deployment model.

## Features

### Static Web App Shell

- **Stability**: stable
- **Description**: Vite/TypeScript browser app with routes for `index`, `submit`, `review`, `token`, and `patrons`, a compact header session area, a GitHub icon link, build metadata, and a centralized development banner.
- **Properties**:
  - The first screen is the usable app, not a landing page.
  - Header login/session controls remain compact and do not reintroduce old chain/storage/wallet/SIWE debug rows.
  - Connected-wallet header BUGZ status shows `bugz: loading` before balance reads complete and logs a high-visibility console error if the read resolves unavailable.
  - Header BUGZ status only reads the connected wallet BUGZ balance; it must not load token metadata, treasury BUGZ, or treasury native ETH on ordinary route changes.
  - Browser contract adapters dedupe in-flight Base RPC reads, cache successful reads briefly, and apply a short cooldown after rate-limit errors.
  - Header build metadata shows the bundle commit hash and formats build time in the viewer's local timezone.
  - The development banner text is centralized in `src/app.ts`.
- **Test Criteria**:
  - [x] `npm run build` compiles the static app.
  - [x] `npm run test:e2e` covers the development banner, GitHub brand icon, build metadata, header BUGZ status states, and that ordinary routes do not trigger treasury dashboard reads.

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

### CheapBugs Bond Vault

- **Stability**: in-progress
- **Description**: `CheapBugsBondVault` escrows live Base BUGZ bonds used for CheapBugs reputation and weighted bug voting.
- **Properties**:
  - Users bond BUGZ with `bond(amount)`.
  - Withdrawals are two-step: `requestWithdrawal(amount)` moves active bond into pending withdrawal, then `withdraw()` releases it only after 7 days.
  - Any new bond from the same user cancels pending withdrawals and restores the pending amount to active bond before adding the new BUGZ.
  - Pending withdrawals remain slashable so users cannot immediately escape after bad behavior.
  - Owner-managed slashers can slash a percentage of active plus pending bond in basis points; slashed BUGZ transfers directly to the configured treasury.
  - `bondOf(account)` returns total slashable exposure, `activeBondOf(account)` returns voting-eligible bond, and `getLevel(account)` returns `floor(log10(active whole BUGZ))`.
  - Pending withdrawals are excluded from `getLevel`; balances below 10 whole BUGZ produce level 0 and cannot add nonzero vote weight.
  - Current bonded addresses are enumerable with `bondedAddressCount`, `bondedAddressAt`, and `bondedAddressList`.
- **Test Criteria**:
  - [x] Forge unit tests cover bonding, two-step withdrawal, withdrawal cancellation, pending-withdrawal slashing, slasher permissions, full slash removal, and address enumeration.
  - [x] Forge fuzz tests cover level math and percentage slash accounting.
  - [x] Forge invariant tests prove the vault's BUGZ balance equals the listed active-plus-pending bond exposure across randomized bond, withdrawal, cancellation, and slash sequences.

### CheapBugs Treasury Vault

- **Stability**: in-progress
- **Description**: `CheapBugsTreasuryVault` holds live Base BUGZ treasury funds, records detail-key purchases, and pays reporter rewards when called by the index.
- **Properties**:
  - Users can deposit BUGZ into the treasury and buy detail-key access with `purchaseDetailKey(reportHash, amount)`.
  - Detail-key purchases transfer BUGZ into the treasury, update `detailKeyPayments(reportHash, buyer)`, and append enumerable purchase records for broker verification.
  - The owner sets the authorized bug index with `setIndex`.
  - The owner manages treasury brokers independently from the index broker list.
  - Reward disbursement is only callable by the configured index through `payRewardFromIndex(broker, recipient, multiplier)`.
  - `payRewardFromIndex` also verifies the broker is authorized by the treasury, so payout authority requires both the index and treasury to trust the broker.
  - Standard payout is `BUGZ balance / standardPayoutDivisor`, defaulting to 1000. The owner can adjust the divisor to any nonzero value.
  - Broker multipliers are capped at 10. A multiplier of 0 records a zero-payout completion.
- **Test Criteria**:
  - [x] Forge unit tests cover deposits, detail-key purchase accounting, broker list management, index-only payouts, treasury broker checks, divisor changes, multiplier caps, and reward transfers.
  - [x] Forge fuzz tests cover payout math across balances, divisors, and multipliers.

### Onchain Bug Index

- **Stability**: in-progress
- **Description**: `CheapBugsBugIndex` stores broker-published, reporter-signed bug records; coordinates details-key reveal, bonded voting, admin status guidance, and ordered payouts.
- **Properties**:
  - Only owner-authorized brokers can publish bugs.
  - Published records require a reporter EIP-712 signature over the report fields, broker address, nonce, deadline, BugBundle hash, encrypted details hash, details-key commitment, and reveal time. The broker-produced IPFS CID is stored but is not in the signature because it is known only after pinning.
  - Reporter nonces are one-time use, signatures expire at their deadline, and signatures bind the broker and index domain.
  - The index requires `revealAfter` to be at least 7 days after onchain publication.
  - Submitter-built BugBundles sign a reveal time 7 days plus a 1-hour publish buffer after browser creation so broker validation, IPFS pinning, and transaction mining do not make the signed reveal window too short.
  - Public records include report hash, report id, reporter, created time, disclosure mode, public summary, BugBundle CID, target kind, target hash, tags, content hash, BugBundle hash, encrypted details hash, details-key commitment, reveal status, admin status, and payout state.
  - The stored details-key commitment is SHA-256 over the raw 32-byte key. Brokers reveal the raw `bytes32` key after the 7-day window.
  - Owner-managed admins can flag bugs as `Valid`, `Invalid`, or `Spam`; payout completion requires an admin status.
  - Bonded users can vote up or down before the reveal window closes. Vote weight is snapshotted at vote time from `CheapBugsBondVault.getLevel(voter)`.
  - Bug payouts must be completed in report order. Only an authorized broker can complete payout, and invalid or spam bugs require a zero multiplier.
  - On payout completion, the index reveals the details key if needed, calls `CheapBugsTreasuryVault.payRewardFromIndex`, stores the paid amount/multiplier, and advances the payout cursor.
  - Contract-specific values stay behind `src/config/chains.ts`, `src/config/env.ts`, and `src/contracts/bugIndex.ts`.
  - Direct browser-to-index submission is disabled; `src/contracts/bugIndex.ts` keeps read helpers and exposes no direct write helper.
  - The frontend defaults to the verified Base contract suite, so new broker-published bugs can be read into index/recent-report views without requiring `VITE_BUG_INDEX_ADDRESS` in local env.
  - Recent-report reads use short in-memory caching and in-flight request reuse so route changes do not repeatedly call `latestReportHashes`/`getReport`.
  - Launcher scripts refresh frontend ABI files after compilation, deploy/wire `CheapBugsBondVault`, `CheapBugsTreasuryVault`, and `CheapBugsBugIndex` together, check the deployed wiring, and verify all three contracts on Etherscan/BaseScan by default for real deployments.
  - The Node launcher writes tracked deployment manifests and generated contract artifacts under `deployments/base-8453/`, including compiler/tool versions, optimizer and `via_ir` settings, source/package hashes, constructor arguments, transaction logs for broadcasts, verification command inputs, and generated ABI/bytecode artifacts.
  - Launchers use `BUG_INDEX_DEPLOYER_PRIVATE_KEY` when set; otherwise they deploy from `BROKER_KEY`, seed that broker as the initial broker when no broker list is provided, and transfer ownership to `0x7ab874Eeef0169ADA0d225E9801A3FfFfa26aAC3` by default.
- **Test Criteria**:
  - [x] `npm run contracts:build` compiles Solidity contracts.
  - [x] `npm run contracts:test` covers broker publication, reporter signatures, nonce replay, deadline expiry, reveal timing, details-key commitment checks, admin status, bonded voting, ordered payouts, zero-payout invalid bugs, treasury broker removal, role abuse, and treasury transfer integration.
  - [x] Forge fuzz tests cover reveal-window rejection, bonded-vote weight math, and payout multiplier math.
  - [x] `npm run launch:bug-index:dry-run` validates the Node launcher and frontend ABI refresh.
  - [x] `npm run launch:bug-index:forge:dry-run` validates the Foundry launcher.
  - [x] Real launchers require an Etherscan/BaseScan API key for default contract verification unless `BUG_INDEX_VERIFY_CONTRACTS=0` is explicitly set.
  - [x] Launchers support `BROKER_KEY` as the deployer fallback and keep final ownership separate from the funded deployer.
  - [x] Playwright covers the home route loading `latestReportHashes`/`getReport` from the configured index and rendering newly indexed bugs in `[ recent reports ]`.
  - [x] `deployments/base-8453/cheapbugs-contract-suite.latest.json` and `deployments/base-8453/generated/latest/*.json` provide committed reproducibility records without private keys or explorer API keys.

### Removed Direct Submission Path

- **Stability**: removed
- **Description**: The old browser path that encrypted private dossier JSON, uploaded it directly, and attempted a browser-to-index write has been removed from the active API surface.
- **Properties**:
  - Direct browser-to-index writes are not exposed from `src/contracts/bugIndex.ts`.
  - New submissions must go through the XMTP broker flow with a reporter EIP-712 `PublishBug` authorization.
  - Storage helpers remain for reading existing encrypted content and writing review notes, but not for direct bug-index submission.
- **Test Criteria**:
  - [x] `npm run build` type-checks the removed write surface.

### XMTP Broker Submission

- **Stability**: in-progress
- **Description**: The submit route sends bug submissions as strict JSON XMTP DMs to the default broker wallet `0xea6995fc3674e1e94736766f5eeefb0506e4ef32`.
- **Properties**:
  - `VITE_BROKER_XMTP_ADDRESS` overrides the default broker wallet only when a different broker is needed.
  - The frontend form collects bug type, severity, target interest, title, public summary, and private details. Repro steps, evidence, Signal recipient, contact hints, target kind/reference fields, tags, and review access keys are intentionally not user-facing.
  - Bug type is a malleable broker-triage hint with current values `0day`, `nday`, `web`, `web3`, `net`, and `intel`.
  - Severity and target interest are malleable broker-triage hints with current slider values `low`, `medium`, `high`, and `critical`.
  - The submit route validates broker text-field limits before wallet, XMTP, or PublishBug signing work starts: title 3-120 characters, public summary 10-2,000 characters, and private details 10-12,000 characters after trimming.
  - The frontend sends schema `cheapbugs.bug_submission.v1`, version `1`, type `submission`, reporter address, broker address, `bug_type`, `severity`, `target_interest`, title, public summary, broker-triage target defaults, client metadata, an encrypted `bug_bundle`, a reporter EIP-712 `publish_authorization`, and an out-of-bundle `details_key`.
  - The frontend generates the random details key, encrypts details into the BugBundle with AES-256-GCM, hashes the canonical BugBundle core, and signs the `PublishBug` EIP-712 message that the index verifies. The signed `revealAfter` is 7 days plus a 1-hour publish buffer after bundle creation.
  - The submit route shows an inline XMTP status indicator for wallet/signing readiness, send progress, success, and failure.
  - The submit route shows a processing-submission modal while broker XMTP submission work is in progress, keeps it open across broker status replies, treats IPFS pinning as progress, and only marks the submission complete after the broker confirms live onchain publication or an explicit broker dry run.
  - The submit route opens a wallet-signature waiting modal while an external wallet or WalletConnect device must approve either XMTP registration or the `PublishBug` authorization signature.
  - XMTP submission status persists across incidental app rerenders so wallet registration progress and failures are not hidden by header/session updates.
  - Browser XMTP registration skips redundant registration for already-registered installations and surfaces wallet-signature progress before any broker DM is attempted.
  - The submit button remains clickable when disconnected so the form can explain the missing XMTP wallet instead of appearing inert.
  - The broker verifies the BugBundle and publish authorization before pinning: schema, fields, reporter/broker/chain/index binding, EIP-712 signature recovery, key commitment, encrypted details hash, AAD, and successful details decryption.
  - In live mode, the broker preflights `revealAfter` before IPFS pinning and rejects bundles that can no longer satisfy the index's 7-day-from-publication minimum.
  - The broker rejects malformed JSON, missing required core fields, unexpected fields, invalid bug type or rating values, invalid or missing publish authorizations, invalid provided target references, and invalid reporter credentials.
  - The broker sends plain text XMTP status messages after each successful validation stage: JSON valid, fields well formed, publish authorization/details valid, target valid, credentials valid, IPFS pinned, and bug-index published or dry-run complete.
  - Incoming XMTP text or JSON flow types that do not match a recognized broker flow receive `hello.` as a liveness reply and are marked processed. Recognized but malformed submission/access flows keep their validation-error replies.
  - After IPFS pinning, the broker maps the verified `PublishBug` authorization and pinned BugBundle URI into `CheapBugsBugIndex.publishBug`, checks broker authorization and gas funding before broadcast, waits for a receipt, and records the report hash plus index transaction hash in SQLite.
  - If bug-index publication fails after IPFS pinning, the broker records an `index_failed` submission with the pinned CID and returns an XMTP error that includes the actionable publish failure. Known index custom errors such as `InvalidRevealAfter`, `RevealNotReady`, and `SignatureExpired` are decoded into timestamped guidance.
  - Broker status messages intentionally avoid XMTP reply-content encoding so the submission flow does not depend on nonessential reply-content codec behavior.
  - After sending the submission DM, the browser waits for broker plain text replies in the same XMTP conversation. `Submission complete: Bug published onchain...`, `Submission complete: Bug already exists onchain...`, or `Submission complete: Bug index dry-run complete...` is treated as terminal success; target, credential, JSON, IPFS, or bug-index publish failure replies are terminal errors.
  - Submission credential checks use `BROKER_SUBMISSION_MIN_BUGZ` and `BROKER_REPUTATION_BLOCKLIST`.
- **Test Criteria**:
  - [x] Python unit tests cover strict JSON parsing, required fields, publish-authorization bundle-hash validation, BugBundle failure handling, real encrypted bundle verification in the broker venv, target validation, staged status messages, credential failure, live reveal-window preflight, bug-index publish call shaping, decoded publish failures, and dry-run handling.
  - [x] Python unit tests cover `hello.` liveness replies for unrecognized XMTP text and JSON flow types.
  - [x] Playwright covers the default broker wallet, inline XMTP status, broker field-size validation before wallet checks, disconnected submit feedback, field ordering, PublishBug-signature wait modal, and structured XMTP submit UI including IPFS-progress and onchain-completion modal states.
  - [x] Browser and broker code create and verify the EIP-712 `PublishBug` envelope required by the bug index.
  - [ ] End-to-end live XMTP inbox testing is still manual because it requires registered XMTP wallets.

### BugBundle IPFS Reveal Model

- **Stability**: in-progress
- **Description**: A submitted bug becomes one versioned `BugBundle` JSON object pinned to IPFS, with public metadata, broker-triage guidance, and encrypted details. The reporter's EIP-712 publish authorization travels in the XMTP command and is verified before pinning.
- **Properties**:
  - The bundle schema is `cheapbugs.bug_bundle.v1`.
  - The bundle includes public fields such as reporter, broker, chain id, reveal timing, title, public summary, `bug_type`, `severity`, and `target_interest`.
  - The bundle includes the encrypted `details` ciphertext and encryption metadata, but never the details key.
  - Current implementation has the submitter generate the random details key, encrypt the details, sign the `PublishBug` authorization over the bundle hash and commitments, and send the bundle plus out-of-bundle details key to the broker over XMTP.
  - The broker verifies the EIP-712 authorization, verifies the supplied key commitment, decrypts the details for objective well-formedness checks, live-preflights the reveal window before pinning, pins the encrypted bundle payload to IPFS without adding broker status fields, then publishes the signed report commitment to the bug index unless `BROKER_DRY_RUN=1`.
  - Broker pinning uses a locally running Kubo HTTP API. `BROKER_IPFS_API_URL` defaults to `http://127.0.0.1:5001`.
  - On broker startup, the `run` command checks Kubo `/api/v0/version` and verifies `/api/v0/add` accepts write requests using a tiny unpinned probe.
  - `BROKER_IPFS_GATEWAY_URL` defaults to the frontend's current `https://ipfs.io/ipfs` gateway. `BROKER_IPFS_PRIME_GATEWAY=1` performs a best-effort gateway fetch after pinning, but gateway caching is not durable and can fail when the local node is not publicly reachable through the IPFS swarm.
  - The broker stores the out-of-bundle details key and bundle metadata in SQLite for later reveal work.
  - The bug index stores the bundle CID, bundle/content commitments, encrypted details hash, reveal time, and details-key commitment.
  - After the 7-day judgment period, a broker adds the raw 32-byte details key to the bug index. The index verifies `sha256(rawKey) == detailsKeyCommitment`; browsers can then fetch the bundle from IPFS, read the key from the index, decrypt details locally, and render the bug as ordinary readable content.
- **Test Criteria**:
  - [x] Broker tests cover EIP-712-authorized encrypted BugBundle verification and pinning without plaintext details in the pinned JSON.
  - [x] Broker tests cover Kubo API startup/add request wiring without requiring a live Kubo daemon.
  - [x] Browser tests cover PublishBug signature prompt state.
  - [x] Broker tests prove the broker rejects altered bundle authorization hashes and invalid BugBundle validation results.
  - [ ] Browser tests cover submitter-side bundle construction, details encryption, and key commitment generation against deterministic vectors.
  - [ ] Broker tests add dedicated cases for bad recovered signatures, mismatched details keys, and unintelligible decrypted details.
  - [x] Contract tests prove keys cannot be revealed before the judgment window and revealed keys must match the stored commitment.
  - [ ] Read-path tests cover automatic post-reveal IPFS fetch and browser decryption.

### Reporter-Signed Broker Relay

- **Stability**: in-progress
- **Description**: Let the broker pin private submission material to IPFS and submit bug-index records without being able to forge reports from other users.
- **Properties**:
  - `CheapBugsBugIndex.publishBug` now requires an EIP-712 reporter signature before accepting broker-published records.
  - The signed message binds reporter, broker wallet, Base chain id through the EIP-712 domain, bug-index contract address through the EIP-712 domain, report fields, BugBundle hash, encrypted details hash, details-key commitment, reveal time, created time, nonce, and deadline. The broker-produced IPFS CID is stored after pinning but is not part of the reporter signature.
  - The broker may verify, pin IPFS, and pay gas, but it must not be able to choose or alter the reporter address or signed bundle content accepted by the registry.
  - `CheapBugsBugIndex` rejects broker-relayed submissions unless the ECDSA signature recovers to the claimed reporter. EIP-1271 contract-wallet support remains future work.
  - The contract prevents replay through used reporter nonces, broker binding, EIP-712 domain binding, signature deadlines, and duplicate report hashes.
  - XMTP sender identity is useful broker-side evidence, but it is not enough for the smart-contract-level anti-forgery claim.
  - Private plaintext details must never be placed onchain; onchain records should contain public metadata, IPFS CIDs, commitments, content hashes, and post-window details keys only.
  - The browser and Python broker now create, verify, and relay the contract EIP-712 publish signature to the index after IPFS pinning. `BROKER_DRY_RUN=1` verifies the path and records local state without broadcasting or relaying to Signal.
  - Because `revealAfter` is signature-bound, any submission signed with a reveal window that is too short for live publication must be resubmitted from an updated frontend.
- **Test Criteria**:
  - [x] Contract tests prove a broker cannot submit a forged report for an arbitrary reporter.
  - [x] Contract tests prove valid reporter signatures are accepted through the broker-relay path.
  - [x] Contract tests prove wrong broker, expired/deadline, and replayed submissions fail.
  - [x] Browser tests cover the signature prompt state.
  - [x] Broker tests verify signed envelopes before IPFS pinning.
  - [x] Broker tests cover shaping the verified authorization into `publishBug`, recording publish failures after IPFS pinning, and dry-run behavior.

### Python Broker Bot

- **Stability**: in-progress
- **Description**: Optional Python runtime receives website-initiated JSON commands over XMTP, validates broker flows, optionally relays accepted submissions to a private Signal group, stores broker state in SQLite, tracks Signal reactions, and pays BUGZ rewards when Signal is configured.
- **Properties**:
  - The broker has three distinct incoming XMTP message flows, all initiated by interaction with the main website and sent as strict JSON commands over XMTP.
  - Publisher flow: the currently active work path where a submitter sends a bug submission to the broker for validation, staged status replies, broker-managed review-key handling, IPFS pinning, and bug-index publication.
  - Seller flow: planned, not implemented. A user on the site requests access to preview a bug that is still inside its judging period. The broker will validate the request, enforce the relevant eligibility/payment/access rules, and return access status over XMTP.
  - Bouncer flow: planned, partially represented by existing access-request command handling. A user on the site requests access to the special Signal group. The broker validates credentials and, when Signal is configured, grants or denies group access.
  - Runtime config comes from `BROKER_*` environment variables and `BrokerConfig`.
  - `run-broker.sh` loads `.env`, validates mandatory `BROKER_KEY`, prepares a `.venv-broker*` virtualenv, initializes the SQLite store, and runs the broker.
  - `run-broker.sh` prefers Python 3.10 through 3.13 over generic `python3` so `xmtp-bindings` can use published wheels when available; `BROKER_PYTHON` and `BROKER_VENV_DIR` override this.
  - Base RPC defaults to `https://mainnet.base.org`; BUGZ token defaults to the live Base BUGZ token and can be overridden for local testing.
  - Broker runtime logs are timestamped to stdout and `BROKER_LOG_PATH`, defaulting to `broker.log`; new submissions log a clear `NEW SUBMISSION from <reporter>` line and the full raw XMTP JSON payload, including private detail bodies.
  - The `run` command requires a writable local Kubo IPFS API and fails startup if the Kubo version or add probe fails.
  - `./run-broker.sh debug` enables Python DEBUG logging, Python fault-handler output, Rust XMTP backtraces, `RUST_LOG=debug`, and a default `broker-debug.log`.
  - Signal support is optional. When `BROKER_SIGNAL_CLI` is unset, the broker validates XMTP submissions and records accepted submissions locally without Signal relay, reaction syncing, or reward settlement.
  - Signal relay messages include the report heading, public summary, private details, and BugBundle URI, but omit unused repro, evidence, and contact-hint placeholder sections.
  - The broker dependencies are pinned to `xmtp==0.1.5` and `xmtp-bindings==0.1.5`.
  - Verify the actual broker virtualenv with `.venv-broker/bin/python -m pip show xmtp xmtp-bindings xmtp-agent` before assuming the runtime matches the requested pin.
  - The broker runner keeps guarded native compatibility shims for accidental `xmtp-bindings` drift that changes wrapper-call signatures or renamed bindings symbols, avoiding a local XMTP DB wipe for package mismatch debugging.
  - The broker persists and reuses its XMTP installation DB, archives inbox-mismatched DB files before retrying startup, and archives/retries when the local installation ID is no longer present in the network inbox state. If the installation count is already at `BROKER_XMTP_INSTALLATION_LIMIT` before registration, the broker revokes stale installations first so a new local DB can recover instead of failing at the network limit.
  - `BROKER_XMTP_ARCHIVE_INACTIVE_DB` defaults to enabled. Disable it only for manual debugging of a local XMTP DB whose installation is absent from the network inbox state.
  - `BROKER_XMTP_AUTO_REVOKE_OLD_INSTALLATIONS` defaults to enabled. Disable it only for intentional multi-installation broker operations.
  - The broker runner patches XMTP agent stream shutdown so a stream error cannot recursively cancel the currently running stream task and hide the original error.
  - `BROKER_KEY` is the single broker wallet key, used for the XMTP identity and BUGZ payouts.
  - `BROKER_DRY_RUN` defaults to `1` in `run-broker.sh`; while enabled, accepted submissions verify and pin but skip the `publishBug` transaction and Signal relay. Set it to `0` only when the broker wallet is intentionally funded for live index publishing and payouts.
  - Broker verification may normalize EVM addresses to lowercase internally, but `bots/cheapbugs_broker/bug_index.py` converts ABI `address` arguments to checksum form before calling web3.py contract functions.
  - SQLite tracks processed XMTP message IDs, relayed submissions, BugBundle CIDs and details keys, Signal message timestamps, active reactions, settlement status, reward amounts, and payout transaction hashes.
  - Signal access requests are gated by `BROKER_ACCESS_MIN_BUGZ`.
  - Live payouts spend from the broker wallet and should run only from an intentionally funded wallet.
- **Test Criteria**:
  - [x] `python3 -m unittest discover -s bots/tests -t bots` covers command parsing, staged broker validation, SQLite maturity, reaction parsing, and reward math.
  - [x] Broker tests cover XMTP installation pruning, inactive local installation detection, and maxed-installation recovery.
  - [x] `python3 -m compileall bots scripts/broker-bot.py` checks Python syntax.
  - [x] `bash -n run-broker.sh` checks the root launcher syntax.
  - [ ] Add website-to-XMTP JSON command tests for publisher, seller, and bouncer flows.
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
  - Base contract read providers disable JSON-RPC batching and use a static network so public Base RPC endpoints do not reject oversized batches during concurrent header/token reads.
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
  - [x] `python3 -m compileall bots scripts/broker-bot.py`
  - [x] `bash -n run-broker.sh`

## External Integrations

- **Base RPC**: contract reads, writes, BUGZ balances, holder scans, deployments.
- **CheapBugsBondVault / CheapBugsTreasuryVault**: onchain BUGZ bonding, detail-key purchase accounting, and ordered reporter reward disbursement.
- **Thirdweb**: installed-wallet login, WalletConnect QR, signer adapters.
- **ENS**: mainnet name/avatar resolution for session UI.
- **IPFS / Pinata**: encrypted dossier storage and gateway reads.
- **EAS**: reviewer verdict attestations and indexed reads.
- **XMTP**: browser-to-broker report submission and broker status messages.
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
python3 -m unittest discover -s bots/tests -t bots
python3 -m compileall bots scripts/broker-bot.py
```

## Future Milestones

- Wire accepted broker submissions to call `CheapBugsBugIndex.publishBug` after IPFS pinning.
- Replace the broker bot's direct wallet-funded payout path with the index-ordered `CheapBugsTreasuryVault` reward path.
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
- **Date of Last Update**: 2026-05-18
