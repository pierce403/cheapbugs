# CheapBugs Security Model

This document records security claims, trust boundaries, and known gaps for CheapBugs. Keep it current when changing submission flow, broker behavior, contracts, storage, attestations, wallet auth, or reward logic.

## Primary Security Goal

CheapBugs must prevent the broker from forging bug submissions from other users at the smart-contract level.

The current contract-side claim is:

> A bug-index record attributed to a reporter can only be created by an owner-authorized broker that includes a valid reporter EIP-712 signature over the canonical publish commitment.

The browser and Python broker now produce and verify that EIP-712 publish envelope before IPFS pinning, and the broker relays accepted records to the index after pinning when `BROKER_DRY_RUN=0`.

## Current Implemented Guarantees

- Direct onchain submissions to `CheapBugsBugIndex` are disabled; only owner-authorized brokers can call `publishBug`.
- `CheapBugsBugIndex.publishBug` requires a reporter EIP-712 signature that binds the reporter, broker, index domain, chain id, report fields, BugBundle hash, encrypted details hash, details-key commitment, reveal time, nonce, and deadline. The broker-produced IPFS CID is stored but not signature-bound because it is known only after pinning.
- The index verifies the reporter signature itself at submission time: `publishBug` rebuilds the EIP-712 digest with `msg.sender` as broker, recovers the signer with ECDSA, and requires it to equal the submitted reporter. Broker-side signature checks are preflight validation, not the onchain authority.
- The browser signs `bugBundleHash` as the SHA-256 of the canonical `BugBundle.core`. That core includes the submission options and display fields: `bug_type`, `severity`, `target_interest`, title, public summary, target, disclosure mode, and tags. The signed `reportHash` and `contentHash` also include the submission object plus encrypted-details hash and details-key commitment, so brokers cannot alter those fields without invalidating the signed hashes.
- Base RPC calls for `publishBug`, including gas estimation, do not carry plaintext private details, AES-GCM ciphertext, or the out-of-bundle details key. The transaction calldata contains public-safe fields, the broker-pinned CID, hash commitments, reveal timing, nonce/deadline, and the reporter signature. Private details are sent to the broker over XMTP, stored in IPFS only as encrypted ciphertext, and the details key stays offchain until post-window reveal.
- `CheapBugsBugIndex` rejects expired signatures, replayed reporter nonces, duplicate report hashes, wrong broker signatures, and reveal windows shorter than 7 days from onchain publication.
- `CheapBugsBugIndex` accepts details-key reveals only after the 7-day window and only when `sha256(raw 32-byte key)` matches the stored commitment.
- `CheapBugsBondVault` keeps pending withdrawals slashable during the 7-day withdrawal delay, and new bonds cancel pending withdrawals.
- `CheapBugsTreasuryVault` records detail-key purchases and pays rewards only when called by the configured index for a treasury-authorized broker.
- Detail-key unlock sales use strict XMTP schema `cheapbugs.detail_unlock.v1`. The broker binds quote and paid messages to the authenticated XMTP buyer, stores quote price/expiry in SQLite, verifies the submitted transaction receipt, and reads `CheapBugsTreasuryVault.detailKeyPayments(reportHash, buyer)` before releasing a details key.
- The vaults hardcode the live Base BUGZ token address `0x60Df4a0C9A5050c337010cb29C9694cE4d8fbb07`; this repo no longer deploys a BUGZ token contract.
- Real deployment launchers now check deployed vault/index wiring and verify all three contracts on Etherscan/BaseScan by default.
- The verified Base deployment is `CheapBugsBugIndex` `0x515FDbc9876aC26870794E26605c7DD04c18679b`, `CheapBugsBondVault` `0x2Eab99B6d6F1FBDa4fa78a00662E0cf9aBd9f3d3`, and `CheapBugsTreasuryVault` `0x4A080668d9848928dc6D48921cbDc4273fe27A9d`.
- Launchers may deploy from `BROKER_KEY` when a separate deployer key is not set, but ownership transfers to `0x7ab874Eeef0169ADA0d225E9801A3FfFfa26aAC3` by default.
- The current broker XMTP payload includes `reporter_address`, `broker_address`, an encrypted `cheapbugs.bug_bundle.v1`, a reporter EIP-712 `publish_authorization`, and an out-of-bundle details key.
- The browser generates the details key, encrypts details with AES-256-GCM, signs the `PublishBug` EIP-712 authorization over the bundle hash and commitments, and sends the bundle plus details key to the broker over XMTP.
- The signed reveal time is 7 days plus a 1-hour publish buffer after browser creation. This buffer exists because the index enforces the 7-day window against the actual publication block, not the time the user signed the bundle.
- The broker verifies the BugBundle and publish authorization before target validation, credential validation, or IPFS pinning. Invalid signatures, wrong reporter/broker/chain/index bindings, key-commitment mismatches, ciphertext-hash mismatches, AAD mismatches, and decryption failures stop the submission flow.
- The broker stores and pays only a verified submission reporter: the verified EIP-712 PublishBug reporter must match `reporter_address`, and when XMTP sender context is available it must also match the authenticated XMTP sender before credential checks, IPFS pinning, index publication, Signal relay, or payout persistence.
- In live mode, the broker preflights the signed reveal time before IPFS pinning so a too-short, signature-bound `revealAfter` is rejected before creating another durable CID.
- The browser sends broker submissions as XMTP DMs to the configured broker wallet.
- The broker parser rejects malformed JSON, missing required fields, unexpected fields, invalid target references, and blocked reporters. Submission BUGZ-balance gating is configurable and currently defaults to zero BUGZ for open submissions.
- Signal bouncer access checks use the authenticated XMTP sender as the wallet identity. Optional `wallet` fields are accepted only when they match the sender; mismatches are rejected before BUGZ balance checks or Signal group invites.
- The broker sends staged plain text XMTP status messages after successful validation stages.
- The broker pins the verified encrypted BugBundle through local Kubo without adding broker status fields to the payload.
- The pinned bundle keeps the details key outside IPFS. The broker stores that key in SQLite for later reveal work.
- The browser stores a purchased details key only after the broker returns it over XMTP, then decrypts the already pinned encrypted BugBundle locally. Decrypted private details are not written to the BugBundle/IPFS cache.
- The browser detail-unlock payment path verifies the transaction signer matches the connected buyer session before approval or treasury payment. The broker still treats the onchain transaction sender and treasury purchase ledger as the authority before releasing a key.
- Home/index lock icons and report-page early-access buttons share the same browser detail-unlock flow; the listing UI does not add a separate payment or key-release trust path.
- The frontend may fetch the pinned BugBundle public core to display title and target metadata, but that gateway content is untrusted display data and must not override onchain attribution, commitments, payout state, or authorization checks.
- The frontend owner console reads contract ownership and exposes owner transaction forms only as a convenience layer. `onlyOwner` checks in the contracts remain the authority for all management calls.
- The frontend review queue reads `CheapBugsBugIndex.admins(account)` so onchain admins can flag report status from `/review`. This does not grant owner-only `/manage` controls.
- The frontend staking route helps users approve, bond, request withdrawal, and withdraw BUGZ, but bond accounting, withdrawal delays, and slashing guarantees are enforced only by `CheapBugsBondVault`.
- The bond page may show a session-local pending-withdrawal hint after a confirmed request while public Base reads catch up. That hint is presentation only; the vault ledger remains the source of truth for active, pending, withdrawable, and slashable balances.
- The frontend index vote controls are a convenience layer over `CheapBugsBugIndex.submitBondVote`. Browser level checks only avoid predictable failed transactions; the index and bond vault remain the authority for vote eligibility and snapshotted weight.
- After IPFS pinning, the broker publishes the signed report to `CheapBugsBugIndex.publishBug`, checks the broker role and gas funding before broadcast, waits for a receipt, and records the report hash and transaction hash in SQLite. `BROKER_DRY_RUN=1` skips the broadcast and Signal relay while still exercising validation and IPFS pinning.
- Reviewer verdict writes use EAS directly from the reviewer wallet path, with EAS content treated as untrusted input when read back.
- Report detail pages may display EAS verdict attestations from any attester returned by the configured verdict schema query, but only attestations from `VITE_REVIEWER_ADDRESSES` contribute to the trusted headline and confidence average.

