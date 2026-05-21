import { chainConfig } from "../config/chains";
import { buyBugzOnchain, quoteBugzTrade, sellBugzOnchain, type BugzTradeQuote } from "../contracts/bugzTrade";
import { loadTokenDashboard } from "../lib/token";
import { escapeHtml, formatTokenAmount, shortHash, textOrDash } from "../lib/utils";

import type { AppViewContext, ViewResult } from "./types";

const AUTO_QUOTE_DELAY_MS = 650;

const tradeDisabled = (context: AppViewContext): string => (context.session.address ? "" : "disabled");

const tokenAmount = (value: bigint | null, decimals: number, symbol: string): string =>
  value !== null ? `${escapeHtml(formatTokenAmount(value, decimals))} ${escapeHtml(symbol)}` : "-";

const poolFeeLabel = (fee: number): string => (fee === 0x800000 ? "dynamic hook fee" : `${fee / 10_000}%`);

const quoteHtml = (quote: BugzTradeQuote): string => `
  <strong>quote</strong>: ${escapeHtml(formatTokenAmount(quote.amountIn, quote.inputDecimals))} ${escapeHtml(
    quote.inputSymbol
  )}
  -> ~${escapeHtml(formatTokenAmount(quote.amountOut, quote.outputDecimals))} ${escapeHtml(quote.outputSymbol)}<br />
  minimum out: ${escapeHtml(formatTokenAmount(quote.amountOutMinimum, quote.outputDecimals))} ${escapeHtml(
    quote.outputSymbol
  )}<br />
  pool: ${escapeHtml(shortHash(quote.pool.id || quote.pool.key.hooks, 12, 6))} / ${escapeHtml(
    quote.pool.protocol
  )} / ${escapeHtml(poolFeeLabel(quote.pool.key.fee))}
`;

