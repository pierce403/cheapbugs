# CheapBugs Security Model

This document records security claims, trust boundaries, and known gaps for CheapBugs. Keep it current when changing submission flow, broker behavior, contracts, storage, attestations, wallet auth, or reward logic.

## Primary Security Goal

CheapBugs must prevent the broker from forging bug submissions from other users at the smart-contract level.

The current contract-side claim is:

> A bug-index record attributed to a reporter can only be created by an owner-authorized broker that includes a valid reporter EIP-712 signature over the canonical publish commitment.

The browser and Python broker still need to be wired to produce and verify that EIP-712 publish envelope before live broker publishing is enabled.

## Current Implemented Guarantees

- Direct onchain submissions to `CheapBugsBugIndex` are disabled; only owner-authorized brokers can call `publishBug`.
- `CheapBugsBugIndex.publishBug` requires a reporter EIP-712 signature that binds the reporter, broker, index domain, chain id, report fields, BugBundle CID/hash, encrypted details hash, details-key commitment, reveal time, nonce, and deadline.
- `CheapBugsBugIndex` rejects expired signatures, replayed reporter nonces, duplicate report hashes, wrong broker signatures, and reveal windows shorter than 7 days from onchain publication.
- `CheapBugsBugIndex` accepts details-key reveals only after the 7-day window and only when `sha256(raw 32-byte key)` matches the stored commitment.
- `BondVault` keeps pending withdrawals slashable during the 7-day withdrawal delay, and new bonds cancel pending withdrawals.
- `TreasuryVault` records detail-key purchases and pays rewards only when called by the configured index for a treasury-authorized broker.
- The current broker XMTP payload includes `reporter_address`, `broker_address`, a signed encrypted `cheapbugs.bug_bundle.v1`, and an out-of-bundle details key.
- The browser generates the details key, encrypts details with AES-256-GCM, signs the canonical BugBundle core with EIP-191 scheme `eip191_bugbundle_core_v1`, and sends the signed bundle plus details key to the broker over XMTP.
- The broker verifies the BugBundle before target validation, credential validation, or IPFS pinning. Invalid signatures, wrong reporter/broker/chain/index bindings, key-commitment mismatches, ciphertext-hash mismatches, AAD mismatches, and decryption failures stop the submission flow.
- The browser sends broker submissions as XMTP DMs to the configured broker wallet.
- The broker parser rejects malformed JSON, missing required fields, unexpected fields, invalid target references, blocked reporters, and insufficient BUGZ balance.
- The broker sends staged plain text XMTP status messages after successful validation stages.
- The broker pins the verified signed BugBundle through local Kubo without adding broker status fields to the payload.
- The signed bundle keeps the details key outside IPFS. The broker stores that key in SQLite for later reveal work.
- Reviewer verdict writes use EAS directly from the reviewer wallet path, with EAS content treated as untrusted input when read back.

## Reporter-Signed Broker Relay

The contract-verifiable relay path now exists in `CheapBugsBugIndex.publishBug`. The current EIP-191 BugBundle signature is still broker-verifiable only and is not sufficient for onchain publication.

Current and required properties:

- The browser builds a canonical `cheapbugs.bug_bundle.v1` commitment from the unsigned bundle core.
- The browser generates a random details key, encrypts private details into the bundle, and keeps the details key outside the IPFS-bound bundle.
- The reporter signs an EIP-712 typed message that binds reporter, broker wallet, Base chain id, bug-index contract address, report fields, bundle CID/hash, encrypted details hash, details-key commitment, reveal time, created time, nonce, and deadline.
- The XMTP message carries the signed BugBundle plus the out-of-bundle details key.
- The broker verifies the envelope, confirms the supplied details key matches the bundle commitment, decrypts details for objective well-formedness checks, and pins the signed bundle payload without modification before doing EAS or registry writes.
- `CheapBugsBugIndex` verifies the reporter signature for broker-relayed submissions and stores the signed reporter.
- The contract rejects invalid signatures, wrong broker/domain, wrong chain or contract through the EIP-712 domain/broker binding, expired signatures, duplicate report hashes, and replayed nonces.
- The contract stores the bundle CID/commitments and details-key commitment when the broker registers the report.
- The contract accepts the details key only after the 7-day judgment period and only when it matches the stored key commitment.
- If contract wallets are supported, the relay path must support EIP-1271 signature validation.

Until browser and broker EIP-712 wiring exists, the broker must not create live bug-index records from the current EIP-191-only XMTP payload. The EIP-191 BugBundle signature remains useful broker-side authorization and audit material, but it is not the final onchain relay signature.

## Trust Boundaries

### Browser

- The browser is trusted to display the correct signing intent only if the loaded static assets are authentic.
- Wallet signatures are the source of identity authority, not form fields.
- Local XMTP identity keys are browser-stored recovery material. A compromised browser profile compromises that local wallet.
- External wallets and WalletConnect devices must show signature prompts clearly enough for users to detect unexpected signing requests.

### XMTP

- XMTP provides private message transport and sender context for the broker workflow.
- XMTP sender identity is useful evidence for broker-side checks, but it is not sufficient for smart-contract-level attribution.
- The broker must treat all XMTP message content as untrusted until parsed and verified.