## Reporter-Signed Broker Relay

The contract-verifiable relay path now exists in `CheapBugsBugIndex.publishBug`, and the browser/broker XMTP flow now creates and verifies the matching EIP-712 `PublishBug` authorization.

Current and required properties:

- The browser builds a canonical `cheapbugs.bug_bundle.v1` commitment from the unsigned bundle core.
- The browser generates a random details key, encrypts private details into the bundle, and keeps the details key outside the IPFS-bound bundle.
- The reporter signs an EIP-712 typed message that binds reporter, broker wallet, Base chain id, bug-index contract address, report fields, bundle hash, encrypted details hash, details-key commitment, reveal time, created time, nonce, and deadline. The signed report fields include hashes derived from the `BugBundle.core.submission` object, which contains bug type, severity, target interest, title, public summary, target, disclosure mode, and tags.
- The XMTP message carries the encrypted BugBundle, `publish_authorization`, and out-of-bundle details key.
- The broker verifies the envelope, confirms the supplied details key matches the bundle commitment, decrypts details for objective well-formedness checks, and pins the encrypted bundle payload without modification before doing EAS or registry writes.
- `CheapBugsBugIndex` verifies the reporter signature for broker-relayed submissions by reconstructing the same EIP-712 digest, recovering the signer, and storing the signed reporter only after recovery matches.
- The contract rejects invalid signatures, wrong broker/domain, wrong chain or contract through the EIP-712 domain/broker binding, expired signatures, duplicate report hashes, and replayed nonces.
- The contract stores the bundle CID/commitments and details-key commitment when the broker registers the report. The CID is a pointer and is not itself signed or fetchable by the contract; the stored `bugBundleHash`, `encryptedDetailsHash`, and `detailsKeyCommitment` are the authenticity commitments for any fetched bundle content.
- The contract accepts the details key only after the 7-day judgment period and only when it matches the stored key commitment.
- If contract wallets are supported, the relay path must support EIP-1271 signature validation.

