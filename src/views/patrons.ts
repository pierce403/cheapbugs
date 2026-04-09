import { ENS_APP_URL } from "../lib/ens";
import { loadPatronLeaderboard, loadTokenDashboard } from "../lib/token";
import { escapeHtml, formatTokenAmount, shortHash } from "../lib/utils";

import type { AppViewContext, ViewResult } from "./types";

export const renderPatronsView = async (context: AppViewContext): Promise<ViewResult> => {
  const [dashboard, leaderboard] = await Promise.all([loadTokenDashboard(context.session.address), loadPatronLeaderboard(50)]);

  const warnings = [
    !dashboard.isConfigured
      ? "BUGZ is not configured yet. The patrons board will stay empty until the token contract is deployed and VITE_BUGZ_TOKEN_ADDRESS is set."
      : "",
    dashboard.isConfigured && !dashboard.patronScanReady
      ? "Set VITE_BUGZ_TOKEN_DEPLOYMENT_BLOCK after deployment so the frontend can reconstruct holder balances from Transfer logs."
      : "",
    leaderboard.errorMessage ?? ""
  ]
    .filter(Boolean)
    .map((message) => `<p class="warning-copy">${escapeHtml(message)}</p>`)
    .join("");

  const rows = leaderboard.entries.length
    ? leaderboard.entries
        .map((entry, index) => {
          return `
            <tr>
              <td>${escapeHtml(String(index + 1).padStart(2, "0"))}</td>
              <td>${entry.ensName ? escapeHtml(entry.ensName) : `${escapeHtml(shortHash(entry.address, 12, 6))} / <a href="${ENS_APP_URL}" target="_blank" rel="noreferrer">no ens</a>`}</td>
              <td>${escapeHtml(shortHash(entry.address, 14, 8))}</td>
              <td>${escapeHtml(formatTokenAmount(entry.balance, dashboard.decimals))} ${escapeHtml(dashboard.symbol)}</td>
              <td>${escapeHtml(entry.ensLookupStatus)}</td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="5" class="muted-cell">No patron balances resolved yet.</td></tr>`;

  return {
    title: "Patrons",
    html: `
      <section class="panel">
        <div class="panel-title">[ patrons leaderboard ]</div>
        ${warnings}
        <p class="lede">
          Ranked by live BUGZ balances reconstructed from Transfer logs. ENS names are shown when they resolve; otherwise the board falls back to raw addresses.
        </p>
        <table class="data-table">
          <thead>
            <tr>
              <th>rank</th>
              <th>patron</th>
              <th>address</th>
              <th>holdings</th>
              <th>ens</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
    `
  };
};
