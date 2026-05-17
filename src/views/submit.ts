import { authController } from "../services";
import { env } from "../config/env";
import { appLog } from "../lib/logger";
import { escapeHtml } from "../lib/utils";
import { sendBrokerSubmission } from "../xmtp/broker";

import type { AppViewContext, ViewResult } from "./types";

type XmtpStatusTone = "ready" | "blocked" | "working" | "sent" | "error";

const initialXmtpStatus = () => {
  const identity = authController.getXmtpIdentity();
  if (identity) {
    return {
      tone: "ready" as const,
      title: "xmtp: ready",
      detail: `ready to submit from ${identity.address}`
    };
  }

  const session = authController.getSession();
  if (session.address) {
    return {
      tone: "blocked" as const,
      title: "xmtp: signer unavailable",
      detail: "This wallet session cannot sign XMTP messages. Use a local XMTP wallet or a compatible external wallet."
    };
  }

  return {
    tone: "blocked" as const,
    title: "xmtp: wallet required",
    detail: "Connect a local XMTP wallet or compatible external wallet before submitting."
  };
};

const statusMarkup = (status = initialXmtpStatus()): string => `
  <div id="xmtp-status" class="xmtp-status xmtp-status-${status.tone}" role="status" aria-live="polite" data-testid="xmtp-status">
    <span class="xmtp-status-light" aria-hidden="true"></span>
    <div class="xmtp-status-copy">
      <strong id="xmtp-status-title">${escapeHtml(status.title)}</strong>
      <span id="xmtp-status-detail">${escapeHtml(status.detail)}</span>
    </div>
  </div>
`;

export const renderSubmitView = async (context: AppViewContext): Promise<ViewResult> => ({
  title: "Submit",
  html: `
    <section class="panel">
      <div class="panel-title">[ submit report ]</div>
      <p class="warning-copy">
        Never place sensitive bug details in the public summary unless you intentionally want them public. Private details are sent
        to the broker over XMTP. The broker generates and holds the review key.
      </p>
      <p class="helper-copy">xmtp broker wallet: ${escapeHtml(env.brokerXmtpAddress)}</p>
      ${statusMarkup()}
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
      <label>details<textarea name="details" rows="7" required placeholder="Private details only."></textarea></label>
      <button id="submit-to-broker" class="button" type="submit">
        submit to broker
      </button>
    </form>
  `,
  afterRender: (root) => {
    const form = root.querySelector<HTMLFormElement>("#submit-form");
    if (!form) {
      return;
    }

    const submitButton = root.querySelector<HTMLButtonElement>("#submit-to-broker");
    const status = root.querySelector<HTMLElement>("#xmtp-status");
    const statusTitle = root.querySelector<HTMLElement>("#xmtp-status-title");
    const statusDetail = root.querySelector<HTMLElement>("#xmtp-status-detail");

    const setStatus = (tone: XmtpStatusTone, title: string, detail: string) => {
      status?.classList.remove(
        "xmtp-status-ready",
        "xmtp-status-blocked",
        "xmtp-status-working",
        "xmtp-status-sent",
        "xmtp-status-error"
      );
      status?.classList.add(`xmtp-status-${tone}`);
      if (statusTitle) {
        statusTitle.textContent = title;
      }
      if (statusDetail) {
        statusDetail.textContent = detail;
      }
    };

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      appLog.info("submit: broker form submit requested");
      const address = authController.getSession().address;
      if (!address) {
        setStatus("blocked", "xmtp: wallet required", "Connect a local XMTP wallet or compatible external wallet before submitting.");
        appLog.warn("submit: broker submit blocked without wallet");
        return;
      }

      const formData = new FormData(form);
      submitButton?.setAttribute("disabled", "true");
      submitButton?.setAttribute("aria-busy", "true");
      try {
        const input = {
          title: String(formData.get("title") || ""),
          publicSummary: String(formData.get("publicSummary") || ""),
          details: String(formData.get("details") || ""),
          reproSteps: "",
          evidence: "",
          suggestedSeverity: "unrated",
          contactHints: "",
          targetKind: "other" as never,
          targetRef: "",
          tags: "",
          disclosureMode: "private" as never
        };

        const xmtpIdentity = authController.getXmtpIdentity();
        if (!xmtpIdentity) {
          setStatus("blocked", "xmtp: signer unavailable", "Connect with a local XMTP wallet or a wallet that can sign XMTP messages.");
          appLog.warn("submit: broker submit blocked without XMTP signer");
          return;
        }
        setStatus("working", "xmtp: connecting", "Preparing broker submission.");
        const result = await sendBrokerSubmission(xmtpIdentity, input, (message) => {
          setStatus("working", "xmtp: sending", message);
          appLog.info("submit: broker XMTP progress", { message });
        });
        setStatus("sent", "xmtp: sent", `Broker message ${result.messageId} sent.`);
        form.reset();
        appLog.info("submit: broker submission sent", result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Submission failed.";
        setStatus("error", "xmtp: failed", message);
        appLog.error("submit: broker submission failed", error);
      } finally {
        submitButton?.removeAttribute("disabled");
        submitButton?.removeAttribute("aria-busy");
      }
    });
  }
});
