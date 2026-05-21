import {
  approveBondVault,
  bondBugz,
  loadBondVaultDashboard,
  requestBondWithdrawal,
  withdrawBond,
  type BondVaultDashboard
} from "../contracts/bondVault";
import { appLog } from "../lib/logger";
import { escapeHtml, formatTokenAmount, shortHash } from "../lib/utils";

import type { AppViewContext, ViewResult } from "./types";

type PendingWithdrawalHint = {
  version: 1;
  account: string;
  vaultAddress: string;
  active: string;
  pendingWithdrawal: string;
  withdrawAvailableAt: number;
  txHash: string | null;
  createdAt: number;
};

type StakeDashboard = BondVaultDashboard & {
  pendingWithdrawalHint?: boolean;
  pendingWithdrawalTxHash?: string | null;
};

const withdrawalHintKey = (dashboard: Pick<BondVaultDashboard, "account" | "vaultAddress">): string =>
  `cheapbugs.bondWithdrawalHint.v1:${dashboard.vaultAddress.toLowerCase()}:${dashboard.account.toLowerCase()}`;
const wholeBugz = (decimals: number): bigint => 10n ** BigInt(decimals);

const pow10 = (exponent: number): bigint => {
  let value = 1n;
  for (let index = 0; index < exponent; index += 1) {
    value *= 10n;
  }
  return value;
};

const nextLevelThreshold = (level: number): bigint => pow10(Math.max(1, level + 1));

const levelFromActive = (active: bigint, decimals: number): number => {
  const whole = active / wholeBugz(decimals);
  let level = 0;
  let threshold = 10n;
  while (whole >= threshold) {
    level += 1;
    threshold *= 10n;
  }
  return level;
};

const levelProgressPercent = (active: bigint, level: number, decimals: number): number => {
  const whole = active / wholeBugz(decimals);
  const next = nextLevelThreshold(level);
  const previous = level <= 0 ? 0n : pow10(level);
  const span = next - previous;
  if (span <= 0n) {
    return 100;
  }
  const progress = whole > previous ? whole - previous : 0n;
  return Math.max(0, Math.min(100, Number((progress * 10_000n) / span) / 100));
};

const withdrawalState = (dashboard: BondVaultDashboard): { ready: boolean; hasPending: boolean; secondsRemaining: number } => {
  const hasPending = dashboard.pendingWithdrawal > 0n;
  if (!hasPending || dashboard.withdrawAvailableAt <= 0) {
    return { hasPending, ready: false, secondsRemaining: 0 };
  }

  const secondsRemaining = Math.max(0, dashboard.withdrawAvailableAt - Math.floor(Date.now() / 1000));
  return {
    hasPending,
    ready: secondsRemaining === 0,
    secondsRemaining
  };
};

const formatDuration = (seconds: number): string => {
  if (seconds <= 0) {
    return "ready now";
  }
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const secs = seconds % 60;
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  return `${minutes}m ${secs}s`;
};

const countdownProgress = (dashboard: BondVaultDashboard): number => {
  if (!dashboard.pendingWithdrawal || !dashboard.withdrawAvailableAt) {
    return 0;
  }
  const now = Math.floor(Date.now() / 1000);
  const start = dashboard.withdrawAvailableAt - dashboard.withdrawalDelaySeconds;
  const elapsed = Math.max(0, now - start);
  return Math.max(0, Math.min(100, (elapsed / dashboard.withdrawalDelaySeconds) * 100));
};

const token = (value: bigint | null, dashboard: Pick<BondVaultDashboard, "decimals" | "symbol">): string =>
  value === null ? "-" : `${formatTokenAmount(value, dashboard.decimals)} ${dashboard.symbol}`;

