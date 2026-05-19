import { chainConfig } from "../config/chains";
import { loadTreasuryDashboard, usdValueForBugz } from "../lib/treasury";
import { escapeHtml, formatDate, formatTokenAmount, textOrDash } from "../lib/utils";

import type { AppViewContext, ViewResult } from "./types";

const tokenAmount = (value: bigint | null, decimals: number, symbol: string): string =>
  value !== null ? `${formatTokenAmount(value, decimals)} ${symbol}` : "-";

const usdAmount = (value: bigint | null, decimals: number | null | undefined): string => {
  if (value === null || decimals === null || decimals === undefined) {
    return "-";
  }

  const scale = 10n ** BigInt(decimals);
  const cents = (value * 100n + scale / 2n) / scale;
  if (value > 0n && cents === 0n) {
    return "<$0.01";
  }

  const whole = cents / 100n;
  const fractional = (cents % 100n).toString().padStart(2, "0");
  return `$${whole.toLocaleString()}.${fractional}`;
};

const percentFromDivisor = (multiplier: number, divisor: bigint | null): string => {
  if (!divisor || divisor <= 0n) {
    return multiplier === 1 ? "0.1%" : "1%";
  }

  const hundredths = (10_000n * BigInt(multiplier) + divisor / 2n) / divisor;
  const whole = hundredths / 100n;
  const fractional = (hundredths % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return fractional ? `${whole}.${fractional}%` : `${whole}%`;
};

export const renderTreasuryView = async (context: AppViewContext): Promise<ViewResult> => {
  const dashboard = await loadTreasuryDashboard({
    background: true,
    onUpdate: context.rerender
  });
  const quoteDecimals = dashboard.usdQuote?.ethUsdDecimals ?? null;
  const treasuryUsd = usdValueForBugz(dashboard.treasuryBalance, dashboard.usdQuote);
  const minPayoutUsd = usdValueForBugz(dashboard.minPayout, dashboard.usdQuote);
  const maxPayoutUsd = usdValueForBugz(dashboard.maxPayout, dashboard.usdQuote);
  const oneBugz = 10n ** BigInt(dashboard.decimals);
  const oneBugzUsd = usdValueForBugz(oneBugz, dashboard.usdQuote);
  const payoutPercentRange = `${percentFromDivisor(1, dashboard.standardPayoutDivisor)} - ${percentFromDivisor(
    10,
    dashboard.standardPayoutDivisor
  )}`;
  const warnings = [
    !dashboard.isConfigured ? "The BUGZ token or treasury vault is not configured for this deployment." : "",
    dashboard.errorMessage ?? ""
  ]
    .filter(Boolean)
    .map((message) => `<p class="warning-copy">${escapeHtml(message)}</p>`)
    .join("");

  return {
    title: "Treasury",
    html: `
      <section class="panel treasury-page-panel" data-testid="treasury-panel">
        <div class="panel-title">[ treasury ]</div>
        ${warnings}
        <p class="lede">
          The treasury funds CheapBugs payouts. Send BUGZ to the treasury vault to increase the reward pool for future reports.
        </p>

        <div class="metric-grid treasury-metric-grid">
          <div data-testid="treasury-value">
            <span>current treasury value</span>
            <strong>${escapeHtml(tokenAmount(dashboard.treasuryBalance, dashboard.decimals, dashboard.symbol))}</strong>
            <small>${escapeHtml(usdAmount(treasuryUsd, quoteDecimals))}</small>
          </div>
          <div data-testid="treasury-payout-range">
            <span>base payout range per bug</span>
            <strong>${escapeHtml(tokenAmount(dashboard.minPayout, dashboard.decimals, dashboard.symbol))} - ${escapeHtml(
              tokenAmount(dashboard.maxPayout, dashboard.decimals, dashboard.symbol)
            )}</strong>
            <small>${escapeHtml(usdAmount(minPayoutUsd, quoteDecimals))} - ${escapeHtml(
              usdAmount(maxPayoutUsd, quoteDecimals)
            )}</small>
          </div>
          <div>
            <span>payout share</span>
            <strong>${escapeHtml(payoutPercentRange)}</strong>
            <small>standard payout to 10x high-interest cap</small>
          </div>
          <div>
            <span>BUGZ price estimate</span>
            <strong>${escapeHtml(usdAmount(oneBugzUsd, quoteDecimals))}</strong>
            <small>via ${escapeHtml(dashboard.priceSourceLabel)}</small>
          </div>
        </div>

        <div class="treasury-actions">
          <button id="copy-treasury-address" class="button" type="button" ${
            dashboard.treasuryAddress ? "" : "disabled"
          }>copy treasury address</button>
          <a class="button secondary" href="${context.router.href("/token")}" data-nav>get BUGZ</a>
          <a class="button secondary" href="${escapeHtml(dashboard.marketUrl)}" target="_blank" rel="noreferrer">open market</a>
        </div>

        <table class="data-table compact-table">
          <tbody>
            <tr><th>treasury vault</th><td><code>${escapeHtml(textOrDash(dashboard.treasuryAddress))}</code></td></tr>
            <tr><th>BUGZ token</th><td><code>${escapeHtml(textOrDash(dashboard.tokenAddress))}</code></td></tr>
            <tr><th>standard payout divisor</th><td>${escapeHtml(dashboard.standardPayoutDivisor?.toString() ?? "-")}</td></tr>
            <tr><th>USD source</th><td><a href="${escapeHtml(dashboard.priceSourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(
              dashboard.priceSourceLabel
            )}</a></td></tr>
            <tr><th>ETH/USD updated</th><td>${escapeHtml(
              dashboard.usdQuote ? formatDate(new Date(dashboard.usdQuote.feedUpdatedAt * 1000).toISOString()) : "-"
            )}</td></tr>
            <tr><th>price feed</th><td><code>${escapeHtml(dashboard.usdQuote?.feedAddress ?? chainConfig.ethUsdFeedAddress ?? "-")}</code></td></tr>
          </tbody>
        </table>
      </section>
    `,
    afterRender: (root, appContext) => {
      root.querySelector<HTMLButtonElement>("#copy-treasury-address")?.addEventListener("click", async () => {
        if (!dashboard.treasuryAddress) {
          return;
        }

        try {
          await navigator.clipboard.writeText(dashboard.treasuryAddress);
          appContext.notify("success", "Treasury address copied.");
        } catch {
          appContext.notify("info", `Treasury vault: ${dashboard.treasuryAddress}`);
        }
      });
    }
  };
};
