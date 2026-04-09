# Architecture Overview

This document is a living system map for CheapBugs. It is intended to help agents and contributors understand where major responsibilities live, how data moves through the app, and which boundaries should remain stable as the project evolves.

Update this file whenever the codebase's architecture, deployment assumptions, integrations, or navigation map materially change.

## 1. Project Structure

The repository is a static Vite application with one Solidity contract, one deployment script, and a modular TypeScript frontend.

```text
cheapbugs/
├── contracts/              # Solidity contracts, currently the Base bug index contract
├── scripts/                # Deployment and maintenance scripts
├── public/                 # Static assets and SPA hosting helpers
├── src/
│   ├── attest/             # EAS write adapters
│   ├── auth/               # thirdweb auth and wallet connectivity
│   ├── config/             # chain, env, and reviewer configuration
│   ├── contracts/          # frontend contract ABI and adapters
│   ├── lib/                # core domain logic, crypto, IPFS, caching, utilities
│   ├── storage/            # storage-provider implementations
│   ├── types/              # domain and integration types
│   └── views/              # route-level UI rendering
├── README.md               # setup and high-level overview
├── DEPLOY.md               # deployment workflow
├── TODO.md                 # known follow-up work
├── AGENTS.md               # coding-agent instructions
└── ARCHITECTURE.md         # this document
```

## 2. High-Level System Diagram

```text
[Reporter / Reviewer Browser]
        |
        v
[Static Vite Frontend]
  |        |         |
  |        |         +--> [EAS on Base] <--> [EAS GraphQL API]
  |        |
  |        +--------------> [IPFS via thirdweb Storage or Pinata presigned upload]
  |
  +-----------------------> [CheapBugsBugIndex on Base]
```

System boundaries:

- The frontend is the only application runtime. There is no backend database or SSR layer.
- Public-safe report metadata is stored onchain in the bug index contract.
- Sensitive report details are encrypted client-side before they leave the browser.
- Reviewer verdicts are onchain EAS attestations but are read via the EAS GraphQL API in the frontend.

## 3. Core Components

### 3.1. Frontend Application

Name: CheapBugs static web app

Description: A narrow-layout, milw0rm-inspired frontend for login, report submission, public browsing, report review, and local decryption of private dossiers.

Technologies: Vite, TypeScript, vanilla HTML/CSS/TS modules, thirdweb SDK, ethers, viem

Deployment: Static assets from `dist/`, suitable for Netlify, Cloudflare Pages, Vercel static hosting, GitHub Pages, or IPFS-aware static hosting

### 3.2. Onchain Report Index

Name: `CheapBugsBugIndex`

Description: The canonical onchain index for public-safe report records on Base. It stores immutable report metadata and provides basic retrieval of individual and recent reports.

Technologies: Solidity 0.8.24, Base, ethers/viem integration from the frontend

Deployment: Deployed with [scripts/launch-bug-index.mjs](/home/pierce/projects/cheapbugs/scripts/launch-bug-index.mjs)

### 3.3. Attestation Layer

Name: EAS integration

Description: Handles onchain reviewer verdict attestations and a placeholder payout record schema. Reads are performed through EAS GraphQL; writes use the EAS SDK from the connected wallet.

Technologies: `@ethereum-attestation-service/eas-sdk`, Base EAS contracts, EAS GraphQL API

Deployment: External network dependency on Base EAS contracts and EAS Scan indexing infrastructure

### 3.4. Storage Layer

Name: StorageProvider abstraction

Description: Provides pluggable upload/download support for encrypted dossier JSON and optional public reviewer notes. Default path is thirdweb storage. Pinata is available only behind a presigned-upload helper.

Technologies: thirdweb storage SDK, Pinata presigned uploads, IPFS gateways

Deployment: Browser-side integration; no app-owned storage server in the MVP

## 4. Data Stores

### 4.1. Onchain Report Store

Name: Base bug index contract

Type: EVM smart contract storage

Purpose: Stores public-safe `SubmissionPublic` fields, including the encrypted payload CID, reporter, timestamps, and hashed target reference.

Key Records:

- submission records keyed by `reportHash`
- reviewer allowlist entries in the contract for future use
- recent report hash ordering

### 4.2. IPFS Blob Store

Name: Encrypted dossier storage

Type: IPFS content-addressed object storage

Purpose: Stores encrypted `SubmissionPrivate` payloads and optional reviewer note JSON blobs.

Key Objects:

- encrypted private dossier JSON
- optional reviewer note JSON

### 4.3. Attestation Store

Name: EAS on Base

Type: Onchain attestation registry plus indexed GraphQL read model

Purpose: Stores `ReviewVerdict` attestations and future `PayoutRecord` attestations.

Key Schemas:

- `ReviewVerdict`
- `PayoutRecord`

## 5. External Integrations / APIs

thirdweb:

