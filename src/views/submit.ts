import { authController } from "../services";
import { env } from "../config/env";
import { appLog } from "../lib/logger";
import { escapeHtml } from "../lib/utils";
import { sendBrokerSubmission } from "../xmtp/broker";

import type { AppViewContext, ViewResult } from "./types";

type XmtpStatusTone = "ready" | "blocked" | "working" | "sent" | "error";
type XmtpStatus = {
  tone: XmtpStatusTone;
  title: string;
  detail: string;
};
type SignatureWaitState = {
  open: boolean;
  detail: string;
};

let persistedXmtpStatus: XmtpStatus | null = null;
let persistedSignatureWait: SignatureWaitState = {
  open: false,
  detail: "Approve the XMTP registration signature in your wallet app or browser extension. This does not send a transaction."
};
let submitInFlight = false;

const XMTP_PROGRESS_EVENT = "cheapbugs:xmtp-progress";
const signatureWaitDetail =
  "Approve the XMTP registration signature in your wallet app or browser extension. This does not send a transaction.";

const initialXmtpStatus = (): XmtpStatus => {
  if (persistedXmtpStatus && (submitInFlight || persistedXmtpStatus.tone === "sent" || persistedXmtpStatus.tone === "error")) {
    return persistedXmtpStatus;
  }

  const identity = authController.getXmtpIdentity();
  if (identity) {
    return {
      tone: "ready" as const,
      title: "xmtp: signer ready",
      detail: `ready to connect and submit from ${identity.address}`
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

const xmtpErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "Submission failed.";
  if (/request expired/i.test(message)) {
    return "Wallet request expired before XMTP registration finished. Clear any stale wallet prompts, then submit again and approve the XMTP signature request.";
  }
  if (/user rejected|user denied|rejected request/i.test(message)) {
    return "Wallet signature was rejected before XMTP registration finished. Submit again and approve the XMTP signature request.";
  }
  return message;
};

const isSignatureWaitProgress = (message: string): boolean => /waiting for .*xmtp wallet signature/i.test(message);

const isSignatureSettledProgress = (message: string): boolean =>
  /xmtp wallet signature approved|using cached xmtp wallet signature/i.test(message);

const statusMarkup = (status = initialXmtpStatus()): string => `
  <div id="xmtp-status" class="xmtp-status xmtp-status-${status.tone}" role="status" aria-live="polite" data-testid="xmtp-status">
    <span class="xmtp-status-light" aria-hidden="true"></span>
    <div class="xmtp-status-copy">
      <strong id="xmtp-status-title">${escapeHtml(status.title)}</strong>
      <span id="xmtp-status-detail">${escapeHtml(status.detail)}</span>
    </div>
  </div>
`;

const signatureWaitModalMarkup = (state = persistedSignatureWait): string => `
  <div
    id="xmtp-signature-modal"
    class="signature-modal-backdrop${state.open ? " is-open" : ""}"
    role="dialog"
    aria-modal="true"
    aria-label="wallet signature"
    aria-live="assertive"
    data-testid="xmtp-signature-modal"
    ${state.open ? "" : "hidden"}
  >
    <section class="signature-modal panel" aria-busy="true">
      <div class="signature-spinner" aria-hidden="true"></div>
      <div class="signature-modal-copy">
        <div class="panel-title">[ wallet signature ]</div>
        <strong>waiting for signature from wallet device</strong>
        <p id="xmtp-signature-detail">${escapeHtml(state.detail)}</p>
      </div>
    </section>
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
    ${signatureWaitModalMarkup()}
  `,
  afterRender: (root, appContext) => {
    const form = root.querySelector<HTMLFormElement>("#submit-form");
    if (!form) {
      return;
    }

    const submitButton = root.querySelector<HTMLButtonElement>("#submit-to-broker");
    const status = root.querySelector<HTMLElement>("#xmtp-status");
    const statusTitle = root.querySelector<HTMLElement>("#xmtp-status-title");
    const statusDetail = root.querySelector<HTMLElement>("#xmtp-status-detail");
    const signatureModal = root.querySelector<HTMLElement>("#xmtp-signature-modal");
    const signatureDetail = root.querySelector<HTMLElement>("#xmtp-signature-detail");

    const setSignatureWait = (open: boolean, detail = signatureWaitDetail) => {
      persistedSignatureWait = { open, detail };
      signatureModal?.toggleAttribute("hidden", !open);
      signatureModal?.classList.toggle("is-open", open);
      if (signatureDetail) {
        signatureDetail.textContent = detail;
      }
      if (!signatureModal || !document.body.contains(signatureModal)) {
        void appContext.rerender();
      }
    };

    const setStatus = (tone: XmtpStatusTone, title: string, detail: string) => {
      persistedXmtpStatus = { tone, title, detail };
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
      if (tone !== "working") {
        setSignatureWait(false);
      }
      if (!status || !document.body.contains(status)) {
        void appContext.rerender();
      }
    };

    const handleXmtpProgress = (message: string) => {
      if (isSignatureWaitProgress(message)) {
        setSignatureWait(true);
      } else if (isSignatureSettledProgress(message)) {
        setSignatureWait(false);
      }

      setStatus("working", "xmtp: sending", message);
      appLog.info("submit: broker XMTP progress", { message });
    };

    root.addEventListener(XMTP_PROGRESS_EVENT, ((event: Event) => {
      const message = (event as CustomEvent<{ message?: unknown }>).detail?.message;
      if (typeof message === "string") {
        handleXmtpProgress(message);
      }
    }) as EventListener);

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      appLog.info("submit: broker form submit requested");
      if (submitInFlight) {
        setStatus("working", "xmtp: sending", "A broker submission is already in progress.");
        return;
      }
      const address = authController.getSession().address;
      if (!address) {
        setStatus("blocked", "xmtp: wallet required", "Connect a local XMTP wallet or compatible external wallet before submitting.");
        appLog.warn("submit: broker submit blocked without wallet");
        return;
      }

      const formData = new FormData(form);
      submitInFlight = true;
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
          root.dispatchEvent(new CustomEvent(XMTP_PROGRESS_EVENT, { detail: { message } }));
        });
        setStatus("sent", "xmtp: sent", `Broker message ${result.messageId} sent.`);
        form.reset();
        appLog.info("submit: broker submission sent", result);
      } catch (error) {
        const message = xmtpErrorMessage(error);
        setStatus("error", "xmtp: failed", message);
        appLog.error("submit: broker submission failed", error);
      } finally {
        setSignatureWait(false);
        submitInFlight = false;
        submitButton?.removeAttribute("disabled");
        submitButton?.removeAttribute("aria-busy");
      }
    });
  }
});
