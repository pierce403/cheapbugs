import { getSchemaCatalog } from "../lib/schema-overrides";
import { loadAuthorDisplay } from "../lib/authors";
import { computeReviewDisplayState } from "../lib/eas";
import { decryptPrivateSubmission, getStoredAccessKey, loadReviewVerdicts, loadSubmissionBundle, submitReviewVerdict } from "../lib/reports";
import { saveReportAccessKey } from "../lib/report-access";
import { toGatewayUrl } from "../lib/ipfs";
import { reportDisplayTarget, reportDisplayTitle } from "../lib/reportDisplay";
import { chainConfig } from "../config/chains";
import { approveTreasuryForDetailKeyPayment, purchaseDetailKey } from "../contracts/treasuryVault";
import { authController } from "../services";
import { confirmDetailUnlockPayment, requestDetailUnlockQuote } from "../xmtp/broker";
import { escapeHtml, formatDate, formatTokenAmount, newlineToBreaks, shortHash, textOrDash } from "../lib/utils";

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

  const title = reportDisplayTitle(bundle);
  const target = reportDisplayTarget(bundle);
  const author = await loadAuthorDisplay(bundle.publicSubmission.reporterAddress);
  const authorHref = context.router.href(`/profile/${author.address}`);
  const reviews = await loadReviewVerdicts(reportHash);
  const reviewState = computeReviewDisplayState(reviews);
  const accessKey = getStoredAccessKey(reportHash);
  const revealAt = bundle.publicSubmission.revealAfter ? Date.parse(bundle.publicSubmission.revealAfter) : NaN;
  const canBuyEarlyDetails =
    !accessKey &&
    !bundle.publicSubmission.detailsKeyRevealed &&
    Number.isFinite(revealAt) &&
    revealAt > Date.now();
  let privateView = `<p class="muted-copy">Private dossier locked. Paste the review access key to decrypt client-side.</p>`;
  const earlyUnlockCta = canBuyEarlyDetails
    ? `
      <button id="buy-detail-unlock" type="button" class="button secondary lock-action">
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
        <table class="data-table">
          <tbody>
            <tr><th>bug type</th><td>${escapeHtml(textOrDash(privateSubmission.bugType))}</td></tr>
            <tr><th>severity</th><td>${escapeHtml(textOrDash(privateSubmission.severity))}</td></tr>
            <tr><th>target interest</th><td>${escapeHtml(textOrDash(privateSubmission.targetInterest))}</td></tr>
            <tr><th>title</th><td>${escapeHtml(privateSubmission.title)}</td></tr>
            <tr><th>private details</th><td>${newlineToBreaks(privateSubmission.details)}</td></tr>
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
    title,
    html: `
      <section class="panel">
        <div class="panel-title">[ ${escapeHtml(title)} ]</div>
        ${bugIndexWarning}
        ${schemaWarning}
        <table class="data-table">
          <tbody>
            <tr><th>title</th><td>${escapeHtml(title)}</td></tr>
            <tr><th>date</th><td>${escapeHtml(formatDate(bundle.publicSubmission.createdAt))}</td></tr>
            <tr><th>description</th><td>${newlineToBreaks(bundle.publicSubmission.publicSummary)}</td></tr>
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
            <tr><th>bug index</th><td>${escapeHtml(chainConfig.bugIndexAddress || "unset")}</td></tr>
            <tr><th>bond vault</th><td>${escapeHtml(chainConfig.bugBondVaultAddress)}</td></tr>
            <tr><th>treasury vault</th><td>${escapeHtml(chainConfig.bugTreasuryVaultAddress)}</td></tr>
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
          <button class="button secondary" type="submit">unlock dossier</button>
        </form>
        <div class="private-view">${privateView}</div>
      </section>

      <div id="detail-unlock-modal" class="processing-modal-backdrop" hidden>
        <div class="panel processing-modal detail-unlock-modal">
          <div class="signature-spinner" aria-hidden="true"></div>
          <div class="signature-modal-copy">
            <strong id="detail-unlock-title">detail unlock</strong>
            <p id="detail-unlock-status">waiting for broker quote.</p>
            <div id="detail-unlock-actions" class="modal-actions"></div>
          </div>
        </div>
      </div>

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
      const unlockButton = root.querySelector<HTMLButtonElement>("#buy-detail-unlock");
      const unlockModal = root.querySelector<HTMLDivElement>("#detail-unlock-modal");
      const unlockTitle = root.querySelector<HTMLElement>("#detail-unlock-title");
      const unlockStatus = root.querySelector<HTMLElement>("#detail-unlock-status");
      const unlockActions = root.querySelector<HTMLDivElement>("#detail-unlock-actions");
      const reviewForm = root.querySelector<HTMLFormElement>("#review-form");

      const setUnlockStatus = (title: string, message: string): void => {
        if (unlockTitle) {
          unlockTitle.textContent = title;
        }
        if (unlockStatus) {
          unlockStatus.textContent = message;
        }
      };

      const setUnlockActions = (html: string): void => {
        if (unlockActions) {
          unlockActions.innerHTML = html;
        }
      };

      const closeUnlockModal = (): void => {
        unlockModal?.setAttribute("hidden", "");
        setUnlockActions("");
      };

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

      unlockButton?.addEventListener("click", async () => {
        const identity = authController.getXmtpIdentity();
        const buyer = appContext.session.address;
        if (!buyer || !identity) {
          appContext.notify("info", "Connect a wallet before buying detail access.");
          appContext.openWalletOnboarding();
          return;
        }
        if (identity.address.toLowerCase() !== buyer.toLowerCase()) {
          appContext.notify("error", "XMTP identity does not match the connected wallet.");
          return;
        }

        unlockModal?.removeAttribute("hidden");
        setUnlockActions("");
        setUnlockStatus("detail unlock", "asking the broker for a report-specific price.");
        try {
          const quote = await requestDetailUnlockQuote(identity, reportHash, (message) =>
            setUnlockStatus("detail unlock", message)
          );
          const priceLabel = `${formatTokenAmount(quote.priceWei, 18)} BUGZ`;
          setUnlockStatus(
            "detail unlock quote",
            `${priceLabel} for ${quote.daysRemaining} day${quote.daysRemaining === 1 ? "" : "s"} of early access.`
          );
          setUnlockActions(`
            <button id="confirm-detail-unlock" class="button" type="button">yes, pay ${escapeHtml(priceLabel)}</button>
            <button id="cancel-detail-unlock" class="button secondary" type="button">cancel</button>
          `);
          root.querySelector<HTMLButtonElement>("#cancel-detail-unlock")?.addEventListener("click", closeUnlockModal);
          root.querySelector<HTMLButtonElement>("#confirm-detail-unlock")?.addEventListener("click", async () => {
            const confirmButton = root.querySelector<HTMLButtonElement>("#confirm-detail-unlock");
            if (confirmButton) {
              confirmButton.disabled = true;
            }
            setUnlockActions("");
            try {
              setUnlockStatus("approving BUGZ", "checking treasury allowance.");
              await approveTreasuryForDetailKeyPayment(quote.priceWei);
              setUnlockStatus("paying treasury", "sending the detail-key payment to the treasury vault.");
              const payment = await purchaseDetailKey(reportHash, quote.priceWei);
              setUnlockStatus("verifying payment", `payment confirmed: ${shortHash(payment.txHash, 12, 8)}. Asking broker for key.`);
              const key = await confirmDetailUnlockPayment(
                identity,
                {
                  reportHash,
                  requestId: quote.requestId,
                  txHash: payment.txHash
                },
                (message) => setUnlockStatus("broker verification", message)
              );
              saveReportAccessKey(reportHash, key.detailsKey);
              appContext.notify("success", "Detail key saved locally for this report.");
              closeUnlockModal();
              await appContext.rerender();
            } catch (error) {
              setUnlockStatus("detail unlock failed", error instanceof Error ? error.message : "Detail unlock failed.");
              setUnlockActions(`<button id="close-detail-unlock" class="button secondary" type="button">close</button>`);
              root.querySelector<HTMLButtonElement>("#close-detail-unlock")?.addEventListener("click", closeUnlockModal);
            }
          });
        } catch (error) {
          setUnlockStatus("detail unlock failed", error instanceof Error ? error.message : "Broker quote failed.");
          setUnlockActions(`<button id="close-detail-unlock" class="button secondary" type="button">close</button>`);
          root.querySelector<HTMLButtonElement>("#close-detail-unlock")?.addEventListener("click", closeUnlockModal);
        }
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