## Trust Boundaries

### Browser

- The browser is trusted to display the correct signing intent only if the loaded static assets are authentic.
- Wallet signatures are the source of identity authority, not form fields.
- ENS names and avatars are presentation only. Author profile links and report attribution must continue to use the reporter address stored by the bug index.
- Owner/manage UI visibility is presentation only. A hidden, stale, or manually opened `/manage` route must not be treated as authorization; contracts must enforce ownership.
- Embedded CheapBugs wallet keys are browser-stored recovery material. A compromised browser profile compromises that wallet and anything it can sign.
- Embedded wallets can be exported and imported as `cheapbugs-key.json`. That file contains private key material and must be kept private; it is the recovery path for the embedded wallet address.
- External wallets and WalletConnect devices must show signature prompts clearly enough for users to detect unexpected signing requests.

### XMTP

- XMTP provides private message transport and sender context for the broker workflow.
- XMTP sender identity is useful evidence for broker-side checks, but it is not sufficient for smart-contract-level attribution.
- The broker must treat all XMTP message content as untrusted until parsed and verified.
- Bouncer access requests must not authorize from message-supplied wallet fields. The authenticated XMTP sender address is the eligibility wallet unless a future flow adds an explicit signature proof.

### Broker

- The broker is trusted to receive private submissions, hold unrevealed details keys, pin encrypted BugBundles to IPFS, optionally create EAS attestations, and relay accepted reports.
- The broker is trusted to release unrevealed details keys early after a verified treasury payment. A compromised broker can still leak details keys without payment.
- The broker is not trusted to choose the reporter address for onchain attribution.
- Broker compromise can expose submissions it has received, unrevealed details keys it holds, Signal relay data, SQLite state, and the `BROKER_KEY` available to the process.
- `BROKER_KEY` is the single broker wallet key. It controls the broker XMTP identity and currently signs direct BUGZ payout transfers in the Python bot; the new contract path should route rewards through the index and `CheapBugsTreasuryVault`.
- Base RPC and BUGZ token defaults are public configuration, not secrets.
- Broker runtime secrets live in `.env` for local runs and must not be committed.
- Broker SQLite now stores unrevealed details keys for IPFS-pinned BugBundles. Treat `.broker/broker.sqlite` as private disclosure material.
- The broker XMTP database stores the active XMTP installation identity. Treat `.broker/xmtp*.db3` files as private key material and persist them across restarts. If the local installation disappears from the network inbox state, broker startup archives the inactive DB and creates a fresh installation by default. The broker can revoke stale installations for the same `BROKER_KEY` to recover from XMTP installation-limit exhaustion; do not run multiple broker instances with the same key unless `BROKER_XMTP_AUTO_REVOKE_OLD_INSTALLATIONS=0` is set and operators accept the installation-count risk.
- Broker logs are written to `BROKER_LOG_PATH` and stdout. New submissions intentionally log the full raw XMTP JSON payload, including the out-of-bundle details key, for development visibility. Treat `broker.log` and debug logs as private disclosure material and do not share them outside trusted project operators.
- Broker debug mode can include third-party XMTP/Rust diagnostics. Inspect debug logs before sharing them outside the project.
- Signal can be disabled for local broker testing. In that mode, submissions are validated and recorded locally, but there is no reviewer-channel relay, reaction source, or reward settlement.
- Detail-unlock buyers are treated as adversarial. The broker must reject spoofed buyer fields, wrong broker/index/treasury bindings, expired quote ids, unknown report hashes, failed or unrelated transaction hashes, and payments whose treasury ledger total is below the stored quote.
- The broker wallet must be deliberately funded and capped before using the current direct payout path. The contract reward path pays from `CheapBugsTreasuryVault`, not from broker wallet funds.

