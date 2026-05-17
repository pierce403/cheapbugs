import { authController } from "../services";
import { env } from "../config/env";
import { escapeHtml } from "../lib/utils";
import { sendBrokerSubmission } from "../xmtp/broker";

import type { AppViewContext, ViewResult } from "./types";

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
      <button class="button" type="submit" ${context.session.address ? "" : "disabled"}>
        submit to broker
      </button>
    </form>
  `,
  afterRender: (root, appContext) => {
    const form = root.querySelector<HTMLFormElement>("#submit-form");

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
          throw new Error("Connect with a local XMTP wallet or a wallet that can sign XMTP messages.");
        }
        const result = await sendBrokerSubmission(xmtpIdentity, input);
        appContext.notify("success", `Submission sent over XMTP to the broker. Message ${result.messageId}.`);
        appContext.router.navigate("/");
      } catch (error) {
        appContext.notify("error", error instanceof Error ? error.message : "Submission failed.");
      }
    });
  }
});
