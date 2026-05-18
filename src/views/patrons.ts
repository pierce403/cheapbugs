import { ENS_APP_URL } from "../lib/ens";
import { appLog } from "../lib/logger";
import { loadPatronLeaderboard, loadTokenDashboard, refreshPatronLeaderboard } from "../lib/token";
import { escapeHtml, formatTokenAmount, shortHash } from "../lib/utils";

import type { AppViewContext, ViewResult } from "./types";

export const renderPatronsView = async (context: AppViewContext): Promise<ViewResult> => {
  const [dashboard, leaderboard] = await Promise.all([
    loadTokenDashboard(context.session.address, { includeTreasury: false }),
    loadPatronLeaderboard(50)
  ]);

  const warnings = [
    !dashboard.isConfigured
      ? "BUGZ is not configured yet. The patrons board will stay empty until the token contract is deployed and VITE_BUGZ_TOKEN_ADDRESS is set."
      : "",
    dashboard.isConfigured && !dashboard.patronScanReady
      ? "Set VITE_ETHERSCAN_API_KEY or VITE_BUGZ_TOKEN_DEPLOYMENT_BLOCK so the frontend can resolve BUGZ holders."
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

  const formatCacheTime = (value: number | null): string =>
    value ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "-";

  const holderApiHelp =
    !leaderboard.isHolderApiConfigured || leaderboard.errorMessage
      ? `
        <p class="helper-copy">
          For more reliable holder data, add <code>VITE_ETHERSCAN_API_KEY</code> or <code>VITE_BASESCAN_API_KEY</code>
          from the <a href="${escapeHtml(leaderboard.holderApiKeyUrl)}" target="_blank" rel="noreferrer">Etherscan API Dashboard</a>.
          Etherscan documents <a href="${escapeHtml(leaderboard.holderApiDocsUrl)}" target="_blank" rel="noreferrer">tokenholderlist</a>
          as a V2 holder endpoint for Base.
        </p>
      `
      : "";

  return {
    title: "Patrons",
    html: `
      <section class="panel">
        <div class="panel-title">[ patrons leaderboard ]</div>
        ${warnings}
        <p class="lede">
          Ranked by BUGZ balances from ${escapeHtml(leaderboard.sourceLabel)}. Results are cached locally for one day.
        </p>
        <p class="helper-copy">
          cache: refreshed ${escapeHtml(formatCacheTime(leaderboard.updatedAt))} / next auto refresh ${escapeHtml(
            formatCacheTime(leaderboard.nextRefreshAt)
          )}
        </p>
        ${holderApiHelp}
        <div class="button-row">
          <button id="refresh-patrons" class="button secondary" type="button">refresh holders</button>
          <a class="button secondary" href="${escapeHtml(leaderboard.holdersUrl)}" target="_blank" rel="noreferrer">basescan holders</a>
        </div>
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
    `,
    afterRender: (root, appContext) => {
      root.querySelector<HTMLButtonElement>("#refresh-patrons")?.addEventListener("click", () => {
        appLog.info("ui: patrons refresh click");
        refreshPatronLeaderboard();
        appContext.notify("info", "Refreshing BUGZ holder cache.");
      });
    }
  };
};
