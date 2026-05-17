# CheapBugs Security Model

This document records security claims, trust boundaries, and known gaps for CheapBugs. Keep it current when changing submission flow, broker behavior, contracts, storage, attestations, wallet auth, or reward logic.

## Primary Security Goal

CheapBugs must prevent the broker from forging bug submissions from other users at the smart-contract level.

The intended future claim is:

> A bug-index record attributed to a reporter can only be created by that reporter directly, or by a broker-relayed transaction that includes a valid reporter signature over the canonical submission commitment.

This broker-relay claim is not implemented yet.

## Current Implemented Guarantees

- Direct onchain submissions through `CheapBugsBugIndex.submitReport` are attributed to `msg.sender`.
- The current broker XMTP payload includes `reporter_address`, but it is not yet signed as an application-level submission envelope.
- The browser sends broker submissions as XMTP DMs to the configured broker wallet.
- The broker parser rejects malformed JSON, missing required fields, unexpected fields, invalid target references, blocked reporters, and insufficient BUGZ balance.
- The broker sends staged XMTP replies after successful validation stages.
- Reviewer verdict writes use EAS directly from the reviewer wallet path, with EAS content treated as untrusted input when read back.

## Planned Reporter-Signed Broker Relay

Before the broker may pin, attest, or register a user-attributed bug report onchain, the browser and contracts need a signed relay path.

Required properties:

- The browser builds canonical `cheapbugs.bug_submission.v1` JSON and computes a payload hash.
- The reporter signs an EIP-712 typed message that binds schema, version, reporter, broker wallet, Base chain id, bug-index contract address, payload hash, created time, and a nonce or deadline.
- The XMTP message carries the payload plus the signature envelope.
- The broker verifies the envelope before doing IPFS, EAS, or registry writes.
- `CheapBugsBugIndex` verifies the reporter signature for broker-relayed submissions and stores the recovered reporter, not a broker-supplied reporter field.
- The contract rejects invalid signatures, wrong broker/domain, wrong chain or contract, expired signatures, duplicate report hashes, and replayed nonces if nonce tracking is added.
- If contract wallets are supported, the relay path must support EIP-1271 signature validation.

Until this exists, the broker must not create bug-index records that claim to be from a user address.

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

- The broker is trusted to receive private submissions, hold review keys, pin private material to IPFS, optionally create EAS attestations, and relay accepted reports.
- The broker is not trusted to choose the reporter address for onchain attribution.
- Broker compromise can expose submissions it has received, review keys it holds, Signal relay data, SQLite state, and the `BROKER_KEY` available to the process.
- `BROKER_KEY` is the single broker wallet key. It controls the broker XMTP identity and signs BUGZ payout transfers.
- Broker runtime secrets live in `.env` for local runs and must not be committed.
- Signal can be disabled for local broker testing. In that mode, submissions are validated and recorded locally, but there is no reviewer-channel relay, reaction source, or reward settlement.
- The broker wallet must be deliberately funded and capped before live payouts. Rewards are ERC20 transfers, not mints.

### IPFS And Pinata

- Private report material must not be uploaded in plaintext by the browser.
- In the broker flow, broker-side pinning may hold private report material or encrypted private material depending on the final product design.
- IPFS CIDs and gateway responses are untrusted input. Rendering code must sanitize and validate fetched content.
- Pinata credentials must stay out of browser code.

### EAS

- EAS is a public attestation layer when used onchain.
- Offchain EAS attestations are signed data objects that still need an application storage and transport decision.
- EAS attestations or pointers do not by themselves prove that a reporter authorized a broker-submitted bug report unless the attestation data includes, or is backed by, a reporter-verifiable signature.
- EAS note content and decoded fields must be treated as untrusted user input.

### CheapBugsBugIndex

- The current direct submission path sets `reporter = msg.sender`.
- A future broker-relay path must verify reporter signatures inside the contract before assigning user attribution.
- Public onchain fields must remain safe for permanent disclosure.
- Private details must be represented onchain only by CIDs, hashes, commitments, or other non-plaintext references.

### BUGZ Credentials And Reputation

- BUGZ balance checks are eligibility gates, not sybil-proof identity.
- Reputation blocklists are local broker policy and should be auditable.
- Signal reactions are social support signals only. They are not sybil-resistant votes.

## Known Gaps

- Reporter-signed broker relay is not implemented.
- The current XMTP JSON payload has no application-level EIP-712 signature.
- The broker has not yet been wired to IPFS pinning, EAS submission, or bug-index relay for accepted XMTP submissions.
- Live XMTP broker smoke tests are manual.
- Reviewer trust is frontend-enforced through an allowlist and should move to an onchain or resolver-backed trust model.
- Browser bundle integrity depends on the static hosting and deployment pipeline.

## Non-Goals For The Current MVP

- CheapBugs does not claim reviewer votes are sybil-resistant.
- CheapBugs does not claim the broker cannot read submissions it receives.
- CheapBugs does not claim IPFS content is private unless it is encrypted before pinning.
- CheapBugs does not claim EAS or IPFS availability without separate pinning/indexing operations.