const readWithdrawalHint = (dashboard: BondVaultDashboard): PendingWithdrawalHint | null => {
  if (typeof window === "undefined" || !dashboard.vaultAddress) {
    return null;
  }
  const key = withdrawalHintKey(dashboard);
  const raw = window.sessionStorage.getItem(key);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PendingWithdrawalHint>;
    const matches =
      parsed.version === 1 &&
      parsed.account?.toLowerCase() === dashboard.account.toLowerCase() &&
      parsed.vaultAddress?.toLowerCase() === dashboard.vaultAddress.toLowerCase() &&
      typeof parsed.pendingWithdrawal === "string" &&
      typeof parsed.active === "string" &&
      typeof parsed.withdrawAvailableAt === "number" &&
      typeof parsed.createdAt === "number";
    if (!matches) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    const withdrawAvailableAt = Number(parsed.withdrawAvailableAt);
    const expiredAt = withdrawAvailableAt + 24 * 60 * 60;
    if (expiredAt < Math.floor(Date.now() / 1000)) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return parsed as PendingWithdrawalHint;
  } catch {
    window.sessionStorage.removeItem(key);
    return null;
  }
};

const clearWithdrawalHint = (dashboard: Pick<BondVaultDashboard, "account" | "vaultAddress">): void => {
  if (typeof window === "undefined" || !dashboard.vaultAddress) {
    return;
  }
  window.sessionStorage.removeItem(withdrawalHintKey(dashboard));
};

const saveWithdrawalHint = (
  dashboard: BondVaultDashboard,
  requestedAmount: bigint,
  txHash: string | null | undefined
): void => {
  if (typeof window === "undefined" || !dashboard.vaultAddress) {
    return;
  }
  const pendingWithdrawal = dashboard.pendingWithdrawal + requestedAmount;
  const active = dashboard.active > requestedAmount ? dashboard.active - requestedAmount : 0n;
  const now = Math.floor(Date.now() / 1000);
  const hint: PendingWithdrawalHint = {
    version: 1,
    account: dashboard.account,
    vaultAddress: dashboard.vaultAddress,
    active: active.toString(),
    pendingWithdrawal: pendingWithdrawal.toString(),
    withdrawAvailableAt: now + dashboard.withdrawalDelaySeconds,
    txHash: txHash ?? null,
    createdAt: now
  };
  window.sessionStorage.setItem(withdrawalHintKey(dashboard), JSON.stringify(hint));
};

const dashboardWithWithdrawalHint = (dashboard: BondVaultDashboard): StakeDashboard => {
  const hint = readWithdrawalHint(dashboard);
  if (!hint) {
    return dashboard;
  }
  if (dashboard.pendingWithdrawal > 0n) {
    clearWithdrawalHint(dashboard);
    return dashboard;
  }

  let pendingWithdrawal: bigint;
  let active: bigint;
  try {
    pendingWithdrawal = BigInt(hint.pendingWithdrawal);
    active = BigInt(hint.active);
  } catch {
    clearWithdrawalHint(dashboard);
    return dashboard;
  }
  return {
    ...dashboard,
    active,
    pendingWithdrawal,
    totalBond: active + pendingWithdrawal,
    withdrawAvailableAt: hint.withdrawAvailableAt,
    level: levelFromActive(active, dashboard.decimals),
    pendingWithdrawalHint: true,
    pendingWithdrawalTxHash: hint.txHash
  };
};

const parseDisplayAmount = (rawAmount: string, decimals: number): bigint | null => {
  const raw = rawAmount.trim().replace(/,/g, "");
  if (!raw || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) {
    return null;
  }

  const [wholePart = "0", fractionPart = ""] = raw.split(".");
  if (fractionPart.length > decimals) {
    return null;
  }

  const whole = BigInt(wholePart || "0");
  const fraction = BigInt((fractionPart + "0".repeat(decimals)).slice(0, decimals) || "0");
  return whole * wholeBugz(decimals) + fraction;
};

const bondFormAction = (rawAmount: string, allowance: bigint | null, decimals: number): "approve" | "bond" => {
  if (allowance === null) {
    return "approve";
  }
  const amount = parseDisplayAmount(rawAmount, decimals);
  if (amount === null || amount <= 0n) {
    return allowance > 0n ? "bond" : "approve";
  }
  return allowance >= amount ? "bond" : "approve";
};

