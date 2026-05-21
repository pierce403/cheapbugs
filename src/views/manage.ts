import {
  executeManageAction,
  loadManageSnapshot,
  type ContractOwnerAccess,
  type ManagedContractKey,
  type ManageAction,
  type ManageSnapshot
} from "../contracts/cheapbugsSuite";
import { appLog } from "../lib/logger";
import { escapeHtml, shortHash } from "../lib/utils";
import { isWalletActionCancelled } from "../lib/walletAction";

import type { AppViewContext, ContractOwnerViewState, ViewResult } from "./types";

const ownerStatusCopy = (ownerState: ContractOwnerViewState): string => {
  if (ownerState.status === "loading") {
    return "checking owner access...";
  }
  if (ownerState.status === "error") {
    return ownerState.errorMessage;
  }
  if (ownerState.status === "ready") {
    return ownerState.access.isAnyOwner ? "owner access recognized" : "connected wallet is not a contract owner";
  }
  return "connect an owner wallet to manage contracts";
};

const ownershipTable = (access: ContractOwnerAccess): string => `
  <table class="data-table compact-table">
    <thead>
      <tr>
        <th>contract</th>
        <th>address</th>
        <th>owner</th>
        <th>access</th>
      </tr>
    </thead>
    <tbody>
      ${access.contracts
        .map(
          (contract) => `
            <tr>
              <td>${escapeHtml(contract.label)}</td>
              <td><code>${contract.address ? escapeHtml(contract.address) : "-"}</code></td>
              <td>${contract.owner ? `<code>${escapeHtml(contract.owner)}</code>` : escapeHtml(contract.errorMessage ?? "-")}</td>
              <td>${contract.isOwner ? "owner" : "read only"}</td>
            </tr>
          `
        )
        .join("")}
    </tbody>
  </table>
`;

const ownerOf = (access: ContractOwnerAccess, key: ManagedContractKey): boolean =>
  Boolean(access.contracts.find((contract) => contract.key === key)?.isOwner);

const roleList = (entries: string[], empty: string): string =>
  entries.length
    ? `<ul class="inline-list">${entries.map((entry) => `<li><code>${escapeHtml(entry)}</code></li>`).join("")}</ul>`
    : `<span class="muted-copy">${escapeHtml(empty)}</span>`;

const allowedSelect = (name = "allowed"): string => `
  <label>
    mode
    <select name="${escapeHtml(name)}">
      <option value="true">allow</option>
      <option value="false">remove</option>
    </select>
  </label>
`;

const addressInput = (label: string, name = "address", placeholder = "0x..."): string => `
  <label>
    ${escapeHtml(label)}
    <input name="${escapeHtml(name)}" type="text" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(
      placeholder
    )}" required />
  </label>
`;

const actionForm = (action: ManageAction, buttonLabel: string, body: string, disabled = false): string => `
  <form class="stack-form manage-action-form" data-manage-action="${escapeHtml(action)}">
    ${body}
    <button class="button" type="submit" ${disabled ? "disabled" : ""}>${escapeHtml(buttonLabel)}</button>
  </form>
`;

const transferForm = (action: ManageAction, contractLabel: string, disabled: boolean): string =>
  actionForm(
    action,
    `transfer ${contractLabel} owner`,
    `${addressInput("new owner")}`,
    disabled
  );