### IPFS And Pinata

- Private report material must not be uploaded in plaintext by the browser.
- In the current broker flow, IPFS stores a single BugBundle JSON object whose `details` section is encrypted ciphertext.
- Details keys must not be included in IPFS bundles. They are held by the broker during the judgment period and later published through the bug index after the reveal window opens.
- IPFS CIDs are not part of the reporter's EIP-712 signature and cannot be verified onchain. The contract stores the CID alongside signed hash commitments so offchain readers and brokers have a signed bundle/core/ciphertext commitment to compare against fetched content.
- Public gateway priming is best-effort and does not guarantee persistence. It can also reveal a CID to a third-party gateway before the onchain index references it, so it is disabled by default.
- IPFS CIDs and gateway responses are untrusted input. Rendering code must sanitize and validate fetched content, including the public BugBundle title and target fields used in archive tables.
- Browser localStorage may cache full encrypted BugBundle JSON and public bug-index records to reduce gateway/RPC pressure. This cache must not store decrypted private details or unrevealed details keys.
- Pinata credentials must stay out of browser code.

### EAS

- EAS is a public attestation layer when used onchain.
- Offchain EAS attestations are signed data objects that still need an application storage and transport decision.
- EAS attestations or pointers do not by themselves prove that a reporter authorized a broker-submitted bug report unless the attestation data includes, or is backed by, a reporter-verifiable signature.
- EAS note content and decoded fields must be treated as untrusted user input.
- Frontend trusted-review summaries are allowlist-based presentation. Showing an untrusted attestation row does not make that attester trusted for payouts, admin status, or headline verdict state.

### CheapBugsBugIndex