### Broker

- The broker is trusted to receive private submissions, hold unrevealed details keys, pin encrypted BugBundles to IPFS, optionally create EAS attestations, and relay accepted reports.
- The broker is not trusted to choose the reporter address for onchain attribution.
- Broker compromise can expose submissions it has received, unrevealed details keys it holds, Signal relay data, SQLite state, and the `BROKER_KEY` available to the process.
- `BROKER_KEY` is the single broker wallet key. It controls the broker XMTP identity and currently signs legacy direct BUGZ payout transfers in the Python bot; the new contract path should route rewards through the index and `TreasuryVault`.
- Base RPC and BUGZ token defaults are public configuration, not secrets.
- Broker runtime secrets live in `.env` for local runs and must not be committed.
- Broker SQLite now stores unrevealed details keys for IPFS-pinned BugBundles. Treat `.broker/broker.sqlite` as private disclosure material.
- Broker logs are written to `BROKER_LOG_PATH` and stdout. New submissions intentionally log the full raw XMTP JSON payload, including the out-of-bundle details key, for development visibility. Treat `broker.log` and debug logs as private disclosure material and do not share them outside trusted project operators.
- Broker debug mode can include third-party XMTP/Rust diagnostics. Inspect debug logs before sharing them outside the project.
- Signal can be disabled for local broker testing. In that mode, submissions are validated and recorded locally, but there is no reviewer-channel relay, reaction source, or reward settlement.
- The broker wallet must be deliberately funded and capped before using the legacy direct payout path. The contract reward path pays from `TreasuryVault`, not from broker wallet funds.

### IPFS And Pinata

- Private report material must not be uploaded in plaintext by the browser.
- In the current broker flow, IPFS stores a single signed BugBundle JSON object whose `details` section is encrypted ciphertext.
- Details keys must not be included in IPFS bundles. They are held by the broker during the judgment period and later published through the bug index after the reveal window opens.
- Public gateway priming is best-effort and does not guarantee persistence. It can also reveal a CID to a third-party gateway before the onchain index references it, so it is disabled by default.
- IPFS CIDs and gateway responses are untrusted input. Rendering code must sanitize and validate fetched content.
- Pinata credentials must stay out of browser code.

### EAS

- EAS is a public attestation layer when used onchain.
- Offchain EAS attestations are signed data objects that still need an application storage and transport decision.
- EAS attestations or pointers do not by themselves prove that a reporter authorized a broker-submitted bug report unless the attestation data includes, or is backed by, a reporter-verifiable signature.
- EAS note content and decoded fields must be treated as untrusted user input.

### CheapBugsBugIndex

- Direct submission is disabled.
- Broker-published records must include a valid reporter EIP-712 signature before the contract assigns reporter attribution.
- Public onchain fields must remain safe for permanent disclosure.
- Private details must be represented onchain only by CIDs, hashes, commitments, or other non-plaintext references until the 7-day judgment period has ended.
- After the judgment period, the index may store the raw 32-byte details key so browsers can fetch the encrypted IPFS bundle and decrypt details locally.
- Admin status flags are trusted guidance for payout completion; only brokers can complete payout in report order.

### BondVault

- Active and pending-withdrawal bonds are both slashable.
- Only active bond contributes to `getLevel` and bonded bug vote weight.
- Vote weights are snapshotted in the index at vote time, so later withdrawals or slashes do not alter already-cast vote totals.
- The owner controls slashers, so slasher compromise can transfer bonded BUGZ to the treasury.

### TreasuryVault

- Detail-key purchases are onchain payment records for broker verification; the broker still decides whether and when to deliver a key offchain.
- Rewards can only be paid by the configured index and only for brokers also authorized by the treasury.
- A bad treasury/index configuration can block payouts or pay from an unintended treasury. Deployment should verify both directions before live use.

### BUGZ Credentials And Reputation

- BUGZ balance checks are eligibility gates, not sybil-proof identity.
- Reputation blocklists are local broker policy and should be auditable.
- Signal reactions are social support signals only. They are not sybil-resistant votes.

## Known Gaps

- Browser and Python broker code do not yet create the EIP-712 `PublishBug` signature required by `CheapBugsBugIndex.publishBug`.
- The current XMTP JSON payload uses an EIP-191 BugBundle signature, not the EIP-712 contract relay signature.
- The broker IPFS pinning path verifies submitter-built encrypted signed bundles, but dedicated negative tests still need to be expanded for mismatched details keys and undecryptable details.
- The broker has not yet been wired to EAS submission or bug-index relay for accepted XMTP submissions.
- EIP-1271 contract-wallet reporter signatures are not implemented.
- Live XMTP broker smoke tests are manual.
- Reviewer trust is frontend-enforced through an allowlist and should move to an onchain or resolver-backed trust model.
- Browser bundle integrity depends on the static hosting and deployment pipeline.

## Non-Goals For The Current MVP

- CheapBugs does not claim reviewer votes are sybil-resistant.
- CheapBugs does not claim the broker cannot read submissions it receives.
- CheapBugs does not claim IPFS content is private unless it is encrypted before pinning.
- CheapBugs does not claim EAS or IPFS availability without separate pinning/indexing operations.
