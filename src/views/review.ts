import { authController } from "../services";
import { registerSchema } from "../attest/eas";
import { chainConfig } from "../config/chains";
import { flagBugReportStatus, loadBugIndexAdminAccess } from "../contracts/bugIndex";
import { authorDisplayFromMap, loadAuthorDisplayMap } from "../lib/authors";
import { getSchemaCatalog } from "../lib/schema-overrides";
import { loadReviewQueue } from "../lib/reports";
import { reportDetailsUnlockText, reportDisplayTarget, reportDisplayTitle } from "../lib/reportDisplay";
import { escapeHtml, formatDate } from "../lib/utils";
import type { BugIndexStatus } from "../types/domain";

import type { AppViewContext, ViewResult } from "./types";

const REVIEWABLE_STATUSES: Array<Exclude<BugIndexStatus, "unreviewed">> = ["valid", "invalid", "spam"];

const isReviewableStatus = (value: string): value is Exclude<BugIndexStatus, "unreviewed"> =>
  REVIEWABLE_STATUSES.includes(value as Exclude<BugIndexStatus, "unreviewed">);

const renderSchemaRegistrationHandlers = (root: HTMLElement, appContext: AppViewContext): void => {
  root.querySelectorAll<HTMLButtonElement>("[data-register-schema]").forEach((button) => {
    button.addEventListener("click", async () => {
      const name = button.dataset.registerSchema;
      if (!name) {
        return;
      }
      try {
        const uid = await registerSchema(name as never);
        appContext.notify("success", `${name} registered as ${uid}.`);
        await appContext.rerender();
      } catch (error) {
        appContext.notify("error", error instanceof Error ? error.message : "Schema registration failed.");
      }
    });
  });
};

const statusSelect = (currentStatus: BugIndexStatus, title: string): string => `
  <select name="status" aria-label="admin status for ${escapeHtml(title)}">
    ${REVIEWABLE_STATUSES.map(
      (status) => `<option value="${status}" ${currentStatus === status ? "selected" : ""}>${status}</option>`
    ).join("")}
  </select>
`;

const flagForm = (reportHash: string, currentStatus: BugIndexStatus, title: string, disabled: boolean): string => `
  <form class="inline-action-form" data-index-flag-report="${escapeHtml(reportHash)}">
    ${statusSelect(currentStatus, title)}
    <button class="button secondary" type="submit" ${disabled ? "disabled" : ""}>flag</button>
  </form>
`;