const renderSnapshot = (snapshot: ManageSnapshot): string => {
  const access = snapshot.ownership;
  const indexDisabled = !ownerOf(access, "index");
  const bondDisabled = !ownerOf(access, "bond");
  const treasuryDisabled = !ownerOf(access, "treasury");

  return `
    <section class="panel manage-page-panel" data-testid="manage-panel">
      <div class="panel-title">[ manage ]</div>
      <p class="helper-copy">Owner actions send real Base transactions from the connected wallet. Renounce ownership is intentionally not exposed here.</p>
      ${snapshot.errorMessage ? `<p class="warning-copy">${escapeHtml(snapshot.errorMessage)}</p>` : ""}
      ${ownershipTable(access)}
      <div id="manage-status" class="action-status" role="status" aria-live="polite"></div>
    </section>

    <section class="panel">
      <div class="panel-title">[ index owner actions ]</div>
      <table class="data-table compact-table">
        <tbody>
          <tr><th>bond vault</th><td><code>${escapeHtml(snapshot.index.bondVault ?? "-")}</code></td></tr>
          <tr><th>treasury vault</th><td><code>${escapeHtml(snapshot.index.treasuryVault ?? "-")}</code></td></tr>
          <tr><th>brokers</th><td>${roleList(snapshot.index.brokers, "no brokers listed")}</td></tr>
          <tr><th>admins</th><td>${roleList(snapshot.index.admins, "no admins listed")}</td></tr>
        </tbody>
      </table>
      <div class="manage-action-grid">
        ${actionForm("index-set-broker", "update index broker", `${addressInput("broker")}${allowedSelect()}`, indexDisabled)}
        ${actionForm("index-set-admin", "update index admin", `${addressInput("admin")}${allowedSelect()}`, indexDisabled)}
        ${actionForm("index-set-bond-vault", "set index bond vault", addressInput("bond vault"), indexDisabled)}
        ${actionForm("index-set-treasury-vault", "set index treasury vault", addressInput("treasury vault"), indexDisabled)}
        ${transferForm("index-transfer-ownership", "index", indexDisabled)}
      </div>
    </section>

    <section class="panel">
      <div class="panel-title">[ treasury owner actions ]</div>
      <table class="data-table compact-table">
        <tbody>
          <tr><th>index</th><td><code>${escapeHtml(snapshot.treasury.index ?? "-")}</code></td></tr>
          <tr><th>payout divisor</th><td>${snapshot.treasury.standardPayoutDivisor?.toString() ?? "-"}</td></tr>
          <tr><th>brokers</th><td>${roleList(snapshot.treasury.brokers, "no brokers listed")}</td></tr>
        </tbody>
      </table>
      <div class="manage-action-grid">
        ${actionForm("treasury-set-broker", "update treasury broker", `${addressInput("broker")}${allowedSelect()}`, treasuryDisabled)}
        ${actionForm("treasury-set-index", "set treasury index", addressInput("index"), treasuryDisabled)}
        ${actionForm(
          "treasury-set-payout-divisor",
          "set payout divisor",
          `<label>standard payout divisor<input name="divisor" type="number" min="1" step="1" inputmode="numeric" required /></label>`,
          treasuryDisabled
        )}
        ${transferForm("treasury-transfer-ownership", "treasury", treasuryDisabled)}
      </div>
    </section>

    <section class="panel">
      <div class="panel-title">[ bond owner actions ]</div>
      <table class="data-table compact-table">
        <tbody>
          <tr><th>slash treasury</th><td><code>${escapeHtml(snapshot.bond.treasury ?? "-")}</code></td></tr>
        </tbody>
      </table>
      <div class="manage-action-grid">
        ${actionForm("bond-set-slasher", "update bond slasher", `${addressInput("slasher")}${allowedSelect()}`, bondDisabled)}
        ${actionForm("bond-set-treasury", "set slash treasury", addressInput("slash treasury"), bondDisabled)}
        ${transferForm("bond-transfer-ownership", "bond vault", bondDisabled)}
      </div>
    </section>
  `;
};

const renderOwnerGate = (context: AppViewContext): string => {
  const status = ownerStatusCopy(context.ownerAccess);
  return `
    <section class="panel manage-page-panel" data-testid="manage-panel">
      <div class="panel-title">[ manage ]</div>
      <p class="warning-copy">${escapeHtml(status)}</p>
      ${
        context.session.address
          ? `<p class="helper-copy">Connected wallet: <code>${escapeHtml(context.session.address)}</code></p>`
          : `<button id="manage-connect-wallet" class="button" type="button">login</button>`
      }
    </section>
  `;
};

export const renderManageView = async (context: AppViewContext): Promise<ViewResult> => {
  if (!context.session.address || context.ownerAccess.status !== "ready" || !context.ownerAccess.access.isAnyOwner) {
    return {
      title: "Manage",
      html: renderOwnerGate(context),
      afterRender(root) {
        root.querySelector<HTMLButtonElement>("#manage-connect-wallet")?.addEventListener("click", () => {
          context.router.navigate("/login");
        });
      }
    };
  }

  const snapshot = await loadManageSnapshot(context.session.address);
  return {
    title: "Manage",
    html: renderSnapshot(snapshot),
    afterRender(root) {
      const status = root.querySelector<HTMLElement>("#manage-status");
      root.querySelectorAll<HTMLFormElement>("[data-manage-action]").forEach((form) => {
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const action = form.dataset.manageAction as ManageAction | undefined;
          if (!action) {
            return;
          }

          const data = new FormData(form);
          const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>(".manage-action-form button"));
          buttons.forEach((button) => {
            button.disabled = true;
          });
          if (status) {
            status.textContent = "waiting for wallet transaction...";
          }

          try {
            const result = await context.runWalletAction(
              {
                title: "owner action",
                message:
                  "Approve the contract-management transaction in your wallet. CheapBugs will wait for Base confirmation after signing."
              },
              () =>
                executeManageAction({
                  action,
                  address: String(data.get("address") ?? ""),
                  divisor: String(data.get("divisor") ?? ""),
                  allowed: String(data.get("allowed") ?? "false") === "true"
                })
            );
            const hashCopy = shortHash(result.txHash, 12, 8);
            if (status) {
              status.textContent = `${result.label} confirmed: ${hashCopy}`;
            }
            context.notify("success", `${result.label} confirmed: ${hashCopy}`);
            form.reset();
            await context.rerender();
          } catch (error) {
            if (isWalletActionCancelled(error)) {
              if (status) {
                status.textContent = "Wallet request cancelled.";
              }
              return;
            }
            appLog.warn("manage: owner action failed", { error });
            const message = error instanceof Error ? error.message : "Owner action failed.";
            if (status) {
              status.textContent = message;
            }
            context.notify("error", message);
          } finally {
            buttons.forEach((button) => {
              button.disabled = false;
            });
          }
        });
      });
    }
  };
};
