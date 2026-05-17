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
7. Only then send the final completion message to the user, including the commit SHA or a clear push failure note.

Default rule: do not leave completed work uncommitted or unpushed, and do not report a task as done before the push attempt has happened.

Allowed exceptions:

- The user explicitly says not to commit or not to push.
- The task is still in an intermediate or broken state and is not actually complete.
- Push fails because of auth, branch protection, or network issues. In that case, report the failure clearly.

## Project Overview

CheapBugs is a static Vite + TypeScript application for Base-native bug reporting and review.

Current architecture:

- public-safe report metadata is written onchain to the `CheapBugsBugIndex` contract on Base
- private report details are encrypted in the browser and uploaded to IPFS
- reviewer verdicts are written as EAS attestations on Base
- auth and wallet connectivity use Thirdweb wallets with injected browser wallet and WalletConnect QR support

## Verified Commands

Use these first when validating work:

```bash
npm install
npm run dev
npm run build
npm run contracts:build
npm run contracts:test
npm run launch:bug-index:dry-run
npm run launch:bug-index:forge:dry-run
npm run launch:bug-index
npm run launch:token:dry-run
npm run launch:token
```

## Key Paths

- `contracts/CheapBugsBugIndex.sol`: Base bug index contract
- `contracts/CheapBugsToken.sol`: BUGZ ERC20 extension contract
- `cheapbugs.png`: source brand/social artwork dropped at the repo root
- `public/cheapbugs.png`, `public/cheapbugs-mark.png`, `public/og-image.png`, `public/favicon.png`, `public/favicon.ico`, `public/apple-touch-icon.png`: served brand, OpenGraph, and icon assets derived from `cheapbugs.png`
- `script/LaunchBugIndex.s.sol`: Foundry deploy script for the bug index contract
- `test/CheapBugsBugIndex.t.sol`: Foundry scenario tests for report submission and reviewer votes
- `scripts/launch-bug-index.mjs`: compile/deploy launcher for the bug index contract
- `scripts/launch-bug-index-forge.sh`: shell wrapper for the Forge bug index launcher
- `scripts/launch-token.mjs`: compile/deploy launcher for the BUGZ token contract
- `src/contracts/bugIndex.ts`: frontend read/write adapter for the bug index contract
- `src/contracts/bugzToken.ts`: read-only BUGZ adapter for metadata, connected-wallet balances, optional treasury stats, and patron scans
- `src/contracts/bugzTrade.ts`: static frontend Uniswap v4 trade adapter for BUGZ buy/sell on Base
- `src/contracts/bugzTokenAbi.ts`: generated frontend ABI module for the BUGZ token contract
- `src/auth/thirdweb.ts`: Thirdweb wallet, WalletConnect QR, local SIWE proof, and signer adapter
- `src/auth/localIdentity.ts`: browser-stored generated XMTP wallet identity helper
- `src/lib/logger.ts`: namespaced browser console logging helper for click/auth/debug breadcrumbs
- `src/xmtp/browser.ts`: browser XMTP SDK adapter for local/external wallet signers
- `src/xmtp/bouncer.ts`: structured bouncer submission DM helper
- `src/storage/gateway.ts`: static IPFS gateway reader and disabled-upload fallback
- `src/storage/pinata.ts`: presigned-upload Pinata adapter
- `src/attest/eas.ts`: EAS write adapter for verdicts and payout placeholders
- `src/lib/reports.ts`: submission, loading, decryption, and review orchestration
- `src/config/env.ts`: env parsing and defaults
- `src/config/chains.ts`: chain isolation, currently Base-oriented
- `scripts/bouncer-bot.py`: Python XMTP-to-Signal bouncer runner
- `bots/cheapbugs_bouncer/`: bouncer command parsing, SQLite store, Signal CLI, and BUGZ payout adapters

## Project Conventions

