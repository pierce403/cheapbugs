import { chainConfig } from "../config/chains";
import { escapeHtml } from "../lib/utils";

import type { AppViewContext, ViewResult } from "./types";

export const renderAboutView = async (_context: AppViewContext): Promise<ViewResult> => ({
  title: "About CheapBugs",
  html: `
    <section class="panel about-panel" data-testid="about-panel">
      <div class="panel-title">[ about ]</div>
      <p class="lede">
        CheapBugs is a public bug-report market for funding useful security work, publishing public-safe metadata, and
        paying reporters from a community treasury after reports survive review.
      </p>
    </section>

    <section class="panel about-panel">
      <div class="panel-title">[ bug lifecycle ]</div>
      <div class="about-grid">
        <article>
          <h2>1. submission</h2>
          <p>
            A reporter writes public metadata plus private reproduction details in the browser. The browser encrypts
            private details client-side, builds a BugBundle, signs a PublishBug EIP-712 authorization, and sends the
            bundle and reveal key to the broker over XMTP.
          </p>
        </article>
        <article>
          <h2>2. broker publish</h2>
          <p>
            The broker verifies the schema, reporter signature, target fields, details-key commitment, encrypted-details
            hash, and reporter credentials. Valid bundles are pinned to IPFS, then published to CheapBugsBugIndex on Base.
          </p>
        </article>
        <article>
          <h2>3. judging window</h2>
          <p>
            Public metadata is visible immediately. Private details stay encrypted for at least seven days while admins
            classify the report as valid, invalid, or spam and bonded users can vote up or down with bond-weighted power.
          </p>
        </article>
        <article>
          <h2>4. reveal and payout</h2>
          <p>
            After the reveal window, a broker completes reports in index order. The index reveals the details key if
            needed, records payout state, and calls the treasury vault for the final BUGZ transfer.
          </p>
        </article>
      </div>
    </section>

    <section class="panel about-panel">
      <div class="panel-title">[ smart contracts ]</div>
      <table class="data-table compact-table">
        <tbody>
          <tr>
            <th>bug index</th>
            <td>
              Broker-published report registry with reporter EIP-712 signatures, one-time nonces, seven-day reveal
              enforcement, bonded voting, admin status, details-key reveal, and ordered payout completion.
            </td>
          </tr>
          <tr>
            <th>bond vault</th>
            <td>
              BUGZ bonding contract with active bonds, two-step seven-day withdrawals, pending-withdrawal slashing,
              owner-managed slashers, treasury-directed slash transfers, enumerable bonded accounts, and log10 levels.
            </td>
          </tr>
          <tr>
            <th>treasury vault</th>
            <td>
              BUGZ treasury for donations, detail-key purchase records, broker allowlisting, payout-divisor management,
              and index-gated reporter rewards capped at a 10x multiplier.
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="panel about-panel">
      <div class="panel-title">[ tokenomics ]</div>
      <div class="about-grid">
        <article>
          <h2>treasury-funded rewards</h2>
          <p>
            The standard payout is the treasury balance divided by the configured divisor, currently designed around
            0.1% of treasury funds. Brokers can apply a multiplier up to 10 for high-interest reports, making the normal
            payout range 0.1% to 1% of the treasury.
          </p>
        </article>
        <article>
          <h2>bond and reputation</h2>
          <p>
            BUGZ bonds are not burned during normal participation. They establish voting level and abuse resistance.
            Pending withdrawals stop counting toward vote power but remain slashable until released.
          </p>
        </article>
        <article>
          <h2>detail-key demand</h2>
          <p>
            Detail-key purchases move BUGZ into the treasury and leave onchain purchase records for broker verification.
            This lets private report access strengthen the pool that pays future reporters.
          </p>
        </article>
        <article>
          <h2>open funding</h2>
          <p>
            Anyone can send BUGZ to the treasury. Larger treasury balances increase the BUGZ amount available for future
            payouts without changing the ordered payout and validity checks.
          </p>
        </article>
      </div>
    </section>

    <section class="panel about-panel">
      <div class="panel-title">[ tech stack ]</div>
      <table class="data-table compact-table">
        <tbody>
          <tr><th>frontend</th><td>Static Vite and TypeScript deployed as HTML, CSS, and JavaScript.</td></tr>
          <tr><th>wallets</th><td>Thirdweb external wallets, WalletConnect, embedded CheapBugs wallets, SIWE session restore, and ENS display.</td></tr>
          <tr><th>comms</th><td>XMTP DMs carry structured broker submissions and broker status updates.</td></tr>
          <tr><th>storage</th><td>Encrypted BugBundles are pinned to IPFS; the app caches public bundle data locally to reduce gateway traffic.</td></tr>
          <tr><th>chain</th><td>${escapeHtml(chainConfig.name)} for BUGZ, bonding, treasury, bug index, and payout execution.</td></tr>
          <tr><th>review metadata</th><td>EAS is used for reviewer verdict attestations while core payout state lives in the bug index.</td></tr>
          <tr><th>verification</th><td>Foundry covers contracts; Playwright covers browser flows and RPC-safe UI behavior.</td></tr>
        </tbody>
      </table>
    </section>
  `
});
