import { authController } from "../services";
import { appLog } from "../lib/logger";
import { downloadTextFile } from "../lib/download";
import { escapeHtml, formatDate, shortHash } from "../lib/utils";
import { ENS_APP_URL } from "../lib/ens";

import type { AppViewContext, ViewResult } from "./types";

const externalButtons = () =>
  authController
    .listExternalWallets()
    .map(
      (wallet) =>
        `<button type="button" class="button secondary" data-wallet-id="${escapeHtml(wallet.id)}">${escapeHtml(wallet.label)}</button>`
    )
    .join("");

export const renderLoginView = async (context: AppViewContext): Promise<ViewResult> => ({
  title: "Login",
  html: `
    <section class="panel">
      <div class="panel-title">[ embedded wallet ]</div>
      <p class="lede">
        Use a site-generated embedded wallet for submissions, BUGZ rewards, smart contract transactions, and XMTP messages.
        Export <code>cheapbugs-key.json</code> and keep it private.
      </p>
      <div class="button-row">
        ${
          authController.hasLocalIdentity()
            ? `<button id="use-local-identity" type="button" class="button">use stored embedded wallet</button>
               <button id="export-local-key" type="button" class="button secondary">export cheapbugs-key.json</button>
               <button id="forget-local-identity" type="button" class="button secondary">forget stored wallet</button>`
            : `<button id="create-local-identity" type="button" class="button">generate embedded wallet</button>`
        }
        <button id="choose-local-key" type="button" class="button secondary">import cheapbugs-key.json</button>
        <input id="import-local-key" type="file" accept="application/json,.json" style="display: none" />
      </div>
    </section>

    <section class="panel">
      <div class="panel-title">[ auth ]</div>
      ${
        authController.isConfigured()
          ? ""
          : `<p class="warning-copy">VITE_THIRDWEB_CLIENT_ID is unset, so Thirdweb wallet login is disabled.</p>`
      }
      <p class="lede">
        Sign in through Thirdweb with the wallet built into this browser. If this browser has no web3 provider, use
        WalletConnect QR or the embedded wallet option above.
      </p>
      <div class="button-row">
        <button id="connect-primary-wallet" type="button" class="button" ${authController.isConfigured() ? "" : "disabled"}>sign in with wallet</button>
        <button id="open-embedded-wallet-options" type="button" class="button secondary">I don't have a crypto wallet</button>
      </div>
    </section>

    <section class="panel">
      <div class="panel-title">[ external wallets ]</div>
      <div class="button-row">
        ${externalButtons() || `<span class="muted-copy">Configure VITE_THIRDWEB_CLIENT_ID to enable Thirdweb wallet login.</span>`}
      </div>
    </section>

    <section class="panel">
      <div class="panel-title">[ session ]</div>
      ${
        context.session.address
          ? context.session.ensName
            ? `<p class="session-copy">resolved ENS identity: ${escapeHtml(context.session.ensName)}${context.session.ensAvatarUrl ? " / avatar loaded" : ""}</p>`
            : context.session.ensLookupStatus === "loading"
              ? `<p class="session-copy">resolving ENS profile for ${escapeHtml(shortHash(context.session.address, 14, 8))}...</p>`
              : context.session.ensLookupStatus === "missing"
                ? `<p class="warning-copy">No ENS name found for this wallet. <a href="${ENS_APP_URL}" target="_blank" rel="noreferrer">Create one on ENS</a>.</p>`
                : `<p class="warning-copy">ENS lookup is unavailable right now. Try again later.</p>`
          : `<p class="session-copy">Connect a wallet to resolve ENS name and avatar.</p>`
      }
      <table class="data-table compact-table">
        <tbody>
          <tr><th>status</th><td>${escapeHtml(context.session.status)}</td></tr>
          <tr><th>mode</th><td>${escapeHtml(context.session.mode ?? "-")}</td></tr>
          <tr><th>address</th><td>${escapeHtml(context.session.address ? shortHash(context.session.address, 14, 8) : "-")}</td></tr>
          <tr><th>ens status</th><td>${escapeHtml(context.session.ensLookupStatus)}</td></tr>
          <tr><th>ens</th><td>${escapeHtml(context.session.ensName ?? "-")}</td></tr>
          <tr><th>avatar</th><td>${context.session.ensAvatarUrl ? `<a href="${escapeHtml(context.session.ensAvatarUrl)}" target="_blank" rel="noreferrer">loaded</a>` : "-"}</td></tr>
          <tr><th>siwe</th><td>${escapeHtml(context.session.siweIssuedAt ? `signed ${formatDate(context.session.siweIssuedAt)}` : context.session.mode === "local" ? "not required for embedded wallet" : "-")}</td></tr>
          <tr><th>reviewer</th><td>${context.session.isReviewer ? "trusted" : "no"}</td></tr>
          <tr><th>error</th><td>${escapeHtml(context.session.lastError ?? "-")}</td></tr>
        </tbody>
      </table>
    </section>
  `,
  afterRender: (root, appContext) => {
    const createLocalButton = root.querySelector<HTMLButtonElement>("#create-local-identity");
    const useLocalButton = root.querySelector<HTMLButtonElement>("#use-local-identity");
    const exportLocalButton = root.querySelector<HTMLButtonElement>("#export-local-key");
    const forgetLocalButton = root.querySelector<HTMLButtonElement>("#forget-local-identity");
    const connectPrimaryButton = root.querySelector<HTMLButtonElement>("#connect-primary-wallet");
    const chooseLocalKeyButton = root.querySelector<HTMLButtonElement>("#choose-local-key");
    const importLocalKeyInput = root.querySelector<HTMLInputElement>("#import-local-key");
    const embeddedWalletOptionsButton = root.querySelector<HTMLButtonElement>("#open-embedded-wallet-options");

    createLocalButton?.addEventListener("click", async () => {
      appLog.info("ui: create embedded wallet click");
      try {
        const identity = await authController.createLocalIdentity();
        appContext.notify("success", `Embedded CheapBugs wallet created: ${identity.address}.`);
        appContext.router.navigate("/submit");
      } catch (error) {
        appLog.error("ui: create embedded wallet failed", error);
        appContext.notify("error", error instanceof Error ? error.message : "Failed to create embedded wallet.");
      }
    });

    useLocalButton?.addEventListener("click", async () => {
      appLog.info("ui: use embedded wallet click");
      try {
        const identity = await authController.useLocalIdentity();
        appContext.notify("success", `Using embedded CheapBugs wallet ${identity.address}.`);
        appContext.router.navigate("/submit");
      } catch (error) {
        appLog.error("ui: use embedded wallet failed", error);
        appContext.notify("error", error instanceof Error ? error.message : "Failed to load embedded wallet.");
      }
    });

    exportLocalButton?.addEventListener("click", () => {
      appLog.info("ui: export embedded key click");
      try {
        downloadTextFile("cheapbugs-key.json", authController.exportLocalIdentityJson());
        appContext.notify("success", "cheapbugs-key.json exported. Keep it private.");
      } catch (error) {
        appLog.error("ui: export embedded key failed", error);
        appContext.notify("error", error instanceof Error ? error.message : "Embedded wallet export failed.");
      }
    });

    chooseLocalKeyButton?.addEventListener("click", () => {
      importLocalKeyInput?.click();
    });

    importLocalKeyInput?.addEventListener("change", async () => {
      const file = importLocalKeyInput.files?.[0];
      if (!file) {
        return;
      }
      try {
        const identity = await authController.importLocalIdentityFromJson(await file.text());
        appContext.notify("success", `Imported embedded CheapBugs wallet ${identity.address}.`);
        appContext.router.navigate("/submit");
      } catch (error) {
        appLog.error("ui: import embedded key failed", error);
        appContext.notify("error", error instanceof Error ? error.message : "Embedded wallet import failed.");
      } finally {
        importLocalKeyInput.value = "";
      }
    });

    forgetLocalButton?.addEventListener("click", () => {
      appLog.info("ui: forget embedded wallet click");
      if (!window.confirm("Forget the embedded wallet from this browser? Funds at that address require cheapbugs-key.json.")) {
        appLog.info("ui: forget embedded wallet cancelled");
        return;
      }
      authController.forgetLocalIdentity();
      appContext.notify("success", "Embedded wallet removed from this browser.");
      appContext.router.navigate("/login");
    });

    connectPrimaryButton?.addEventListener("click", async () => {
      appLog.info("ui: session view primary login click");
      if (!authController.isConfigured()) {
        appContext.openWalletOnboarding("embedded");
        return;
      }
      if (authController.primaryUsesWalletConnect()) {
        appContext.openWalletOnboarding("walletconnect");
        return;
      }
      try {
        await authController.connectPrimary();
        appContext.notify("success", "Signed in with wallet.");
        appContext.router.navigate("/");
      } catch (error) {
        appLog.error("ui: session view primary login failed", error);
        appContext.notify("error", error instanceof Error ? error.message : "Wallet connection failed.");
      }
    });

    root.querySelectorAll<HTMLButtonElement>("[data-wallet-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        const walletId = button.dataset.walletId;
        if (!walletId) {
          return;
        }

        appLog.info("ui: external wallet button click", { walletId });
        if (walletId === "walletConnect") {
          appContext.openWalletOnboarding("walletconnect");
          return;
        }
        try {
          await authController.connectExternal(walletId);
          appContext.notify("success", `Signed in with ${authController.walletLabel(walletId)}.`);
          appContext.router.navigate("/");
        } catch (error) {
          appLog.error("ui: external wallet login failed", { walletId, error });
          appContext.notify("error", error instanceof Error ? error.message : "Wallet connection failed.");
        }
      });
    });

    embeddedWalletOptionsButton?.addEventListener("click", () => {
      appContext.openWalletOnboarding("embedded");
    });
  }
});