const bondActionLabel = (action: "approve" | "bond"): string => (action === "approve" ? "approve bugz" : "bond bugz");

const renderConnect = (): string => `
  <section class="panel">
    <div class="panel-title">[ bond ]</div>
    <p class="warning-copy">Connect a wallet to bond BUGZ, see your level, or request a delayed withdrawal.</p>
  </section>
`;

const renderStake = (dashboard: StakeDashboard): string => {
  if (!dashboard.isConfigured) {
    return `
      <section class="panel">
        <div class="panel-title">[ bond ]</div>
        <p class="warning-copy">The BUGZ token or bond vault address is not configured for this deployment.</p>
      </section>
    `;
  }

  const level = dashboard.level;
  const nextThreshold = nextLevelThreshold(level);
  const progress = levelProgressPercent(dashboard.active, level, dashboard.decimals);
  const withdrawal = withdrawalState(dashboard);
  const countdown = formatDuration(withdrawal.secondsRemaining);
  const countdownPercent = withdrawal.ready ? 100 : countdownProgress(dashboard);
  const withdrawDisabled = withdrawal.ready ? "" : "disabled";
  const initialBondAction = bondFormAction("", dashboard.allowance, dashboard.decimals);
  const encodedAllowance = dashboard.allowance === null ? "" : dashboard.allowance.toString();
  const inFlightAmount = token(dashboard.pendingWithdrawal, dashboard);
  const pendingNotice = withdrawal.hasPending
    ? dashboard.pendingWithdrawalHint
      ? `<p class="warning-copy">Withdrawal request is in flight on this page. ${escapeHtml(
          inFlightAmount
        )} is shown locally until Base RPC reflects the pending queue.${
          dashboard.pendingWithdrawalTxHash ? ` tx ${escapeHtml(shortHash(dashboard.pendingWithdrawalTxHash, 12, 8))}` : ""
        }</p>`
      : `<p class="helper-copy">Pending withdrawals remain slashable until the countdown finishes.</p>`
    : "";

  return `
    <section class="panel stake-page-panel" data-testid="stake-panel">
      <div class="panel-title">[ bond ]</div>
      ${dashboard.errorMessage ? `<p class="warning-copy">${escapeHtml(dashboard.errorMessage)}</p>` : ""}
      <div class="stake-hero">
        <div class="stake-level-badge">
          <span>level</span>
          <strong>${level}</strong>
        </div>
        <div class="stake-meter-block">
          <div class="stake-meter-row">
            <span>${escapeHtml(token(dashboard.active, dashboard))} active</span>
            <span>next level at ${nextThreshold.toLocaleString()} ${escapeHtml(dashboard.symbol)}</span>
          </div>
          <div class="stake-meter" aria-label="level progress">
            <div class="stake-meter-fill" style="width: ${progress.toFixed(2)}%"></div>
          </div>
        </div>
      </div>
      <div class="metric-grid">
        <div><span>active bond</span><strong>${escapeHtml(token(dashboard.active, dashboard))}</strong></div>
        <div><span>pending withdrawal</span><strong>${escapeHtml(token(dashboard.pendingWithdrawal, dashboard))}</strong></div>
        <div><span>wallet balance</span><strong>${escapeHtml(token(dashboard.tokenBalance, dashboard))}</strong></div>
        <div><span>vault allowance</span><strong>${escapeHtml(token(dashboard.allowance, dashboard))}</strong></div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-title">[ add bugz to bond ]</div>
      <form id="stake-bond-form" class="stack-form narrow-form">
        <label>
          amount
          <input id="stake-bond-amount" name="amount" type="text" inputmode="decimal" autocomplete="off" placeholder="1000" required />
        </label>
        ${
          dashboard.pendingWithdrawal > 0n
            ? `<p class="field-warning warning-copy">Adding a new bond cancels your pending withdrawal and restores it to active bond.</p>`
            : ""
        }
        <div class="button-row">
          <button id="stake-bond-submit" class="button" type="submit" name="bondAction" value="${initialBondAction}" data-allowance="${escapeHtml(encodedAllowance)}" data-decimals="${dashboard.decimals}">
            ${bondActionLabel(initialBondAction)}
          </button>
        </div>
      </form>
    </section>

    <section class="panel">
      <div class="panel-title">[ withdraw ]</div>
      <div class="withdraw-countdown" data-withdraw-available-at="${dashboard.withdrawAvailableAt}" data-withdraw-delay="${dashboard.withdrawalDelaySeconds}">
        <div class="stake-meter-row">
          <span>step 2: ${escapeHtml(withdrawal.ready ? "withdrawal ready" : withdrawal.hasPending ? "waiting period" : "no pending withdrawal")}</span>
          <span data-countdown-label>${escapeHtml(withdrawal.hasPending ? countdown : "-")}</span>
        </div>
        ${
          withdrawal.hasPending
            ? `<div class="stake-meter-row withdrawal-in-flight-row" data-testid="withdrawal-in-flight">
                <span>in flight</span>
                <strong>${escapeHtml(inFlightAmount)}</strong>
              </div>`
            : ""
        }
        <div class="stake-meter" aria-label="withdrawal countdown">
          <div class="stake-meter-fill countdown-fill" data-countdown-fill style="width: ${countdownPercent.toFixed(2)}%"></div>
        </div>
      </div>
      ${pendingNotice}
      <form id="stake-withdraw-request-form" class="stack-form narrow-form">
        <label>
          amount to request
          <input id="stake-withdraw-amount" name="amount" type="text" inputmode="decimal" autocomplete="off" placeholder="100" required />
        </label>
        <p class="helper-copy">Requesting withdrawal moves active BUGZ into the 7-day pending queue. Pending BUGZ remains slashable and no longer counts toward voting level.</p>
        <button class="button secondary" type="submit" ${dashboard.active > 0n ? "" : "disabled"}>request withdrawal</button>
      </form>
      <div class="button-row stake-withdraw-actions">
        <button id="stake-withdraw-button" class="button" type="button" ${withdrawDisabled}>withdraw pending BUGZ</button>
      </div>
      <div id="stake-action-status" class="action-status" role="status" aria-live="polite"></div>
    </section>
  `;
};