- Purpose: Email login, in-app wallet creation, external wallet connectivity, and default IPFS upload/download
- Integration Method: SDK in [src/auth/thirdweb.ts](/home/pierce/projects/cheapbugs/src/auth/thirdweb.ts) and [src/storage/thirdweb.ts](/home/pierce/projects/cheapbugs/src/storage/thirdweb.ts)
- Configuration: the app ships with a committed public `clientId` default and still allows `VITE_THIRDWEB_CLIENT_ID` overrides

ENS:

- Purpose: Resolve connected wallet ENS name and avatar for the session UI
- Integration Method: Browser-side Ethereum mainnet RPC reads in [src/lib/ens.ts](/home/pierce/projects/cheapbugs/src/lib/ens.ts), surfaced through [src/auth/thirdweb.ts](/home/pierce/projects/cheapbugs/src/auth/thirdweb.ts)
- Configuration: defaults to a public Ethereum mainnet RPC and allows `VITE_ENS_RPC_URL` overrides

EAS:

- Purpose: Onchain reviewer verdicts and placeholder payout attestations
- Integration Method: SDK writes in [src/attest/eas.ts](/home/pierce/projects/cheapbugs/src/attest/eas.ts), GraphQL reads in [src/lib/eas.ts](/home/pierce/projects/cheapbugs/src/lib/eas.ts)

Pinata:

- Purpose: Optional alternative IPFS upload provider
- Integration Method: Presigned upload URLs only, via [src/storage/pinata.ts](/home/pierce/projects/cheapbugs/src/storage/pinata.ts)

Base RPC:

- Purpose: Contract reads, writes, and deployment
- Integration Method: Configured in [src/config/env.ts](/home/pierce/projects/cheapbugs/src/config/env.ts) and consumed by the frontend and launcher

## 6. Deployment & Infrastructure

Cloud Provider: Not fixed. The app is designed for generic static hosting.

Key Services Used:

- static asset host for `dist/`
- GitHub Pages
- Base RPC endpoint
- thirdweb client infrastructure
- EAS contracts and indexing
- IPFS storage/gateway infrastructure

CI/CD Pipeline: GitHub Actions builds and deploys `dist/` to GitHub Pages on pushes to `main`, with GitHub Pages configured for workflow-based publishing, a root `/` asset base for the `cheapbugs.net` custom domain, and a committed public thirdweb `clientId` by default

Monitoring & Logging: Browser console and wallet/provider errors only in the current MVP

## 7. Security Considerations

Authentication:

- thirdweb email verification flow with in-app wallet support
- external wallet connect for advanced users

Authorization:

- reviewer UI trust is currently determined by a frontend allowlist in [src/config/reviewers.ts](/home/pierce/projects/cheapbugs/src/config/reviewers.ts)
- report submission requires a connected wallet on Base

Data Encryption:

- private dossier content is encrypted in the browser before IPFS upload
- transport security depends on HTTPS and wallet/provider infrastructure

Key Security Practices:

- never place thirdweb `secretKey` in browser code
- never place Pinata API credentials in browser code
- treat all IPFS and EAS note content as untrusted input
- store only redacted/public-safe metadata onchain

## 8. Development & Testing Environment

Local Setup Instructions:

- install dependencies with `npm install`
- copy `.env.example` to `.env.local`
- optionally override `VITE_THIRDWEB_CLIENT_ID` or `VITE_ENS_RPC_URL`
- deploy the bug index contract or set `VITE_BUG_INDEX_ADDRESS`

Testing / Verification Commands:

- `npm run dev`
- `npm run build`
- `npm run launch:bug-index:dry-run`
- GitHub Actions Pages workflow in `.github/workflows/deploy-pages.yml`

Code Quality Tools:

- TypeScript strict mode
- Vite production build
- manual architectural documentation in `AGENTS.md` and `ARCHITECTURE.md`

## 9. Future Considerations / Roadmap

- Replace the frontend reviewer allowlist with an onchain reviewer registry or resolver-backed trust model.
- Add payout execution while keeping `PayoutRecord` as the public record layer.
- Add patron leaderboard, token gating, treasury logic, and governance as separate extensions.
- Reduce thirdweb-driven bundle size with route or adapter-level code splitting.
- Add automated CI and ABI drift checks.

## 10. Project Identification

Project Name: CheapBugs

Repository URL: `git@github.com:pierce403/cheapbugs.git`

Primary Contact/Team: `pierce403`

Date of Last Update: 2026-04-09

## 11. Glossary / Acronyms

Base: The default EVM chain used by the app and contract deployment flow.

Bug Index: The onchain `CheapBugsBugIndex` contract that stores public-safe report metadata.

CID: A content identifier used to locate IPFS-hosted content.

EAS: Ethereum Attestation Service.

IPFS: InterPlanetary File System, used here for encrypted dossier and note storage.

SubmissionPrivate: The sensitive report payload that must be encrypted before upload.

SubmissionPublic: The redacted public record written onchain.