export const renderReviewView = async (context: AppViewContext): Promise<ViewResult> => {
  const schemaRows = getSchemaCatalog()
    .map(
      (schema) => `
        <tr>
          <td>${escapeHtml(schema.name)}</td>
          <td>${escapeHtml(schema.uid || "missing")}</td>
          <td>${escapeHtml(schema.definition)}</td>
          <td><button class="button secondary" type="button" data-register-schema="${escapeHtml(schema.name)}">register</button></td>
        </tr>
      `
    )
    .join("");
  const adminAccess = await loadBugIndexAdminAccess(context.session.address);
  const canReview = context.session.isReviewer || adminAccess.isAdmin;

  if (!canReview) {
    return {
      title: "Review",
      html: `
        <section class="panel">
          <div class="panel-title">[ reviewer queue ]</div>
          <p class="warning-copy">
            Reviewer access requires either a frontend reviewer allowlist entry or onchain bug-index admin authority.
            ${adminAccess.errorMessage ? `Admin check failed: ${escapeHtml(adminAccess.errorMessage)}` : ""}
          </p>
          <p class="helper-copy">Index admins flag live reports here. The manage console remains owner-only.</p>
          <p><a href="${context.router.href("/login")}" data-nav>open /login</a></p>
        </section>

        <section class="panel">
          <div class="panel-title">[ bug index ]</div>
          <p>${escapeHtml(chainConfig.bugIndexAddress || "unset")}</p>
          <p class="helper-copy">bond vault: ${escapeHtml(chainConfig.bugBondVaultAddress)}</p>
          <p class="helper-copy">treasury vault: ${escapeHtml(chainConfig.bugTreasuryVaultAddress)}</p>
        </section>

        <section class="panel">
          <div class="panel-title">[ schema catalog ]</div>
          <table class="data-table compact-table">
            <thead><tr><th>schema</th><th>uid</th><th>definition</th><th>action</th></tr></thead>
            <tbody>${schemaRows}</tbody>
          </table>
        </section>
      `,
      afterRender: (root, appContext) => {
        renderSchemaRegistrationHandlers(root, appContext);
      }
    };
  }

  let queueError: string | null = null;
  const queue = await loadReviewQueue(15).catch((error) => {
    queueError = error instanceof Error ? error.message : "Review queue failed to load.";
    return [];
  });
  const authorDisplays = await loadAuthorDisplayMap(queue.map(({ bundle }) => bundle.publicSubmission.reporterAddress));
  const queueRows = queue.length
    ? queue
        .map(({ bundle, reviewState }) => {
          const href = context.router.href(`/report/${bundle.publicSubmission.reportHash}`);
          const author = authorDisplayFromMap(authorDisplays, bundle.publicSubmission.reporterAddress);
          const profileHref = context.router.href(`/profile/${author.address}`);
          const title = reportDisplayTitle(bundle);
          const indexStatus = bundle.publicSubmission.indexStatus ?? "unreviewed";
          return `
            <tr>
              <td>${escapeHtml(formatDate(bundle.publicSubmission.createdAt))}</td>
              <td><a href="${href}" data-nav>${escapeHtml(title)}</a></td>
              <td>${escapeHtml(reportDisplayTarget(bundle))}</td>
              <td><a href="${profileHref}" data-nav>${escapeHtml(author.label)}</a></td>
              <td>${escapeHtml(reportDetailsUnlockText(bundle))}</td>
              <td>${escapeHtml(indexStatus)}</td>
              <td>${escapeHtml(reviewState.headline?.validity ?? "pending")}</td>
              <td>${adminAccess.isAdmin ? flagForm(bundle.publicSubmission.reportHash, indexStatus, title, Boolean(bundle.publicSubmission.payoutCompleted)) : "-"}</td>
              <td>${escapeHtml(bundle.publicSubmission.publicSummary)}</td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="9" class="muted-cell">${escapeHtml(queueError ?? "No report queue items resolved yet.")}</td></tr>`;

  return {
    title: "Review Queue",
    html: `
      <section class="panel">
        <div class="panel-title">[ reviewer queue ]</div>
        <p class="lede">Connected reviewer: ${escapeHtml(authController.getSession().address ?? "-")}</p>
        <p class="helper-copy">
          ${adminAccess.isAdmin ? "Index admin access recognized. You can flag report status for ordered payouts." : "Frontend reviewer access recognized. Onchain status flagging requires index admin authority."}
          ${adminAccess.errorMessage ? `Admin check warning: ${escapeHtml(adminAccess.errorMessage)}` : ""}
        </p>
        <p class="helper-copy">bug index: ${escapeHtml(chainConfig.bugIndexAddress || "unset")}</p>
        <p class="helper-copy">bond vault: ${escapeHtml(chainConfig.bugBondVaultAddress)}</p>
        <p class="helper-copy">treasury vault: ${escapeHtml(chainConfig.bugTreasuryVaultAddress)}</p>
        <div id="review-admin-status" class="action-status" role="status" aria-live="polite"></div>
        <table class="data-table">
          <thead>
            <tr>
              <th>date</th>
              <th>title</th>
              <th>target</th>
              <th>author</th>
              <th>details</th>
              <th>index status</th>
              <th>trusted state</th>
              <th>admin flag</th>
              <th>summary</th>
            </tr>
          </thead>
          <tbody>${queueRows}</tbody>
        </table>
      </section>

      <section class="panel">
        <div class="panel-title">[ schema catalog ]</div>
        <table class="data-table compact-table">
          <thead><tr><th>schema</th><th>uid</th><th>definition</th><th>action</th></tr></thead>
          <tbody>${schemaRows}</tbody>
        </table>
      </section>
    `,
    afterRender: (root, appContext) => {
      renderSchemaRegistrationHandlers(root, appContext);
      const status = root.querySelector<HTMLElement>("#review-admin-status");
      root.querySelectorAll<HTMLFormElement>("[data-index-flag-report]").forEach((form) => {
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const reportHash = form.dataset.indexFlagReport as `0x${string}` | undefined;
          const selectedStatus = new FormData(form).get("status");
          if (!reportHash || typeof selectedStatus !== "string" || !isReviewableStatus(selectedStatus)) {
            return;
          }
          const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-index-flag-report] button"));
          buttons.forEach((button) => {
            button.disabled = true;
          });
          if (status) {
            status.textContent = `Flagging ${reportHash.slice(0, 10)} as ${selectedStatus}...`;
          }
          try {
            const txHash = await flagBugReportStatus(reportHash, selectedStatus);
            appContext.notify("success", `Report flagged as ${selectedStatus}: ${txHash}`);
            await appContext.rerender();
          } catch (error) {
            const message = error instanceof Error ? error.message : "Report status flag failed.";
            if (status) {
              status.textContent = message;
            }
            appContext.notify("error", message);
          } finally {
            buttons.forEach((button) => {
              button.disabled = false;
            });
          }
        });
      });
    }
  };
};
