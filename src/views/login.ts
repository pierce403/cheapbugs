import { authController } from "../services";
import { escapeHtml, shortHash } from "../lib/utils";

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
      <table class="data-table compact-table">
        <tbody>
          <tr><th>status</th><td>${escapeHtml(context.session.status)}</td></tr>
          <tr><th>mode</th><td>${escapeHtml(context.session.mode ?? "-")}</td></tr>
          <tr><th>address</th><td>${escapeHtml(context.session.address ? shortHash(context.session.address, 14, 8) : "-")}</td></tr>
          <tr><th>email</th><td>${escapeHtml(context.session.email ?? "-")}</td></tr>
          <tr><th>reviewer</th><td>${context.session.isReviewer ? "trusted" : "no"}</td></tr>
          <tr><th>error</th><td>${escapeHtml(context.session.lastError ?? "-")}</td></tr>
        </tbody>
      </table>
    </section>
  `,
  afterRender: (root, appContext) => {
    const codeForm = root.querySelector<HTMLFormElement>("#email-code-form");
    const loginForm = root.querySelector<HTMLFormElement>("#email-login-form");

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
