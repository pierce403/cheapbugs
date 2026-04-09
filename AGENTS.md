# AGENTS.md - Instructions for Coding Agents

## Self-Improvement Directive

Read this file at the start of every task. Update it before you finish whenever you learn something important about this codebase, its workflow, or the collaborator's preferences.

Also read `ARCHITECTURE.md` at the start of every task that touches system design, data flow, deployment shape, contracts, storage, auth, or vendor integrations.

Record both wins to repeat and mistakes to avoid. Prefer exact commands, concrete file paths, and specific implementation notes over vague summaries.

This file is intentionally inspired by the recurse.bot idea: each agent should leave the project easier for the next one.

## Task Completion Workflow

After every completed task:

1. Run the relevant verification commands.
2. Update `AGENTS.md` if you learned anything useful.
3. Update `ARCHITECTURE.md` if the task changed architecture, system boundaries, integrations, deployment assumptions, or the recommended code-navigation map.
4. Stage the completed work.
5. Commit it with a clear message.
6. Push it to the current branch on `origin`.

Default rule: do not leave completed work uncommitted or unpushed.

Allowed exceptions:

- The user explicitly says not to commit or not to push.
- The task is still in an intermediate or broken state and is not actually complete.
- Push fails because of auth, branch protection, or network issues. In that case, report the failure clearly.

## Project Overview

CheapBugs v2 is a static Vite + TypeScript application for Base-native bug reporting and review.

Current architecture:

- public-safe report metadata is written onchain to the `CheapBugsBugIndex` contract on Base
- private report details are encrypted in the browser and uploaded to IPFS
- reviewer verdicts are written as EAS attestations on Base
- auth and wallet connectivity use thirdweb

## Verified Commands

Use these first when validating work:

```bash
npm install
npm run dev
npm run build
npm run launch:bug-index:dry-run
npm run launch:bug-index
```

## Key Paths

- `contracts/CheapBugsBugIndex.sol`: Base bug index contract
- `scripts/launch-bug-index.mjs`: compile/deploy launcher for the bug index contract
- `src/contracts/bugIndex.ts`: frontend read/write adapter for the bug index contract
- `src/auth/thirdweb.ts`: email login and external wallet connectivity
- `src/storage/thirdweb.ts`: default static-friendly IPFS storage provider
- `src/storage/pinata.ts`: presigned-upload Pinata adapter
- `src/attest/eas.ts`: EAS write adapter for verdicts and payout placeholders
- `src/lib/reports.ts`: submission, loading, decryption, and review orchestration
- `src/config/env.ts`: env parsing and defaults
- `src/config/chains.ts`: chain isolation, currently Base-oriented

## Project Conventions

- Keep the app deployable as static assets. Do not introduce SSR or a backend database.
- Keep browser-side thirdweb usage limited to `clientId`. Never expose a `secretKey` in client code.
- Keep Pinata credentials out of the browser. Use only presigned upload URLs if Pinata is enabled.
- Treat all IPFS content and EAS note content as untrusted user input.
- Never upload sensitive bug details publicly in plaintext.
- Public report metadata is onchain. Private dossier material must be encrypted before upload.
- Use small, testable modules and keep vendor-specific logic behind adapters.
- Chain-specific values must stay isolated in config modules.

## Current Implementation Notes

- Base mainnet is the default chain configuration.
- The submit path writes public reports to the Base bug index contract, not to an EAS submission-pointer schema.
- EAS is currently used for `ReviewVerdict` and a `PayoutRecord` placeholder only.
- Reviewer trust is frontend-enforced through an allowlist in config. This is an MVP choice and should be replaceable later.
- The launcher script refreshes the frontend ABI file after compilation so the app stays aligned with the contract.
- GitHub Pages deployment uses a GitHub Actions workflow, repo-aware Vite base paths, and hash routing for SPA compatibility.
- GitHub Pages should stay on the GitHub Actions workflow source, not legacy branch publishing.
- The default public thirdweb client ID is committed in config; deployments may override it with `VITE_THIRDWEB_CLIENT_ID`.

## Known Issues And Practical Tips

- `npm run build` currently succeeds but emits large-chunk warnings because of the thirdweb dependency graph.
- Real onchain submission requires `VITE_BUG_INDEX_ADDRESS` to be set.
- Real verdict writes require `VITE_REVIEW_VERDICT_SCHEMA_UID` to be set.
- The contract launcher needs `BUG_INDEX_DEPLOYER_PRIVATE_KEY` for a real deployment.
- `artifacts/` and `dist/` are generated outputs and should not be committed unless the user explicitly asks.

## Collaborator Preferences

- Keep communication direct and concise.
- Prefer implementation over long planning when the task is actionable.
- Maintain clean extension points for future product areas instead of premature feature sprawl.
- Commit and push after each completed task.

## Update Guidance

When updating this file, keep it compact and high-signal. Replace stale guidance instead of only appending new notes.

When architecture changes, do not leave `ARCHITECTURE.md` stale. Treat it as a living system map for future agents.
