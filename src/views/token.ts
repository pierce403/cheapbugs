import { chainConfig } from "../config/chains";
import { buyBugzOnchain, quoteBugzTrade, sellBugzOnchain, type BugzTradeQuote } from "../contracts/bugzTrade";
import { loadTokenDashboard } from "../lib/token";
import {
  checkThirdwebBugzBuyRoute,
  MIN_BASE_ETH_FOR_GAS,
  prepareThirdwebBaseEthOnramp,
  prepareThirdwebBugzOnramp,
  shouldShowThirdwebSellExperiment,
  thirdwebTradingCapabilities,
  type ThirdwebOnrampLink
} from "../lib/thirdwebTrading";
import { escapeHtml, formatTokenAmount, shortHash, textOrDash } from "../lib/utils";
import { isWalletActionCancelled } from "../lib/walletAction";

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
  const dashboard = await loadTokenDashboard(context.session.address, {
    includeTreasury: false,
    includeNativeBalance: true
  });
  const capabilities = thirdwebTradingCapabilities();
  const isConnected = Boolean(context.session.address);
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

  const connectedNativeBalance = context.session.address
    ? tokenAmount(dashboard.connectedNativeBalance, 18, chainConfig.nativeSymbol)
    : `<a href="${context.router.href("/login")}" data-nav>connect at /login</a>`;
  const gasThreshold = `${escapeHtml(formatTokenAmount(MIN_BASE_ETH_FOR_GAS, 18))} ${escapeHtml(
    chainConfig.nativeSymbol
  )}`;
  const needsGas =
    context.session.address && dashboard.connectedNativeBalance !== null && dashboard.connectedNativeBalance < MIN_BASE_ETH_FOR_GAS;
  const gasWarning = needsGas
    ? `
      <div class="notice notice-error gas-helper-warning">
        <strong>Need gas?</strong>
        <span>You need a little ETH on Base for transaction fees. Keep at least ${gasThreshold} available before buying, selling, bonding, or unlocking details.</span>
      </div>
    `
    : "";
  const easyButtonsDisabled = isConnected ? "" : "disabled";
  const widgetNote =
    capabilities.buyWidgetRequested || capabilities.swapWidgetRequested
      ? `<p class="helper-copy">thirdweb widget flags are enabled, but this static page uses thirdweb Bridge checkout actions and keeps Advanced Trading below as the reliable route.</p>`
      : "";
  const thirdwebSellNote = shouldShowThirdwebSellExperiment()
    ? ""
    : `<p class="helper-copy">thirdweb BUGZ sell routing is not shown in this release. Use the direct Clanker sell form below; it remains the default sell path.</p>`;

  return {
    title: "Token",
    html: `
      <section class="panel">
        <div class="panel-title">[ bugz ]</div>
        ${warnings}
        <p class="lede">
          BUGZ is the CheapBugs token used for bonding, buyer access, patron signals, and bug-market incentives.
          You need a little Base ETH for transaction fees even when you already hold BUGZ.
        </p>
        <table class="data-table compact-table">
          <tbody>
            <tr><th>token</th><td>${escapeHtml(textOrDash(dashboard.tokenAddress))}</td></tr>
            <tr><th>name</th><td>${escapeHtml(dashboard.name)}</td></tr>
            <tr><th>symbol</th><td>${escapeHtml(dashboard.symbol)}</td></tr>
            <tr><th>your BUGZ</th><td>${connectedBalance}</td></tr>
            <tr><th>your Base ${escapeHtml(chainConfig.nativeSymbol)}</th><td>${connectedNativeBalance}</td></tr>
            <tr><th>gas target</th><td>${gasThreshold}</td></tr>
            <tr><th>total supply</th><td>${tokenAmount(dashboard.totalSupply, dashboard.decimals, dashboard.symbol)}</td></tr>
            <tr><th>holder scan</th><td>${escapeHtml(dashboard.patronScanStatus)}</td></tr>
            <tr><th>basescan holders</th><td><a href="${escapeHtml(dashboard.holdersUrl)}" target="_blank" rel="noreferrer">view holder distribution</a></td></tr>
            <tr><th>clanker</th><td><a href="${escapeHtml(dashboard.marketUrl)}" target="_blank" rel="noreferrer">view market</a></td></tr>
          </tbody>
        </table>
      </section>

      <section class="panel" id="easy-buy">
        <div class="panel-title">[ buy bugz ]</div>
        ${gasWarning}
        <p class="lede">Easy mode: fund your wallet or buy BUGZ through thirdweb.</p>
        <p class="helper-copy">
          thirdweb may be able to route directly into BUGZ on Base. If routing is unavailable, add Base ETH for gas and use
          Advanced Trading below.
        </p>
        ${widgetNote}
        <div class="easy-buy-grid">
          <div class="easy-buy-card">
            <div class="panel-title">[ easy buy ]</div>
            <p>Try thirdweb first. This opens a thirdweb checkout flow when a provider can route to BUGZ.</p>
            <div class="button-row">
              <button id="thirdweb-buy-bugz" class="button" type="button" ${easyButtonsDisabled}>easy buy BUGZ</button>
              <button id="thirdweb-check-bugz-route" class="button secondary" type="button">check thirdweb route</button>
            </div>
          </div>
          <div class="easy-buy-card">
            <div class="panel-title">[ need gas? ]</div>
            <p>You need ETH on Base to pay transaction fees for buys, sells, bonds, and unlocks.</p>
            <div class="button-row">
              <button id="thirdweb-add-base-eth" class="button" type="button" ${easyButtonsDisabled}>add Base ETH</button>
              <a class="button secondary" href="#advanced-clanker-trading">advanced trading</a>
            </div>
          </div>
        </div>
        <div id="thirdweb-buy-status" class="buy-preview easy-buy-status">
          ${
            isConnected
              ? "Easy Buy checks thirdweb routing only when you ask. If it cannot route to BUGZ, use Advanced Trading."
              : `Connect a wallet to open thirdweb checkout or add Base ETH.`
          }
        </div>
      </section>

      <section class="panel" id="advanced-clanker-trading">
        <div class="panel-title">[ advanced clanker trading ]</div>
        <p class="helper-copy">
          Advanced Trading uses the direct Clanker / Uniswap v4 market. These controls do not call a backend. Quotes use
          public Base RPC reads; trades are signed by your connected wallet and sent to Universal Router 2.1.1 on Base.
          Sells may first ask for ERC20 and Permit2 approvals.
        </p>
        ${thirdwebSellNote}
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
      const easyStatus = root.querySelector<HTMLElement>("#thirdweb-buy-status");
      const easyBuyButton = root.querySelector<HTMLButtonElement>("#thirdweb-buy-bugz");
      const addGasButton = root.querySelector<HTMLButtonElement>("#thirdweb-add-base-eth");
      const checkRouteButton = root.querySelector<HTMLButtonElement>("#thirdweb-check-bugz-route");

      const checkoutLinkHtml = (result: ThirdwebOnrampLink): string =>
        `<a href="${escapeHtml(result.link)}" target="_blank" rel="noreferrer">open thirdweb ${escapeHtml(
          result.destination
        )} checkout</a>`;

      const setEasyStatus = (message: string, result?: ThirdwebOnrampLink) => {
        if (!easyStatus) {
          return;
        }
        easyStatus.innerHTML = result ? `${escapeHtml(message)}<br />${checkoutLinkHtml(result)}` : escapeHtml(message);
      };

      const connectedWallet = (): `0x${string}` | null => {
        if (appContext.session.address) {
          return appContext.session.address;
        }
        appContext.notify("error", "Connect a wallet before using thirdweb checkout.");
        appContext.router.navigate("/login");
        return null;
      };

      const openCheckout = (result: ThirdwebOnrampLink) => {
        const opened = window.open(result.link, "_blank", "noopener,noreferrer");
        setEasyStatus(
          opened
            ? `Opened thirdweb ${result.destination} checkout through ${result.provider}.`
            : `thirdweb ${result.destination} checkout is ready; use the link below if your browser blocked the popup.`,
          result
        );
      };

      checkRouteButton?.addEventListener("click", async () => {
        checkRouteButton.disabled = true;
        setEasyStatus("Checking thirdweb BUGZ routing...");
        const status = await checkThirdwebBugzBuyRoute();
        setEasyStatus(status.message);
        checkRouteButton.disabled = false;
      });

      easyBuyButton?.addEventListener("click", async () => {
        const wallet = connectedWallet();
        if (!wallet) {
          return;
        }
        easyBuyButton.disabled = true;
        setEasyStatus("Preparing thirdweb BUGZ checkout...");
        try {
          openCheckout(await prepareThirdwebBugzOnramp(wallet));
        } catch (error) {
          const message =
            error instanceof Error
              ? `${error.message} Use Add Base ETH, then Advanced Trading below.`
              : "thirdweb BUGZ checkout is unavailable. Use Add Base ETH, then Advanced Trading below.";
          setEasyStatus(message);
          appContext.notify("error", message);
        } finally {
          easyBuyButton.disabled = false;
        }
      });

      addGasButton?.addEventListener("click", async () => {
        const wallet = connectedWallet();
        if (!wallet) {
          return;
        }
        addGasButton.disabled = true;
        setEasyStatus("Preparing thirdweb Base ETH checkout...");
        try {
          openCheckout(await prepareThirdwebBaseEthOnramp(wallet));
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "thirdweb Base ETH checkout is unavailable. You can still use another Base onramp, then return here.";
          setEasyStatus(message);
          appContext.notify("error", message);
        } finally {
          addGasButton.disabled = false;
        }
      });

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
                ? await appContext.runWalletAction(
                    {
                      title: "buy bugz",
                      message: "Approve the buy transaction in your wallet. CheapBugs will wait for Base confirmation after signing."
                    },
                    () => buyBugzOnchain(amountInput?.value ?? "", slippageInput?.value ?? "5")
                  )
                : await appContext.runWalletAction(
                    {
                      title: "sell bugz",
                      message:
                        "Approve any BUGZ, Permit2, and sell transactions in your wallet. CheapBugs will wait for Base confirmations."
                    },
                    () => sellBugzOnchain(amountInput?.value ?? "", slippageInput?.value ?? "5")
                  );
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
            if (isWalletActionCancelled(error)) {
              preview.textContent = "Wallet request cancelled.";
              return;
            }
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
