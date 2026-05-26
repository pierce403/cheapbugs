import { getSchemaUid } from "../lib/schema-overrides";
import { loadAuthorDisplay } from "../lib/authors";
import { computeReviewDisplayState } from "../lib/eas";
import { decryptPrivateSubmission, getStoredAccessKey, loadReviewVerdicts, loadSubmissionBundle, submitReviewVerdict } from "../lib/reports";
import { detailsKeyHexToAccessKey, saveReportAccessKey } from "../lib/report-access";
import { toGatewayUrl } from "../lib/ipfs";
import { bindMarkdownCodeCopy, renderMarkdown } from "../lib/markdown";
import { reportDisplayTarget, reportDisplayTitle } from "../lib/reportDisplay";
import { escapeHtml, formatDate, newlineToBreaks, shortHash, textOrDash } from "../lib/utils";
import { isWalletActionCancelled } from "../lib/walletAction";
import type { ReviewVerdict } from "../types/review";

import { bindDetailUnlockFlow, renderDetailUnlockModal } from "./detailUnlock";
import type { AppViewContext, ViewResult } from "./types";

const renderMarkdownTextArea = (label: string, value: string): string => `
  <div class="report-text-block">
    <div class="report-text-label">${escapeHtml(label)}</div>
    <div class="report-markdown markdown-body">${renderMarkdown(value)}</div>
  </div>
`;

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

  const title = reportDisplayTitle(bundle);
  const target = reportDisplayTarget(bundle);
  const author = await loadAuthorDisplay(bundle.publicSubmission.reporterAddress);
  const authorHref = context.router.href(`/profile/${author.address}`);
  let reviewLoadError: string | null = null;
  let reviews: ReviewVerdict[] = [];
  try {
    reviews = await loadReviewVerdicts(reportHash);
  } catch (error) {
    reviewLoadError = error instanceof Error ? error.message : "Review verdicts could not be loaded.";
  }
  const reviewState = computeReviewDisplayState(reviews);
  const revealedAccessKey = detailsKeyHexToAccessKey(bundle.publicSubmission.detailsKey);
  const storedAccessKey = getStoredAccessKey(reportHash);
  if (revealedAccessKey && revealedAccessKey !== storedAccessKey) {
    saveReportAccessKey(reportHash, revealedAccessKey);
  }
  const accessKey = revealedAccessKey ?? storedAccessKey;
  const revealAt = bundle.publicSubmission.revealAfter ? Date.parse(bundle.publicSubmission.revealAfter) : NaN;
  const canBuyEarlyDetails =
    !accessKey &&
    !bundle.publicSubmission.detailsKeyRevealed &&
    Number.isFinite(revealAt) &&
    revealAt > Date.now();
  let privateView = `<p class="muted-copy">Private details locked. Paste the review access key to decrypt client-side.</p>`;
  const earlyUnlockCta = canBuyEarlyDetails
    ? `
      <button id="buy-detail-unlock" type="button" class="button secondary lock-action" data-detail-unlock-report="${reportHash}">
        <span class="lock-icon" aria-hidden="true"></span>
        buy early access
      </button>
    `
    : "";

  if (accessKey) {
    try {
      const privateSubmission = await decryptPrivateSubmission(
        bundle.publicSubmission.encryptedPayloadCid,
        accessKey,
        bundle.publicSubmission
      );
      privateView = `
        <div class="report-private-content">
          <table class="data-table">
            <tbody>
              <tr><th>bug type</th><td>${escapeHtml(textOrDash(privateSubmission.bugType))}</td></tr>
              <tr><th>severity</th><td>${escapeHtml(textOrDash(privateSubmission.severity))}</td></tr>
              <tr><th>target interest</th><td>${escapeHtml(textOrDash(privateSubmission.targetInterest))}</td></tr>
              <tr><th>title</th><td><strong class="report-title-text">${escapeHtml(privateSubmission.title)}</strong></td></tr>
              <tr><th>repro</th><td>${newlineToBreaks(textOrDash(privateSubmission.reproSteps))}</td></tr>
              <tr><th>evidence</th><td>${newlineToBreaks(textOrDash(privateSubmission.evidence))}</td></tr>
              <tr><th>contact hints</th><td>${newlineToBreaks(textOrDash(privateSubmission.contactHints))}</td></tr>
              <tr><th>target ref</th><td>${escapeHtml(privateSubmission.targetRef)}</td></tr>
            </tbody>
          </table>
          ${renderMarkdownTextArea("details", privateSubmission.details)}
        </div>
      `;
    } catch {
      privateView = revealedAccessKey
        ? `<p class="warning-copy">Revealed onchain details key failed to decrypt this payload. The encrypted BugBundle may still be unavailable or malformed.</p>`
        : `<p class="warning-copy">Stored access key failed to decrypt this payload. Re-enter a valid review key below.</p>`;
    }
  }

  const trustedReviewers = new Set(reviewState.trusted.map((review) => review.reviewer));
  const reviewRows = reviewState.latest.length
    ? reviewState.latest
        .map(
          (review) => `
            <tr>
              <td>${escapeHtml(shortHash(review.reviewer, 12, 8))}</td>
              <td>${trustedReviewers.has(review.reviewer) ? "trusted" : "untrusted"}</td>
              <td>${escapeHtml(review.validity)}</td>
              <td>${escapeHtml(review.impact)}</td>
              <td>${escapeHtml(review.rewardClass)}</td>
              <td>${escapeHtml(String(review.confidence))}</td>
              <td>${review.noteCid ? `<a href="${escapeHtml(toGatewayUrl(review.noteCid))}" target="_blank" rel="noreferrer">note</a>` : "-"}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="7" class="muted-cell">No verdicts yet.</td></tr>`;

  const schemaWarning = !getSchemaUid("ReviewVerdict")
    ? `<p class="warning-copy">Review verdict schema UID is unset. EAS reviews cannot be loaded or submitted until the schema is configured.</p>`
    : "";
  const reviewLoadWarning = reviewLoadError
    ? `<p class="warning-copy">Review verdicts are unavailable: ${escapeHtml(reviewLoadError)}</p>`
    : "";

  return {
    title,
    html: `
      <section class="panel">
        <div class="panel-title">[ ${escapeHtml(title)} ]</div>
        ${schemaWarning}
        <div class="report-heading">
          <strong class="report-title-text">${escapeHtml(title)}</strong>
        </div>
        ${renderMarkdownTextArea("summary", bundle.publicSubmission.publicSummary)}
        <table class="data-table">
          <tbody>
            <tr><th>title</th><td><strong class="report-title-text">${escapeHtml(title)}</strong></td></tr>
            <tr><th>date</th><td>${escapeHtml(formatDate(bundle.publicSubmission.createdAt))}</td></tr>
            <tr><th>download</th><td><a href="${escapeHtml(
              toGatewayUrl(bundle.publicSubmission.encryptedPayloadCid)
            )}" target="_blank" rel="noreferrer">BugBundle</a></td></tr>
            <tr><th>author</th><td><a href="${authorHref}" data-nav>${escapeHtml(author.label)}</a></td></tr>
            <tr><th>report hash</th><td>${escapeHtml(bundle.publicSubmission.reportHash)}</td></tr>
            <tr><th>report id</th><td>${escapeHtml(bundle.publicSubmission.reportId)}</td></tr>
            <tr><th>reporter address</th><td>${escapeHtml(bundle.publicSubmission.reporterAddress)}</td></tr>
            <tr><th>mode</th><td>${escapeHtml(bundle.publicSubmission.disclosureMode)}</td></tr>
            <tr><th>target</th><td>${escapeHtml(target)}</td></tr>
            <tr><th>target ref hash</th><td>${escapeHtml(bundle.publicSubmission.targetRefHash)}</td></tr>
            <tr><th>content hash</th><td>${escapeHtml(bundle.publicSubmission.contentHash)}</td></tr>
            <tr><th>tags</th><td>${escapeHtml(textOrDash(bundle.publicSubmission.tags.join(", ")))}</td></tr>
          </tbody>
        </table>
      </section>

      <section class="panel">
        <div class="panel-title">[ trusted review state ]</div>
        ${reviewLoadWarning}
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
              <th>trust</th>
              <th>validity</th>
              <th>impact</th>
              <th>reward</th>
              <th>confidence</th>
              <th>note</th>
            </tr>
          </thead>
          <tbody>${reviewRows}</tbody>
        </table>
      </section>

      <section class="panel">
        <div class="panel-title">[ private details ]</div>
        ${earlyUnlockCta}
        <form id="access-key-form" class="stack-form narrow-form">
          <label>
            review access key
            <div class="inline-input">
              <input id="report-access-key" name="accessKey" type="password" value="${escapeHtml(accessKey ?? "")}" />
              <button id="reveal-access-key" type="button" class="button secondary">reveal</button>
              <button id="copy-access-key" type="button" class="button secondary">copy</button>
            </div>
          </label>
          <button class="button secondary" type="submit">unlock details</button>
        </form>
        <div class="private-view">${privateView}</div>
      </section>

      ${renderDetailUnlockModal()}

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

      bindMarkdownCodeCopy(root, {
        onCopied: () => appContext.notify("success", "Code copied."),
        onError: (message) => appContext.notify("error", message)
      });

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
      bindDetailUnlockFlow(root, appContext);

      reviewForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(reviewForm);
        try {
          const result = await appContext.runWalletAction(
            {
              title: "attest verdict",
              message: "Approve the EAS attestation transaction in your wallet. CheapBugs will wait for Base confirmation after signing."
            },
            () =>
              submitReviewVerdict(reportHash, {
                validity: String(formData.get("validity") || "unconfirmed") as never,
                impact: String(formData.get("impact") || "none") as never,
                rewardClass: String(formData.get("rewardClass") || "none") as never,
                confidence: Number(formData.get("confidence") || 0),
                note: String(formData.get("note") || "")
              })
          );

          appContext.notify("success", `Review verdict attested: ${shortHash(result.attestationUid, 14, 8)}.`);
          await appContext.rerender();
        } catch (error) {
          if (isWalletActionCancelled(error)) {
            return;
          }
          appContext.notify("error", error instanceof Error ? error.message : "Review attestation failed.");
        }
      });
    }
  };
};
