import { authController } from "../services";
import { chainConfig } from "../config/chains";
import { env } from "../config/env";
import { createAccessKey } from "../lib/crypto";
import { submitReport } from "../lib/reports";
import { escapeHtml } from "../lib/utils";
import { isBouncerConfigured, sendBouncerSubmission } from "../xmtp/bouncer";

import type { AppViewContext, ViewResult } from "./types";

export const renderSubmitView = async (context: AppViewContext): Promise<ViewResult> => ({
  title: "Submit",
  html: `
    <section class="panel">
      <div class="panel-title">[ submit report ]</div>
      <p class="warning-copy">
        Never place sensitive bug details in the public summary unless you intentionally want them public. Private details are encrypted
        in the browser before IPFS upload on the legacy path. XMTP submissions are sent as strict JSON to the bouncer inbox.
      </p>
      ${
        isBouncerConfigured()
          ? `<p class="helper-copy">xmtp bouncer wallet: ${escapeHtml(env.bouncerXmtpAddress)}</p>`
          : chainConfig.bugIndexAddress
          ? `<p class="helper-copy">bug index contract: ${escapeHtml(chainConfig.bugIndexAddress)}</p>`
          : `<p class="warning-copy">Deploy and configure VITE_BUG_INDEX_ADDRESS before submitting onchain reports.</p>`
      }
      ${
        context.session.address
          ? `<p class="session-copy">connected as ${escapeHtml(context.session.address)}</p>`
          : `<p class="session-copy">connect a wallet first at <a href="${context.router.href("/login")}" data-nav>/login</a>.</p>`
      }
    </section>

    <form id="submit-form" class="panel stack-form">
      <div class="panel-title">[ report fields ]</div>
      <label>title<input name="title" required maxlength="120" placeholder="Heap corruption in parser" /></label>
      <label>public summary<textarea name="publicSummary" rows="3" required placeholder="Redacted public-safe summary for browsing and indexing."></textarea></label>
      <label>details<textarea name="details" rows="7" required placeholder="Private details only. Uploaded encrypted."></textarea></label>
      <label>repro steps<textarea name="reproSteps" rows="6" required placeholder="Minimal reproduction path."></textarea></label>
      <label>evidence<textarea name="evidence" rows="5" placeholder="Logs, tx hashes, screenshots, traces, PoC notes."></textarea></label>
      <label>suggested severity<input name="suggestedSeverity" required placeholder="high" /></label>
      <label>signal recipient<input name="signalRecipient" ${isBouncerConfigured() ? "required" : ""} placeholder="+15551234567 or u:researcher.01" /></label>
      <label>contact hints<textarea name="contactHints" rows="3" placeholder="Preferred disclosure or coordination notes."></textarea></label>
      <div class="two-column">
        <label>
          target kind
          <select name="targetKind">
            <option value="repo">repo</option>
            <option value="package">package</option>
            <option value="domain">domain</option>
            <option value="contract">contract</option>
            <option value="protocol">protocol</option>
            <option value="other">other</option>
          </select>
        </label>
        <label>
          disclosure mode
          <select name="disclosureMode">
            <option value="private">private</option>
            <option value="embargoed">embargoed</option>
            <option value="public">public</option>
          </select>
        </label>
      </div>
      <label>target reference<input name="targetRef" required placeholder="repo URL, package name, contract, domain, protocol ref" /></label>
      <label>tags<input name="tags" placeholder="solidity, mev, auth-bypass" /></label>
      ${
        isBouncerConfigured()
          ? ""
          : `<label>
              review access key
              <div class="inline-input">
                <input id="access-key-input" name="accessKey" required value="${escapeHtml(createAccessKey())}" />
                <button id="regen-access-key" type="button" class="button secondary">regen</button>
              </div>
            </label>
            <p class="helper-copy">
              This key is required to decrypt the private dossier later. Share it out of band with trusted reviewers. The app cannot recover it for you.
            </p>`
      }
      <button class="button" type="submit" ${context.session.address ? "" : "disabled"}>
        ${isBouncerConfigured() ? "submit to broker" : "encrypt, upload, and file on base"}
      </button>
    </form>
  `,
  afterRender: (root, appContext) => {
    const form = root.querySelector<HTMLFormElement>("#submit-form");
    const accessKeyInput = root.querySelector<HTMLInputElement>("#access-key-input");
    const regenButton = root.querySelector<HTMLButtonElement>("#regen-access-key");

    regenButton?.addEventListener("click", () => {
      if (accessKeyInput) {
        accessKeyInput.value = createAccessKey();
      }
    });

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const address = authController.getSession().address;
      if (!address) {
        appContext.notify("error", "Connect a wallet before submitting.");
        appContext.router.navigate("/login");
        return;
      }

      const formData = new FormData(form);
      try {
        const input = {
          title: String(formData.get("title") || ""),
          publicSummary: String(formData.get("publicSummary") || ""),
          details: String(formData.get("details") || ""),
          reproSteps: String(formData.get("reproSteps") || ""),
          evidence: String(formData.get("evidence") || ""),
          suggestedSeverity: String(formData.get("suggestedSeverity") || ""),
          contactHints: String(formData.get("contactHints") || ""),
          targetKind: String(formData.get("targetKind") || "repo") as never,
          targetRef: String(formData.get("targetRef") || ""),
          tags: String(formData.get("tags") || ""),
          disclosureMode: String(formData.get("disclosureMode") || "private") as never
        };

        if (isBouncerConfigured()) {
          const xmtpIdentity = authController.getXmtpIdentity();
          if (!xmtpIdentity) {
            throw new Error("Connect with a local XMTP wallet or a wallet that can sign XMTP messages.");
          }
          const signalRecipient = String(formData.get("signalRecipient") || "").trim();
          if (!signalRecipient) {
            throw new Error("Signal recipient is required for bouncer submissions.");
          }
          const result = await sendBouncerSubmission(xmtpIdentity, input, signalRecipient);
          appContext.notify("success", `Submission sent over XMTP to the bouncer. Message ${result.messageId}.`);
          appContext.router.navigate("/");
          return;
        }

        const result = await submitReport(input, address, String(formData.get("accessKey") || ""));

        appContext.notify(
          "success",
          `Report ${result.reportId} encrypted via ${result.storageProvider}, uploaded to IPFS, and filed on the Base bug index.`
        );
        appContext.router.navigate(`/report/${result.reportHash}`);
      } catch (error) {
        appContext.notify("error", error instanceof Error ? error.message : "Submission failed.");
      }
    });
  }
});
