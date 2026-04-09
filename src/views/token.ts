import { chainConfig } from "../config/chains";
import { buildBugzBuyUrl, loadTokenDashboard } from "../lib/token";
import { escapeHtml, formatTokenAmount, textOrDash } from "../lib/utils";

import type { AppViewContext, ViewResult } from "./types";

const destinationValue = (context: AppViewContext): string => context.session.address ?? "";

export const renderTokenView = async (context: AppViewContext): Promise<ViewResult> => {
  const dashboard = await loadTokenDashboard(context.session.address);
  const warnings = [
    !dashboard.isConfigured
      ? "BUGZ is not deployed/configured in this build yet. The token manager and patrons view stay in placeholder mode until VITE_BUGZ_TOKEN_ADDRESS is set."
      : "",
    dashboard.treasuryAddress
      ? ""
      : "VITE_BUGZ_TREASURY_ADDRESS is unset, so treasury size cannot be resolved yet.",
    dashboard.errorMessage ?? ""
  ]
    .filter(Boolean)
    .map((message) => `<p class="warning-copy">${escapeHtml(message)}</p>`)
    .join("");

  return {
    title: "Token",
    html: `
      <section class="panel">
        <div class="panel-title">[ bugz token manager ]</div>
        ${warnings}
        <p class="lede">
          This route is the BUGZ control panel. It exposes holder balance, treasury state, and the future buy-flow entry point
          without assuming the token sale contracts exist yet.
        </p>
        <table class="data-table compact-table">
          <tbody>
            <tr><th>token</th><td>${escapeHtml(textOrDash(dashboard.tokenAddress))}</td></tr>
            <tr><th>name</th><td>${escapeHtml(dashboard.name)}</td></tr>
            <tr><th>symbol</th><td>${escapeHtml(dashboard.symbol)}</td></tr>
            <tr><th>total supply</th><td>${dashboard.totalSupply !== null ? `${escapeHtml(formatTokenAmount(dashboard.totalSupply, dashboard.decimals))} ${escapeHtml(dashboard.symbol)}` : "-"}</td></tr>
            <tr><th>your balance</th><td>${context.session.address ? (dashboard.connectedBalance !== null ? `${escapeHtml(formatTokenAmount(dashboard.connectedBalance, dashboard.decimals))} ${escapeHtml(dashboard.symbol)}` : "-") : `<a href="${context.router.href("/login")}" data-nav>connect at /login</a>`}</td></tr>
            <tr><th>treasury</th><td>${escapeHtml(textOrDash(dashboard.treasuryAddress))}</td></tr>
            <tr><th>treasury bugz</th><td>${dashboard.treasuryTokenBalance !== null ? `${escapeHtml(formatTokenAmount(dashboard.treasuryTokenBalance, dashboard.decimals))} ${escapeHtml(dashboard.symbol)}` : "-"}</td></tr>
            <tr><th>treasury ${escapeHtml(chainConfig.nativeSymbol)}</th><td>${dashboard.treasuryNativeBalance !== null ? `${escapeHtml(formatTokenAmount(dashboard.treasuryNativeBalance, 18))} ${escapeHtml(chainConfig.nativeSymbol)}` : "-"}</td></tr>
            <tr><th>holder scan</th><td>${escapeHtml(dashboard.patronScanStatus)}</td></tr>
          </tbody>
        </table>
      </section>

      <section class="panel">
        <div class="panel-title">[ buy bugz ]</div>
        <p class="helper-copy">
          This is a launch pad, not a live sale contract. It can hand off amount and wallet details to an external buy flow later,
          but today it mostly serves as a clean placeholder.
        </p>
        <form id="bugz-buy-form" class="stack-form narrow-form">
          <div class="two-column">
            <label>
              desired amount
              <input name="amount" type="number" min="1" step="1" value="1000" />
            </label>
            <label>
              destination wallet
              <input name="wallet" value="${escapeHtml(destinationValue(context))}" placeholder="0x..." />
            </label>
          </div>
          <div id="bugz-buy-preview" class="buy-preview"></div>
          <div class="button-row">
            <button class="button" type="submit" ${dashboard.buyUrl ? "" : "disabled"}>${dashboard.buyUrl ? "open buy flow" : "buy flow offline"}</button>
            <button id="copy-buy-intent" class="button secondary" type="button">copy intent</button>
          </div>
        </form>
      </section>
    `,
    afterRender: (root, appContext) => {
      const form = root.querySelector<HTMLFormElement>("#bugz-buy-form");
      const amountInput = form?.querySelector<HTMLInputElement>('input[name="amount"]') ?? null;
      const walletInput = form?.querySelector<HTMLInputElement>('input[name="wallet"]') ?? null;
      const preview = root.querySelector<HTMLElement>("#bugz-buy-preview");
      const copyIntent = root.querySelector<HTMLButtonElement>("#copy-buy-intent");

      const syncPreview = () => {
        if (!preview) {
          return;
        }

        const amount = amountInput?.value || "0";
        const wallet = walletInput?.value || "(wallet missing)";
        preview.innerHTML = `
          <strong>intent</strong>: buy ${escapeHtml(amount)} ${escapeHtml(dashboard.symbol)} for ${escapeHtml(wallet)}<br />
          source: ${dashboard.buyUrl ? escapeHtml(dashboard.buyUrl) : "not configured yet"}
        `;
      };

      syncPreview();
      amountInput?.addEventListener("input", syncPreview);
      walletInput?.addEventListener("input", syncPreview);

      copyIntent?.addEventListener("click", async () => {
        const amount = amountInput?.value || "0";
        const wallet = walletInput?.value || "";
        const intent = [
          "BUGZ buy intent",
          `amount=${amount}`,
          `wallet=${wallet || "(missing)"}`,
          `token=${dashboard.tokenAddress || "(undeployed)"}`,
          `chain=${appContext.session.address ? "Base connected" : "Base not connected"}`
        ].join("\n");

        try {
          await navigator.clipboard.writeText(intent);
          appContext.notify("success", "BUGZ buy intent copied.");
        } catch (error) {
          appContext.notify("error", error instanceof Error ? error.message : "Copy failed.");
        }
      });

      form?.addEventListener("submit", (event) => {
        event.preventDefault();
        const amount = amountInput?.value || "";
        const wallet = walletInput?.value || destinationValue(appContext);
        const buyUrl = buildBugzBuyUrl(amount, wallet);

        if (!buyUrl) {
          appContext.notify("info", "Buy flow is not configured yet. Deploy BUGZ and set VITE_BUGZ_BUY_URL to enable this button.");
          return;
        }

        window.open(buyUrl, "_blank", "noopener,noreferrer");
        appContext.notify("success", "Opened the external BUGZ buy flow.");
      });
    }
  };
};
