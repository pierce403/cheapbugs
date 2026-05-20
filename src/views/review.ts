import { flagBugReportStatus, loadBugIndexAdminAccess } from "../contracts/bugIndex";
import { authorDisplayFromMap, loadAuthorDisplayMap } from "../lib/authors";
import { loadRecentBundles } from "../lib/reports";
import { reportDetailsUnlockText, reportDisplayTitle } from "../lib/reportDisplay";
import { escapeHtml, formatDate } from "../lib/utils";
import type { BugIndexStatus } from "../types/domain";

import type { AppViewContext, ViewResult } from "./types";

const REVIEWABLE_STATUSES: Array<Exclude<BugIndexStatus, "unreviewed">> = ["valid", "invalid", "spam"];
const PENDING_ONLY_STORAGE_KEY = "cheapbugs.review.pendingOnly.v1";

const isReviewableStatus = (value: string): value is Exclude<BugIndexStatus, "unreviewed"> =>
  REVIEWABLE_STATUSES.includes(value as Exclude<BugIndexStatus, "unreviewed">);

const isPendingOnlyFilterEnabled = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(PENDING_ONLY_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

const setPendingOnlyFilterEnabled = (enabled: boolean): void => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (enabled) {
      window.localStorage.setItem(PENDING_ONLY_STORAGE_KEY, "1");
    } else {
      window.localStorage.removeItem(PENDING_ONLY_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures; the checkbox still works for the current render.
  }
};

const statusSelect = (currentStatus: BugIndexStatus, title: string): string => `
  <select name="status" aria-label="admin status for ${escapeHtml(title)}">
    <option value="unreviewed" ${currentStatus === "unreviewed" ? "selected" : ""} disabled>pending</option>
    ${REVIEWABLE_STATUSES.map(
      (status) => `<option value="${status}" ${currentStatus === status ? "selected" : ""}>${status}</option>`
    ).join("")}
  </select>
`;

const flagForm = (reportHash: string, currentStatus: BugIndexStatus, title: string, disabled: boolean): string => `
  <form class="inline-action-form" data-index-flag-report="${escapeHtml(reportHash)}">
    ${statusSelect(currentStatus, title)}
    <button class="button secondary" type="submit" ${disabled ? "disabled" : ""}>set</button>
  </form>
`;

const statusCell = (adminAccess: boolean, reportHash: string, currentStatus: BugIndexStatus, title: string, payoutCompleted: boolean): string => {
  if (adminAccess) {
    return flagForm(reportHash, currentStatus, title, payoutCompleted);
  }

  return currentStatus === "unreviewed" ? "pending" : currentStatus;
};

export const renderReviewView = async (context: AppViewContext): Promise<ViewResult> => {
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
          <p><a href="${context.router.href("/login")}" data-nav>open /login</a></p>
        </section>
      `
    };
  }

  let queueError: string | null = null;
  const queue = await loadRecentBundles(15).catch((error) => {
    queueError = error instanceof Error ? error.message : "Review queue failed to load.";
    return [];
  });
  const pendingOnly = isPendingOnlyFilterEnabled();
  const visibleQueue = pendingOnly
    ? queue.filter((bundle) => (bundle.publicSubmission.indexStatus ?? "unreviewed") === "unreviewed")
    : queue;
  const authorDisplays = await loadAuthorDisplayMap(visibleQueue.map((bundle) => bundle.publicSubmission.reporterAddress));
  const emptyMessage = queueError ?? (pendingOnly ? "No pending report queue items resolved yet." : "No report queue items resolved yet.");
  const queueRows = visibleQueue.length
    ? visibleQueue
        .map((bundle) => {
          const href = context.router.href(`/report/${bundle.publicSubmission.reportHash}`);
          const author = authorDisplayFromMap(authorDisplays, bundle.publicSubmission.reporterAddress);
          const profileHref = context.router.href(`/profile/${author.address}`);
          const title = reportDisplayTitle(bundle);
          const indexStatus = bundle.publicSubmission.indexStatus ?? "unreviewed";
          return `
            <tr>
              <td>${escapeHtml(formatDate(bundle.publicSubmission.createdAt))}</td>
              <td><a href="${href}" data-nav>${escapeHtml(title)}</a></td>
              <td><a href="${profileHref}" data-nav>${escapeHtml(author.label)}</a></td>
              <td>${escapeHtml(reportDetailsUnlockText(bundle))}</td>
              <td>${statusCell(adminAccess.isAdmin, bundle.publicSubmission.reportHash, indexStatus, title, Boolean(bundle.publicSubmission.payoutCompleted))}</td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="5" class="muted-cell">${escapeHtml(emptyMessage)}</td></tr>`;

  return {
    title: "Review Queue",
    html: `
      <section class="panel">
        <div class="panel-title">[ reviewer queue ]</div>
        <div id="review-admin-status" class="action-status" role="status" aria-live="polite"></div>
        <label class="inline-checkbox">
          <input id="review-pending-only" type="checkbox" ${pendingOnly ? "checked" : ""} />
          only show pending
        </label>
        <table class="data-table review-queue-table">
          <thead>
            <tr>
              <th>date</th>
              <th>title</th>
              <th>author</th>
              <th>details</th>
              <th>admin flag</th>
            </tr>
          </thead>
          <tbody>${queueRows}</tbody>
        </table>
      </section>
    `,
    afterRender: (root, appContext) => {
      const pendingOnlyToggle = root.querySelector<HTMLInputElement>("#review-pending-only");
      pendingOnlyToggle?.addEventListener("change", async () => {
        setPendingOnlyFilterEnabled(pendingOnlyToggle.checked);
        await appContext.rerender();
      });
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
