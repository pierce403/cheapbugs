# TODO

## Near Term

- Add explorer links for bug index contract addresses, report transactions, and EAS attestations.
- Add contract-level pagination and event-based indexing for larger report volumes.
- Split Thirdweb/XMTP-heavy code paths to reduce the initial bundle size.
- Add a report lookup route by `reportId` in addition to `reportHash`.
- Add stronger client-side validation for public-summary size and tag count before onchain submit.

## Trust And Review

- Replace the frontend reviewer allowlist with an onchain registry.
- Add an optional EAS resolver contract for verdict policy enforcement.
- Add reviewer key-sharing workflow improvements around encrypted dossier access.
- Add public payout-record attestations for bouncer-paid BUGZ rewards.
- Define a stronger support-scoring policy than raw Signal emoji reaction counts before treating rewards as adversarially robust.

## Storage

- Add a tiny presign helper example for Pinata uploads.
- Add retry and backoff around IPFS upload/download operations.
- Add optional IndexedDB persistence for report and verdict caches.

## Contract And Launching

- Add a reviewer-management script for `setReviewer`.
- Add optional launcher support to write `VITE_BUG_INDEX_ADDRESS` into `.env.local`.
- Add automated ABI drift checks between Solidity output and the frontend adapter.

## Future Product Scope

- Add patron receipt/provenance UX beyond the cached holder leaderboard.
- Add treasury, token gating, and governance modules as separate extensions.