export const renderTokenView = async (context: AppViewContext): Promise<ViewResult> => {
  const dashboard = await loadTokenDashboard(context.session.address);
  const warnings = [
    !dashboard.isConfigured ? "BUGZ is not configured in this build." : "",
    dashboard.errorMessage ?? ""
  ]
    .filter(Boolean)
    .map((message) => `<p class="warning-copy">${escapeHtml(message)}</p>`)
    .join("");

  const connectedBalance = context.session.address
    ? tokenAmount(dashboard.connectedBalance, dashboard.decimals, dashboard.symbol)
    : `<a href="${context.router.href("/login")}" data-nav>connect at /login</a>`;

  const treasuryRows = dashboard.treasuryAddress
    ? `
            <tr><th>treasury vault</th><td>${escapeHtml(textOrDash(dashboard.treasuryAddress))}</td></tr>
            <tr><th>treasury vault bugz</th><td>${tokenAmount(dashboard.treasuryTokenBalance, dashboard.decimals, dashboard.symbol)}</td></tr>
            <tr><th>treasury vault ${escapeHtml(chainConfig.nativeSymbol)}</th><td>${
              dashboard.treasuryNativeBalance !== null
                ? `${escapeHtml(formatTokenAmount(dashboard.treasuryNativeBalance, 18))} ${escapeHtml(
                    chainConfig.nativeSymbol
                  )}`
                : "-"
            }</td></tr>
    `
    : "";

  return {
    title: "Token",
    html: `
      <section class="panel">
        <div class="panel-title">[ bugz token manager ]</div>
        ${warnings}
        <p class="lede">
          BUGZ is live on Base. Balances are read directly from the token contract, and buy/sell actions are browser-signed
          transactions against the Base Uniswap v4 pool created by Clanker.
        </p>
        <table class="data-table compact-table">
          <tbody>
            <tr><th>token</th><td>${escapeHtml(textOrDash(dashboard.tokenAddress))}</td></tr>
            <tr><th>name</th><td>${escapeHtml(dashboard.name)}</td></tr>
            <tr><th>symbol</th><td>${escapeHtml(dashboard.symbol)}</td></tr>
            <tr><th>total supply</th><td>${tokenAmount(dashboard.totalSupply, dashboard.decimals, dashboard.symbol)}</td></tr>
            <tr><th>your balance</th><td>${connectedBalance}</td></tr>
            ${treasuryRows}
            <tr><th>holder scan</th><td>${escapeHtml(dashboard.patronScanStatus)}</td></tr>
            <tr><th>basescan holders</th><td><a href="${escapeHtml(dashboard.holdersUrl)}" target="_blank" rel="noreferrer">view holder distribution</a></td></tr>
            <tr><th>clanker</th><td><a href="${escapeHtml(dashboard.marketUrl)}" target="_blank" rel="noreferrer">view market</a></td></tr>
          </tbody>
        </table>
      </section>

      <section class="panel">
        <div class="panel-title">[ onchain trade ]</div>
        <p class="helper-copy">
          These controls do not call a backend. Quotes use public Base RPC reads; trades are signed by your connected wallet
          and sent to Uniswap v4 Universal Router on Base. Sells may first ask for ERC20 and Permit2 approvals.
        </p>
        <div class="trade-grid">
          <form id="bugz-buy-form" class="stack-form trade-form">
            <div class="panel-title">[ buy bugz ]</div>
            <label>
              ${escapeHtml(chainConfig.nativeSymbol)} amount
              <input name="amount" type="number" min="0" step="0.000001" value="0.01" />
            </label>
            <label>
              max slippage %
              <input name="slippage" type="number" min="0.01" max="50" step="0.01" value="5" />
            </label>
            <div id="bugz-buy-preview" class="buy-preview">Quote before buying.</div>
            <div class="button-row">
              <button class="button secondary" type="button" data-quote="buy">quote</button>
              <button class="button" type="submit" ${tradeDisabled(context)}>buy onchain</button>
            </div>
          </form>

          <form id="bugz-sell-form" class="stack-form trade-form">
            <div class="panel-title">[ sell bugz ]</div>
            <label>
              ${escapeHtml(dashboard.symbol)} amount
              <input name="amount" type="number" min="0" step="1" value="1000" />
            </label>
            <label>
              max slippage %
              <input name="slippage" type="number" min="0.01" max="50" step="0.01" value="5" />
            </label>
            <div id="bugz-sell-preview" class="buy-preview">Quote before selling.</div>
            <div class="button-row">
              <button class="button secondary" type="button" data-quote="sell">quote</button>
              <button class="button" type="submit" ${tradeDisabled(context)}>sell onchain</button>
            </div>
          </form>
        </div>
      </section>
    `,
    afterRender: (root, appContext) => {
      const setupTradeForm = (side: "buy" | "sell") => {
        const form = root.querySelector<HTMLFormElement>(`#bugz-${side}-form`);
        const preview = root.querySelector<HTMLElement>(`#bugz-${side}-preview`);
        const quoteButton = root.querySelector<HTMLButtonElement>(`[data-quote="${side}"]`);
        if (!form || !preview) {
          return;
        }

        const amountInput = form.querySelector<HTMLInputElement>('input[name="amount"]');
        const slippageInput = form.querySelector<HTMLInputElement>('input[name="slippage"]');
        const submitButton = form.querySelector<HTMLButtonElement>('button[type="submit"]');
        const quoteButtons = Array.from(form.querySelectorAll<HTMLButtonElement>('[data-quote]'));
        let quoteTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
        let inputVersion = 0;
        let isTrading = false;

        const setBusy = (busy: boolean) => {
          quoteButtons.forEach((button) => {
            button.disabled = busy;
          });
          if (submitButton) {
            submitButton.disabled = busy || !appContext.session.address;
          }
        };

        const clearQuoteTimer = () => {
          if (quoteTimer) {
            globalThis.clearTimeout(quoteTimer);
            quoteTimer = null;
          }
        };

        const currentAmount = (): string => amountInput?.value.trim() ?? "";

        const canAutoQuote = (): boolean => {
          const parsed = Number(currentAmount());
          return Number.isFinite(parsed) && parsed > 0;
        };

        const resolveQuote = async (options: { notifyOnError?: boolean } = {}): Promise<BugzTradeQuote | null> => {
          if (isTrading) {
            return null;
          }
          const quoteVersion = inputVersion;
          try {
            preview.textContent = "Reading pool quote...";
            const quote = await quoteBugzTrade(side, amountInput?.value ?? "", slippageInput?.value ?? "5");
            if (quoteVersion !== inputVersion || isTrading) {
              return null;
            }
            preview.innerHTML = quoteHtml(quote);
            return quote;
          } catch (error) {
            if (quoteVersion !== inputVersion || isTrading) {
              return null;
            }
            const message = error instanceof Error ? error.message : "Quote failed.";
            preview.textContent = message;
            if (options.notifyOnError) {
              appContext.notify("error", message);
            }
            return null;
          }
        };

        const scheduleQuote = () => {
          inputVersion += 1;
          clearQuoteTimer();
          if (!canAutoQuote()) {
            preview.textContent = side === "buy" ? "Enter an ETH amount to quote." : "Enter a BUGZ amount to quote.";
            return;
          }

          preview.textContent = "Quote updates after you pause typing.";
          quoteTimer = globalThis.setTimeout(() => {
            quoteTimer = null;
            void resolveQuote();
          }, AUTO_QUOTE_DELAY_MS);
        };

        quoteButton?.addEventListener("click", () => {
          clearQuoteTimer();
          void resolveQuote({ notifyOnError: true });
        });
        amountInput?.addEventListener("input", scheduleQuote);
        slippageInput?.addEventListener("input", scheduleQuote);
        scheduleQuote();

        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          if (!appContext.session.address) {
            appContext.notify("error", "Connect a wallet before trading BUGZ.");
            appContext.router.navigate("/login");
            return;
          }

          inputVersion += 1;
          clearQuoteTimer();
          isTrading = true;
          setBusy(true);
          try {
            preview.textContent = side === "buy" ? "Buying BUGZ..." : "Selling BUGZ...";
            const result =
              side === "buy"
                ? await buyBugzOnchain(amountInput?.value ?? "", slippageInput?.value ?? "5")
                : await sellBugzOnchain(amountInput?.value ?? "", slippageInput?.value ?? "5");
            preview.innerHTML = quoteHtml(result.quote);
            const approvals = result.approvalTxHashes?.length
              ? ` Approvals ${result.approvalTxHashes.map((hash) => shortHash(hash, 12, 6)).join(", ")}.`
              : "";
            appContext.notify(
              "success",
              `${side === "buy" ? "Buy" : "Sell"} transaction sent: ${shortHash(result.txHash, 12, 6)}.${approvals}`
            );
            await appContext.rerender();
          } catch (error) {
            appContext.notify("error", error instanceof Error ? error.message : "BUGZ trade failed.");
          } finally {
            isTrading = false;
            setBusy(false);
          }
        });
      };

      setupTradeForm("buy");
      setupTradeForm("sell");
    }
  };
};