- Direct submission is disabled.
- Broker-published records must include a valid reporter EIP-712 signature before the contract assigns reporter attribution.
- Public onchain fields must remain safe for permanent disclosure.
- Private details must be represented onchain only by CIDs, hashes, commitments, or other non-plaintext references until the 7-day judgment period has ended.
- After the judgment period, the index may store the raw 32-byte details key so browsers can fetch the encrypted IPFS bundle and decrypt details locally.
- Admin status flags are trusted guidance for payout completion; only brokers can complete payout in report order.
- Browser review access has two distinct paths: frontend reviewer allowlist access for EAS review UX, and onchain index admin access for `flagBug`. Only the onchain admin role can set payout status.

### CheapBugsBondVault

- Active and pending-withdrawal bonds are both slashable.
- Only active bond contributes to `getLevel` and bonded bug vote weight.
- Vote weights are snapshotted in the index at vote time, so later withdrawals or slashes do not alter already-cast vote totals.
- The browser displays vote totals and connected-user vote direction from chain reads, but those displays are not governance authority and can be stale until the next refresh.
- The owner controls slashers, so slasher compromise can transfer bonded BUGZ to the treasury.
- The `/stake` frontend must present pending withdrawals as still slashable and must not imply the countdown protects funds from slashing.

### CheapBugsTreasuryVault

- Detail-key purchases are onchain payment records for broker verification; the broker still decides whether and when to deliver a key offchain.
- Early-access quote amounts are broker policy, not an onchain invariant. The current broker calculates price from treasury base reward times days remaining, but key release is gated by the onchain purchase ledger rather than by buyer-provided amount fields.
- Rewards can only be paid by the configured index and only for brokers also authorized by the treasury.
- A bad treasury/index configuration can block payouts or pay from an unintended treasury. The launcher checks the deployed wiring, and operators should still record the verified addresses before funding the treasury.
- Browser owner controls for vault/index wiring, role lists, payout divisor, and ownership transfer are operational convenience only. Operators should still verify transaction prompts and resulting contract state before funding or relying on a new configuration.
- The `/treasury` frontend display is informational only. Treasury value and USD payout estimates come from BUGZ balance reads, treasury reward calculation reads, a Uniswap v4 BUGZ/WETH quote, and the Chainlink Base ETH/USD feed; contract payout authority remains only `CheapBugsTreasuryVault` called by the configured index.
- Deployment manifests under `deployments/` are public reproducibility records. They include deployer and role addresses, constructor arguments, bytecode hashes, generated artifacts, and transaction hashes, but must not include private keys, explorer API keys, or unredacted RPC URLs.

### BUGZ Credentials And Reputation

- BUGZ balance checks are eligibility gates, not sybil-proof identity.
- Reputation blocklists are local broker policy and should be auditable.
- Signal reactions are social support signals only. They are not sybil-resistant votes.

## Known Gaps

- The broker IPFS pinning path verifies submitter-built encrypted EIP-712-authorized bundles, but dedicated negative tests still need to be expanded for mismatched details keys and undecryptable details.
- The broker has not yet been wired to EAS submission attestations for accepted XMTP submissions.
- EIP-1271 contract-wallet reporter signatures are not implemented.
- Live XMTP broker smoke tests are manual.
- Live detail-unlock testing is manual and needs a funded buyer wallet, broker XMTP inbox, Base RPC, and a report whose details key is still unrevealed.
- Reviewer trust is frontend-enforced through an allowlist and should move to an onchain or resolver-backed trust model.
- Browser bundle integrity depends on the static hosting and deployment pipeline.

## Non-Goals For The Current MVP

- CheapBugs does not claim reviewer votes are sybil-resistant.
- CheapBugs does not claim the broker cannot read submissions it receives.
- CheapBugs does not claim IPFS content is private unless it is encrypted before pinning.
- CheapBugs does not claim EAS or IPFS availability without separate pinning/indexing operations.