const bindCountdown = (root: HTMLElement): void => {
  const countdown = root.querySelector<HTMLElement>(".withdraw-countdown");
  const label = root.querySelector<HTMLElement>("[data-countdown-label]");
  const fill = root.querySelector<HTMLElement>("[data-countdown-fill]");
  const withdrawButton = root.querySelector<HTMLButtonElement>("#stake-withdraw-button");
  if (!countdown || !label || !fill) {
    return;
  }

  const availableAt = Number(countdown.dataset.withdrawAvailableAt || "0");
  const delay = Number(countdown.dataset.withdrawDelay || "604800");
  if (!availableAt) {
    return;
  }

  const tick = () => {
    if (!countdown.isConnected) {
      globalThis.clearInterval(timer);
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const remaining = Math.max(0, availableAt - now);
    const start = availableAt - delay;
    const progress = remaining === 0 ? 100 : Math.max(0, Math.min(100, ((now - start) / delay) * 100));
    label.textContent = formatDuration(remaining);
    fill.style.width = `${progress.toFixed(2)}%`;
    if (withdrawButton && remaining === 0) {
      withdrawButton.disabled = false;
    }
  };

  const timer = globalThis.setInterval(tick, 1000);
  tick();
};

export const renderStakeView = async (context: AppViewContext): Promise<ViewResult> => {
  if (!context.session.address) {
    return {
      title: "Bond",
      html: renderConnect()
    };
  }

  const dashboard = dashboardWithWithdrawalHint(await loadBondVaultDashboard(context.session.address));
  return {
    title: "Bond",
    html: renderStake(dashboard),
    afterRender(root) {
      bindCountdown(root);
      const status = root.querySelector<HTMLElement>("#stake-action-status");
      const setStatus = (message: string) => {
        if (status) {
          status.textContent = message;
        }
      };
      const buttons = () => Array.from(root.querySelectorAll<HTMLButtonElement>("button"));
      const withButtonsDisabled = async (work: () => Promise<void>) => {
        const allButtons = buttons();
        const previousStates = allButtons.map((button) => ({ button, disabled: button.disabled }));
        allButtons.forEach((button) => {
          button.disabled = true;
        });
        try {
          await work();
        } finally {
          previousStates.forEach(({ button, disabled }) => {
            button.disabled = disabled;
          });
        }
      };

      const bondAmountInput = root.querySelector<HTMLInputElement>("#stake-bond-amount");
      const bondSubmitButton = root.querySelector<HTMLButtonElement>("#stake-bond-submit");
      const updateBondButton = () => {
        if (!bondSubmitButton) {
          return;
        }
        const allowance = bondSubmitButton.dataset.allowance ? BigInt(bondSubmitButton.dataset.allowance) : null;
        const decimals = Number(bondSubmitButton.dataset.decimals || "18");
        const action = bondFormAction(bondAmountInput?.value ?? "", allowance, decimals);
        bondSubmitButton.value = action;
        bondSubmitButton.textContent = bondActionLabel(action);
      };
      bondAmountInput?.addEventListener("input", updateBondButton);
      updateBondButton();

      root.querySelector<HTMLFormElement>("#stake-bond-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
        const form = event.currentTarget as HTMLFormElement;
        const amount = String(new FormData(form).get("amount") ?? "");
        const action = (submitter?.value ?? bondSubmitButton?.value) === "approve" ? "approve" : "bond";
        await withButtonsDisabled(async () => {
          setStatus(action === "approve" ? "waiting for approval transaction..." : "waiting for bond transaction...");
          try {
            const result = action === "approve" ? await approveBondVault(amount) : await bondBugz(amount);
            const message = result.skipped
              ? "Bond vault already has enough allowance."
              : `${result.label} confirmed: ${shortHash(result.txHash ?? "0x", 12, 8)}`;
            setStatus(message);
            context.notify("success", message);
            if (action === "bond") {
              clearWithdrawalHint(dashboard);
            }
            await context.rerender();
          } catch (error) {
            appLog.warn("stake: bond action failed", { error });
            const message = error instanceof Error ? error.message : "Bond action failed.";
            setStatus(message);
            context.notify("error", message);
          }
        });
      });

      root.querySelector<HTMLFormElement>("#stake-withdraw-request-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const amount = String(new FormData(form).get("amount") ?? "");
        const requestedAmount = parseDisplayAmount(amount, dashboard.decimals);
        await withButtonsDisabled(async () => {
          setStatus("waiting for withdrawal request transaction...");
          try {
            const result = await requestBondWithdrawal(amount);
            const message = `${result.label} confirmed: ${shortHash(result.txHash ?? "0x", 12, 8)}`;
            setStatus(message);
            context.notify("success", message);
            if (requestedAmount && requestedAmount > 0n) {
              saveWithdrawalHint(dashboard, requestedAmount, result.txHash);
            }
            await context.rerender();
          } catch (error) {
            appLog.warn("stake: withdrawal request failed", { error });
            const message = error instanceof Error ? error.message : "Withdrawal request failed.";
            setStatus(message);
            context.notify("error", message);
          }
        });
      });

      root.querySelector<HTMLButtonElement>("#stake-withdraw-button")?.addEventListener("click", async () => {
        await withButtonsDisabled(async () => {
          setStatus("waiting for withdrawal transaction...");
          try {
            const result = await withdrawBond();
            const message = `${result.label} confirmed: ${shortHash(result.txHash ?? "0x", 12, 8)}`;
            setStatus(message);
            context.notify("success", message);
            clearWithdrawalHint(dashboard);
            await context.rerender();
          } catch (error) {
            appLog.warn("stake: withdraw failed", { error });
            const message = error instanceof Error ? error.message : "Withdrawal failed.";
            setStatus(message);
            context.notify("error", message);
          }
        });
      });
    }
  };
};