- Keep the app deployable as static assets. Do not introduce SSR or a backend database.
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
- The bug index contract now includes reviewer-only onchain vote functions for contract-level testing and future extensions. The current frontend review state still comes from EAS.
- BUGZ is live on Base at `0x60Df4a0C9A5050c337010cb29C9694cE4d8fbb07` and is the default `VITE_BUGZ_TOKEN_ADDRESS`.
- The `/token` route reads connected-wallet BUGZ balances and performs static, browser-signed buy/sell swaps through the Uniswap v4 Quoter and Universal Router 2.1.1 on Base. Do not replace this with a backend buy-flow.
- The frontend nav is now `index`, `submit`, `review`, `token`, `patrons`, with login/session controls moved to the top-right header block.
- Reviewer trust is frontend-enforced through an allowlist in config. This is an MVP choice and should be replaceable later.
- The launcher scripts refresh their frontend ABI files after compilation so the app stays aligned with deployed contract shapes.
- Foundry is now configured with `contracts/` as the source directory, `script/` for deploy scripts, and `test/` for scenario coverage.
- `forge-std` is tracked as the `lib/forge-std` git submodule, so fresh clones need `git submodule update --init --recursive` before `forge build` or `forge test`.
- The BUGZ patrons leaderboard only works once `VITE_BUGZ_TOKEN_DEPLOYMENT_BLOCK` is configured. Treasury stats are optional display-only rows and must stay hidden when `VITE_BUGZ_TREASURY_ADDRESS` is unset.
- GitHub Pages deployment uses a GitHub Actions workflow, root-relative Vite base paths for the `cheapbugs.net` custom domain, and hash routing for SPA compatibility.
- GitHub Pages should stay on the GitHub Actions workflow source, not legacy branch publishing.
- Only set `VITE_BASE_PATH` when deploying under a non-root subpath. For the production Pages custom domain, it must stay `/`.
- The header login button calls `authController.connectPrimary()` directly instead of routing to `/login`. It prompts a Thirdweb installed-wallet SIWE first, then falls back to Thirdweb WalletConnect QR when browser login fails or no provider exists.
- Thirdweb auto-connect restores external wallet sessions after refresh. External wallet reconnect hints are stored locally in `cheapbugs.walletSession.v1`; SIWE proofs are stored in `cheapbugs.siweSession.v1` and restored without re-prompting when the wallet/domain/chain still match.
- Headless Thirdweb `wallet.connect()` does not populate the manager keys that `autoConnect()` reads, so `src/auth/thirdweb.ts` deliberately writes the compatible `thirdweb:connected-wallet-ids`, `thirdweb:active-wallet-id`, `thirdweb:last-used-wallet-id`, and `thirdweb:active-chain` localStorage keys after successful external-wallet login.
- Thirdweb wallet login uses `VITE_THIRDWEB_CLIENT_ID`; a public default client id is committed in `src/config/env.ts` for static deploys. Keep the root `thirdweb` dependency pinned to `5.119.4` unless deliberately testing a newer SDK, because `5.120.0` triggered npm peer-resolution conflicts in this repo.
- Browser console logging through `appLog` is intentionally verbose around auth clicks, Thirdweb provider selection, WalletConnect fallback, SIWE prompts, session restore, and failures so users can inspect what login is doing.
- Thirdweb was removed in `f7b7bca` and restored afterward; compare against `f7b7bca^` when looking for the last pre-direct-WalletConnect implementation.
- Connected wallet UI now resolves ENS name/avatar from Ethereum mainnet and should prompt users to create an ENS name when none is found.
- Link previews use static OpenGraph/Twitter metadata in `index.html` with `https://cheapbugs.net/og-image.png`; favicon and app icons are served from `public/`.
- `VITE_BOUNCER_XMTP_ADDRESS` switches the submit route to XMTP DM submission. The browser uses `@xmtp/browser-sdk` with a Converge-style local generated wallet (`cheapbugs.localXmtpIdentity.v1`) or an existing wallet signer.
- The XMTP browser SDK needs the Vite alias and `scripts/fix-xmtp-wasm-worker.mjs` shim for the sqlite worker file, matching the working pattern from `../converge.cv`.
- The Python bouncer uses `xmtp==0.1.5`, `signal-cli`, SQLite, and `web3.py`. Use `python3 -m unittest discover -s bots/tests -t bots` for bot tests.
- Bouncer rewards are ERC20 transfers from `BUGZ_PAYOUT_PRIVATE_KEY`, not mints. Fund and cap that wallet intentionally before running without `BOUNCER_DRY_RUN=1`.

## Known Issues And Practical Tips

- `npm run build` currently succeeds but emits large-chunk warnings because of the WalletConnect/XMTP dependency graph.
- GitHub Actions run pages show top-level status and annotations publicly, but step logs require GitHub sign-in.
- ENS avatar URLs are untrusted input. Only render sanitized HTTPS URLs or a local fallback badge.
- Local XMTP wallet keys are browser-stored recovery material. Users must copy the recovery key before relying on that wallet for BUGZ rewards.
- Local XMTP wallets can also sign BUGZ trade transactions from the browser via their stored private key; they still need Base ETH for gas and buys.
- BUGZ trading is Base-only and uses the Clanker-created Uniswap v4 WETH/BUGZ pool key configured in `src/config/env.ts`. Buys wrap ETH in Universal Router; sells require Permit2 approval before the router can pull BUGZ.
- BUGZ buy/sell must not depend on `VITE_BUGZ_TREASURY_ADDRESS`; if a token read returns `missing revert data`, first check that the configured RPC is Base mainnet.
- The header BUGZ status is intentionally terse, but token dashboard reads log `[cheapbugs] token:*` warnings and retry once before showing unavailable. Check `/token` and the browser console for the actual balance-read failure reason.
- The live BUGZ v4 pool was validated from Clanker `TokenCreated` block `46093316`: hook `0xb429d62f8f3bFFb98CdB9569533eA23bF0Ba28CC`, pool id `0x4c360c12ee8063e7170c344eba74f28ab0d3879c797ed46269202c3966234657`, dynamic fee flag `8388608`, tick spacing `200`, paired WETH.
- `ffmpeg` is available in the local environment and was used to derive favicon/OpenGraph PNG assets from `cheapbugs.png`.
- Signal reactions are social support signals only; they are not sybil-resistant votes.
- Real onchain submission requires `VITE_BUG_INDEX_ADDRESS` to be set.
- Real XMTP submission requires `VITE_BOUNCER_XMTP_ADDRESS` to point at an already registered bouncer XMTP inbox.
- Real verdict writes require `VITE_REVIEW_VERDICT_SCHEMA_UID` to be set.
- The contract launcher needs `BUG_INDEX_DEPLOYER_PRIVATE_KEY` for a real deployment.
- The token launcher needs `BUGZ_DEPLOYER_PRIVATE_KEY` for a real deployment.
- `artifacts/` and `dist/` are generated outputs and should not be committed unless the user explicitly asks.

## Collaborator Preferences

- Keep communication direct and concise.
- Prefer implementation over long planning when the task is actionable.
- Maintain clean extension points for future product areas instead of premature feature sprawl.
- Commit and push after each completed task, before the final response.

## Update Guidance

When updating this file, keep it compact and high-signal. Replace stale guidance instead of only appending new notes.

When architecture changes, do not leave `ARCHITECTURE.md` stale. Treat it as a living system map for future agents.
