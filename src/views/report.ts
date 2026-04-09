import { getSchemaCatalog } from "../lib/schema-overrides";
import { computeReviewDisplayState } from "../lib/eas";
import { decryptPrivateSubmission, getStoredAccessKey, loadReviewVerdicts, loadSubmissionBundle, submitReviewVerdict } from "../lib/reports";
import { saveReportAccessKey } from "../lib/report-access";
import { toGatewayUrl } from "../lib/ipfs";
import { chainConfig } from "../config/chains";
import { escapeHtml, formatDate, newlineToBreaks, shortHash, textOrDash } from "../lib/utils";

import type { AppViewContext, ViewResult } from "./types";

export const renderReportView = async (context: AppViewContext): Promise<ViewResult> => {
  const reportHash = context.route.params.id as `0x${string}`;
  const bundle = await loadSubmissionBundle(reportHash);

  if (!bundle) {
    return {
      title: "Report Not Found",
      html: `
        <section class="panel">
          <div class="panel-title">[ report lookup ]</div>
          <p>No onchain bug-index entry was found for ${escapeHtml(reportHash)}.</p>
        </section>
      `
    };
  }

  const reviews = await loadReviewVerdicts(reportHash);
  const reviewState = computeReviewDisplayState(reviews);
  const accessKey = getStoredAccessKey(reportHash);
  let privateView = `<p class="muted-copy">Private dossier locked. Paste the review access key to decrypt client-side.</p>`;

  if (accessKey) {
    try {
      const privateSubmission = await decryptPrivateSubmission(bundle.publicSubmission.encryptedPayloadCid, accessKey);
      privateView = `
        <table class="data-table">
          <tbody>
            <tr><th>title</th><td>${escapeHtml(privateSubmission.title)}</td></tr>
            <tr><th>details</th><td>${newlineToBreaks(privateSubmission.details)}</td></tr>
            <tr><th>repro</th><td>${newlineToBreaks(privateSubmission.reproSteps)}</td></tr>
            <tr><th>evidence</th><td>${newlineToBreaks(textOrDash(privateSubmission.evidence))}</td></tr>
            <tr><th>contact hints</th><td>${newlineToBreaks(textOrDash(privateSubmission.contactHints))}</td></tr>
            <tr><th>target ref</th><td>${escapeHtml(privateSubmission.targetRef)}</td></tr>
          </tbody>
        </table>
      `;
    } catch {
      privateView = `<p class="warning-copy">Stored access key failed to decrypt this payload. Re-enter a valid review key below.</p>`;
    }
  }

  const trustedRows = reviewState.trusted.length
    ? reviewState.trusted
        .map(
          (review) => `
            <tr>
              <td>${escapeHtml(shortHash(review.reviewer, 12, 8))}</td>
              <td>${escapeHtml(review.validity)}</td>
              <td>${escapeHtml(review.impact)}</td>
              <td>${escapeHtml(review.rewardClass)}</td>
              <td>${escapeHtml(String(review.confidence))}</td>
              <td>${review.noteCid ? `<a href="${escapeHtml(toGatewayUrl(review.noteCid))}" target="_blank" rel="noreferrer">note</a>` : "-"}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="6" class="muted-cell">No trusted verdicts yet.</td></tr>`;

  const schemaWarning = getSchemaCatalog().filter((schema) => !schema.uid).length
    ? `<p class="warning-copy">One or more review-related schema UIDs are unset. Reviewer verdict writes will fail until schemas are registered and configured.</p>`
    : "";
  const bugIndexWarning = !chainConfig.bugIndexAddress
    ? `<p class="warning-copy">VITE_BUG_INDEX_ADDRESS is unset. Base onchain submissions are disabled until the bug index contract is deployed and configured.</p>`
    : "";

  return {
    title: bundle.publicSubmission.reportId,
    html: `
      <section class="panel">
        <div class="panel-title">[ ${escapeHtml(bundle.publicSubmission.reportId)} ]</div>
        ${bugIndexWarning}
        ${schemaWarning}
        <table class="data-table">
          <tbody>
            <tr><th>report hash</th><td>${escapeHtml(bundle.publicSubmission.reportHash)}</td></tr>
            <tr><th>created</th><td>${escapeHtml(formatDate(bundle.publicSubmission.createdAt))}</td></tr>
            <tr><th>reporter</th><td>${escapeHtml(bundle.publicSubmission.reporterAddress)}</td></tr>
            <tr><th>mode</th><td>${escapeHtml(bundle.publicSubmission.disclosureMode)}</td></tr>
            <tr><th>target</th><td>${escapeHtml(bundle.publicSubmission.targetKind)}</td></tr>
            <tr><th>target ref hash</th><td>${escapeHtml(bundle.publicSubmission.targetRefHash)}</td></tr>
            <tr><th>content hash</th><td>${escapeHtml(bundle.publicSubmission.contentHash)}</td></tr>
            <tr><th>encrypted payload</th><td><a href="${escapeHtml(
              toGatewayUrl(bundle.publicSubmission.encryptedPayloadCid)
            )}" target="_blank" rel="noreferrer">ipfs blob</a></td></tr>
            <tr><th>summary</th><td>${newlineToBreaks(bundle.publicSubmission.publicSummary)}</td></tr>
            <tr><th>tags</th><td>${escapeHtml(textOrDash(bundle.publicSubmission.tags.join(", ")))}</td></tr>
            <tr><th>bug index</th><td>${escapeHtml(chainConfig.bugIndexAddress || "unset")}</td></tr>
          </tbody>
        </table>
      </section>

      <section class="panel">
        <div class="panel-title">[ trusted review state ]</div>
        <p class="lede">
          headline: ${escapeHtml(reviewState.headline?.validity ?? "pending")} /
          ${escapeHtml(reviewState.headline?.impact ?? "none")} /
          ${escapeHtml(reviewState.headline?.rewardClass ?? "none")} /
          confidence ${escapeHtml(String(reviewState.confidenceAverage ?? 0))}
        </p>
        <table class="data-table compact-table">
          <thead>
            <tr>
              <th>reviewer</th>
              <th>validity</th>
              <th>impact</th>
              <th>reward</th>
              <th>confidence</th>
              <th>note</th>
            </tr>
          </thead>
          <tbody>${trustedRows}</tbody>
        </table>
      </section>

      <section class="panel">
        <div class="panel-title">[ private dossier ]</div>
        <form id="access-key-form" class="stack-form narrow-form">
          <label>
            review access key
            <div class="inline-input">
              <input id="report-access-key" name="accessKey" type="password" value="${escapeHtml(accessKey ?? "")}" />
              <button id="reveal-access-key" type="button" class="button secondary">reveal</button>
              <button id="copy-access-key" type="button" class="button secondary">copy</button>
            </div>
          </label>
          <button class="button secondary" type="submit">unlock dossier</button>
        </form>
        <div class="private-view">${privateView}</div>
      </section>

      ${
        context.session.isReviewer
          ? `
            <form id="review-form" class="panel stack-form">
              <div class="panel-title">[ reviewer verdict ]</div>
              <div class="two-column">
                <label>
                  validity
                  <select name="validity">
                    <option value="confirmed">confirmed</option>
                    <option value="unconfirmed">unconfirmed</option>
                    <option value="invalid">invalid</option>
                    <option value="duplicate">duplicate</option>
                    <option value="spam">spam</option>
                  </select>
                </label>
                <label>
                  impact
                  <select name="impact">
                    <option value="none">none</option>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                    <option value="critical">critical</option>
                  </select>
                </label>
              </div>
              <div class="two-column">
                <label>
                  reward class
                  <select name="rewardClass">
                    <option value="none">none</option>
                    <option value="points">points</option>
                    <option value="paid">paid</option>
                  </select>
                </label>
                <label>
                  confidence
                  <input name="confidence" type="number" min="0" max="100" value="80" />
                </label>
              </div>
              <label>
                public reviewer note
                <textarea name="note" rows="4" placeholder="Optional note; uploaded publicly to IPFS if provided."></textarea>
              </label>
              <button class="button" type="submit">attest verdict</button>
            </form>
          `
          : ""
      }
    `,
    afterRender: (root, appContext) => {
      const accessForm = root.querySelector<HTMLFormElement>("#access-key-form");
      const accessInput = root.querySelector<HTMLInputElement>("#report-access-key");
      const revealButton = root.querySelector<HTMLButtonElement>("#reveal-access-key");
      const copyButton = root.querySelector<HTMLButtonElement>("#copy-access-key");
      const reviewForm = root.querySelector<HTMLFormElement>("#review-form");

      revealButton?.addEventListener("click", () => {
        if (!accessInput) {
          return;
        }
        accessInput.type = accessInput.type === "password" ? "text" : "password";
      });

      copyButton?.addEventListener("click", async () => {
        if (!accessInput?.value) {
          return;
        }
        try {
          await navigator.clipboard.writeText(accessInput.value);
          appContext.notify("success", "Review access key copied.");
        } catch (error) {
          appContext.notify("error", error instanceof Error ? error.message : "Copy failed.");
        }
      });

      accessForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(accessForm);
        const key = String(formData.get("accessKey") || "");
        if (!key) {
          return;
        }

        saveReportAccessKey(reportHash, key);
        appContext.notify("success", "Review access key saved locally for this report.");
        await appContext.rerender();
      });

      reviewForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(reviewForm);
        try {
          const result = await submitReviewVerdict(reportHash, {
            validity: String(formData.get("validity") || "unconfirmed") as never,
            impact: String(formData.get("impact") || "none") as never,
            rewardClass: String(formData.get("rewardClass") || "none") as never,
            confidence: Number(formData.get("confidence") || 0),
            note: String(formData.get("note") || "")
          });

          appContext.notify("success", `Review verdict attested: ${shortHash(result.attestationUid, 14, 8)}.`);
          await appContext.rerender();
        } catch (error) {
          appContext.notify("error", error instanceof Error ? error.message : "Review attestation failed.");
        }
      });
    }
  };
};
