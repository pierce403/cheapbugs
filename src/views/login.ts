import { authController } from "../services";
import { escapeHtml, shortHash } from "../lib/utils";
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
      <div class="panel-title">[ xmtp identity ]</div>
      <p class="lede">
        Use a site-generated XMTP wallet for submissions and BUGZ rewards, or keep using an existing wallet below.
      </p>
      <div class="button-row">
        ${
          authController.hasLocalIdentity()
            ? `<button id="use-local-identity" type="button" class="button">use stored xmtp wallet</button>
               <button id="copy-local-recovery" type="button" class="button secondary">copy recovery key</button>
               <button id="forget-local-identity" type="button" class="button secondary">forget stored wallet</button>`
            : `<button id="create-local-identity" type="button" class="button">create local xmtp wallet</button>`
        }
      </div>
    </section>

    <section class="panel">
      <div class="panel-title">[ auth ]</div>
      ${
        authController.isConfigured()
          ? ""
          : `<p class="warning-copy">This deploy is missing VITE_THIRDWEB_CLIENT_ID, so login and uploads are disabled until the GitHub Pages environment is configured.</p>`
      }
      <p class="lede">
        Use thirdweb email verification for an in-app wallet, or connect an external wallet directly. Browser code only uses the
        configured clientId.
      </p>
      <div class="auth-grid">
        <form id="email-code-form" class="stack-form">
          <label>
            email
            <input name="email" type="email" required autocomplete="email" placeholder="researcher@host.tld" />
          </label>
          <button class="button" type="submit" ${authController.isConfigured() ? "" : "disabled"}>send verification code</button>
        </form>

        <form id="email-login-form" class="stack-form">
          <label>
            email
            <input name="email" type="email" required autocomplete="email" placeholder="researcher@host.tld" />
          </label>
          <label>
            code
            <input name="code" type="text" required inputmode="numeric" placeholder="123456" />
          </label>
          <button class="button" type="submit" ${authController.isConfigured() ? "" : "disabled"}>verify and connect</button>
        </form>
      </div>
    </section>

      <section class="panel">
      <div class="panel-title">[ external wallets ]</div>
      <div class="button-row">
        ${externalButtons() || `<span class="muted-copy">No external wallets available while auth is disabled.</span>`}
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
          <tr><th>email</th><td>${escapeHtml(context.session.email ?? "-")}</td></tr>
          <tr><th>reviewer</th><td>${context.session.isReviewer ? "trusted" : "no"}</td></tr>
          <tr><th>error</th><td>${escapeHtml(context.session.lastError ?? "-")}</td></tr>
        </tbody>
      </table>
    </section>
  `,
  afterRender: (root, appContext) => {
    const createLocalButton = root.querySelector<HTMLButtonElement>("#create-local-identity");
    const useLocalButton = root.querySelector<HTMLButtonElement>("#use-local-identity");
    const copyLocalButton = root.querySelector<HTMLButtonElement>("#copy-local-recovery");
    const forgetLocalButton = root.querySelector<HTMLButtonElement>("#forget-local-identity");
    const codeForm = root.querySelector<HTMLFormElement>("#email-code-form");
    const loginForm = root.querySelector<HTMLFormElement>("#email-login-form");

    createLocalButton?.addEventListener("click", async () => {
      try {
        const identity = await authController.createLocalIdentity();
        appContext.notify("success", `Local XMTP wallet created: ${identity.address}.`);
        appContext.router.navigate("/submit");
      } catch (error) {
        appContext.notify("error", error instanceof Error ? error.message : "Failed to create local XMTP wallet.");
      }
    });

    useLocalButton?.addEventListener("click", async () => {
      try {
        const identity = await authController.useLocalIdentity();
        appContext.notify("success", `Using local XMTP wallet ${identity.address}.`);
        appContext.router.navigate("/submit");
      } catch (error) {
        appContext.notify("error", error instanceof Error ? error.message : "Failed to load local XMTP wallet.");
      }
    });

    copyLocalButton?.addEventListener("click", async () => {
      const identity = authController.getLocalIdentity();
      const recovery = identity?.mnemonic || identity?.privateKey;
      if (!recovery) {
        appContext.notify("error", "No local XMTP recovery key is stored in this browser.");
        return;
      }
      try {
        await navigator.clipboard.writeText(recovery);
        appContext.notify("success", "Local XMTP recovery key copied.");
      } catch {
        appContext.notify("error", "Clipboard write failed.");
      }
    });

    forgetLocalButton?.addEventListener("click", () => {
      if (!window.confirm("Forget the stored XMTP wallet from this browser? Funds at that address will require the recovery key.")) {
        return;
      }
      authController.forgetLocalIdentity();
      appContext.notify("success", "Stored XMTP wallet removed from this browser.");
      appContext.router.navigate("/login");
    });

    codeForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(codeForm);
      const email = String(formData.get("email") || "");
      try {
        await authController.sendEmailCode(email);
        appContext.notify("success", `Verification code sent to ${email}.`);
      } catch (error) {
        appContext.notify("error", error instanceof Error ? error.message : "Failed to send verification code.");
      }
    });

    loginForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(loginForm);
      const email = String(formData.get("email") || "");
      const code = String(formData.get("code") || "");
      try {
        await authController.connectEmail(email, code);
        appContext.notify("success", "In-app wallet connected.");
        appContext.router.navigate("/submit");
      } catch (error) {
        appContext.notify("error", error instanceof Error ? error.message : "Email login failed.");
      }
    });

    root.querySelectorAll<HTMLButtonElement>("[data-wallet-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        const walletId = button.dataset.walletId;
        if (!walletId) {
          return;
        }

        try {
          await authController.connectExternal(walletId);
          appContext.notify("success", `Connected ${walletId}.`);
          appContext.router.navigate("/");
        } catch (error) {
          appContext.notify("error", error instanceof Error ? error.message : "Wallet connection failed.");
        }
      });
    });
  }
});
