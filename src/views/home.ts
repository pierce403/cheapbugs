import { getStoredAccessKey, loadRecentBundles } from "../lib/reports";
import { authorDisplayFromMap, loadAuthorDisplayMap } from "../lib/authors";
import {
  loadBugVoteStates,
  NoBondVotingPowerError,
  submitBugBondVote,
  type BugVoteState
} from "../contracts/bugIndex";
import { getFeaturedReportHashes } from "../lib/eas";
import { reportDetailsUnlockText, reportDisplayTitle } from "../lib/reportDisplay";
import { escapeHtml, formatDate } from "../lib/utils";

import { bindDetailUnlockFlow, renderDetailUnlockModal } from "./detailUnlock";
import type { AppViewContext, ViewResult } from "./types";

export const renderHomeView = async (context: AppViewContext): Promise<ViewResult> => {
  const bundles = await loadRecentBundles(12);
  const featuredHashes = new Set(getFeaturedReportHashes());
  const featured = bundles.filter((bundle) => featuredHashes.has(bundle.publicSubmission.reportHash));
  const featuredBundles = featured.length ? featured : bundles.slice(0, 4);
  const authorDisplays = await loadAuthorDisplayMap(bundles.map((bundle) => bundle.publicSubmission.reporterAddress));
  const reportHashes = bundles.map((bundle) => bundle.publicSubmission.reportHash);
  const voteStates = await loadBugVoteStates(reportHashes, context.session.address);

  const renderVoteControl = (voteState: BugVoteState, voteClosed: boolean, label: string): string => {
    const upSelected = voteState.voterSupport === true ? " is-selected" : "";
    const downSelected = voteState.voterSupport === false ? " is-selected" : "";
    const disabled = voteClosed ? " disabled" : "";
    const closedTitle = voteClosed ? " Voting is closed for this report." : "";
    const escapedLabel = escapeHtml(label);

    return `
      <span class="bug-vote-control" data-report-vote-control="${voteState.reportHash}" aria-label="bonded votes for ${escapedLabel}">
        <button
          class="bug-vote-button bug-vote-up${upSelected}"
          type="button"
          data-report-vote="${voteState.reportHash}"
          data-vote-support="true"
          title="total upvote weight: ${voteState.upWeight.toString()}${closedTitle}"
          aria-label="upvote ${escapedLabel}; total upvote weight ${voteState.upWeight.toString()}"
          ${disabled}
        >▲</button>
        <span class="bug-vote-score" title="net bonded vote weight">${voteState.score.toString()}</span>
        <button
          class="bug-vote-button bug-vote-down${downSelected}"
          type="button"
          data-report-vote="${voteState.reportHash}"
          data-vote-support="false"
          title="total downvote weight: ${voteState.downWeight.toString()}${closedTitle}"
          aria-label="downvote ${escapedLabel}; total downvote weight ${voteState.downWeight.toString()}"
          ${disabled}
        >▼</button>
      </span>
    `;
  };

  const renderUnlockCell = (bundle: (typeof bundles)[number], title: string): string => {
    const revealAt = bundle.publicSubmission.revealAfter ? Date.parse(bundle.publicSubmission.revealAfter) : null;
    const isLocked =
      !getStoredAccessKey(bundle.publicSubmission.reportHash) &&
      !bundle.publicSubmission.detailsKeyRevealed &&
      revealAt !== null &&
      !Number.isNaN(revealAt) &&
      revealAt > Date.now();
    const lockButton = isLocked
      ? `
        <button
          class="unlock-lock-button"
          type="button"
          data-detail-unlock-report="${bundle.publicSubmission.reportHash}"
          title="buy early access"
          aria-label="buy early access to ${escapeHtml(title)}"
        >
          <span class="lock-icon" aria-hidden="true"></span>
        </button>
      `
      : "";

    return `
      <span class="unlock-cell-inner">
        <span>${escapeHtml(reportDetailsUnlockText(bundle))}</span>
        ${lockButton}
      </span>
    `;
  };

  const renderBugListingRow = (bundle: (typeof bundles)[number]): string => {
    const href = context.router.href(`/report/${bundle.publicSubmission.reportHash}`);
    const author = authorDisplayFromMap(authorDisplays, bundle.publicSubmission.reporterAddress);
    const profileHref = context.router.href(`/profile/${author.address}`);
    const title = reportDisplayTitle(bundle);
    const voteState =
      voteStates.get(bundle.publicSubmission.reportHash) ??
      ({
        reportHash: bundle.publicSubmission.reportHash,
        upWeight: 0n,
        downWeight: 0n,
        score: 0n,
        voterSupport: null,
        voterWeight: 0
      } satisfies BugVoteState);
    const revealAt = bundle.publicSubmission.revealAfter ? Date.parse(bundle.publicSubmission.revealAfter) : null;
    const voteClosed =
      bundle.publicSubmission.detailsKeyRevealed || (revealAt !== null && !Number.isNaN(revealAt) && revealAt <= Date.now());

    return `
      <tr>
        <td class="score-column">${renderVoteControl(voteState, voteClosed, title)}</td>
        <td class="title-column">
          <a href="${href}" data-nav>${escapeHtml(title)}</a>
        </td>
        <td><a href="${profileHref}" data-nav>${escapeHtml(author.label)}</a></td>
        <td class="date-column">${escapeHtml(formatDate(bundle.publicSubmission.createdAt))}</td>
        <td class="unlock-column">${renderUnlockCell(bundle, title)}</td>
      </tr>
    `;
  };

  const featuredRows = featuredBundles.length
    ? featuredBundles.map(renderBugListingRow).join("")
    : `<tr><td colspan="5" class="muted-cell">No featured items configured yet.</td></tr>`;

  const recentRows = bundles.length
    ? bundles.map(renderBugListingRow).join("")
    : `<tr><td colspan="5" class="muted-cell">No onchain bug reports resolved yet.</td></tr>`;
  const bugListingColumns = `
    <colgroup>
      <col class="score-col" />
      <col class="title-col" />
      <col class="author-col" />
      <col class="date-col" />
      <col class="unlock-col" />
    </colgroup>
  `;

  return {
    title: "CheapBugs",
    html: `
      <section class="panel intro-panel">
        <div class="intro-copy">
          <div class="panel-title">[ recent exploit archive ]</div>
          <p class="lede">
            CheapBugs is a public goods crowdfunding protocol designed to accelerate the identification and elimination
            of bugs in the global software ecosystem. Participation is generally open at the moment, but may eventually
            require some level of community bond to mitigate abuse. The protocol is designed to be sufficiently
            decentralized. This frontend is static HTML on GitHub. Bug data is stored on IPFS, communications happen over
            XMTP, and execution and payouts happen on the Base network. The community is encouraged to expand the
            ecosystem using any tools available, including generative AI tooling. Enjoy!
          </p>
        </div>
        <img class="intro-art" src="/cheapbugs.png" alt="CheapBugs bug artwork" />
      </section>

      <section class="panel">
        <div class="panel-title">[ featured items ]</div>
        <table class="data-table bug-listing-table">
          ${bugListingColumns}
          <thead>
            <tr>
              <th>score</th>
              <th>title</th>
              <th>author</th>
              <th>date</th>
              <th>unlock</th>
            </tr>
          </thead>
          <tbody>${featuredRows}</tbody>
        </table>
      </section>

      <section class="panel">
        <div class="panel-title">[ recent reports ]</div>
        <table class="data-table bug-listing-table">
          ${bugListingColumns}
          <thead>
            <tr>
              <th>score</th>
              <th>title</th>
              <th>author</th>
              <th>date</th>
              <th>unlock</th>
            </tr>
          </thead>
          <tbody>${recentRows}</tbody>
        </table>
      </section>
      <div id="vote-level-modal" class="processing-modal-backdrop" hidden role="dialog" aria-modal="true" aria-labelledby="vote-level-title">
        <div class="panel processing-modal is-complete vote-level-modal">
          <div class="signature-modal-copy">
            <strong id="vote-level-title">bond required</strong>
            <p>Voting requires bonded BUGZ. Bond BUGZ to level up before voting on bug reports.</p>
            <div class="modal-actions">
              <button id="vote-level-stake" class="button" type="button">go to bond</button>
              <button id="vote-level-close" class="button secondary" type="button">close</button>
            </div>
          </div>
        </div>
      </div>
      ${renderDetailUnlockModal()}
    `,
    afterRender: (root, viewContext) => {
      const levelModal = root.querySelector<HTMLDivElement>("#vote-level-modal");
      const closeLevelModal = () => {
        if (levelModal) {
          levelModal.hidden = true;
        }
      };
      const showLevelModal = () => {
        if (levelModal) {
          levelModal.hidden = false;
        }
      };

      root.querySelector<HTMLButtonElement>("#vote-level-close")?.addEventListener("click", closeLevelModal);
      levelModal?.addEventListener("click", (event) => {
        if (event.target === levelModal) {
          closeLevelModal();
        }
      });
      root.querySelector<HTMLButtonElement>("#vote-level-stake")?.addEventListener("click", () => {
        closeLevelModal();
        viewContext.router.navigate("/stake");
      });

      root.querySelectorAll<HTMLButtonElement>("[data-report-vote]").forEach((button) => {
        button.addEventListener("click", async () => {
          const reportHash = button.dataset.reportVote as `0x${string}` | undefined;
          const support = button.dataset.voteSupport === "true";
          if (!reportHash) {
            return;
          }

          if (!viewContext.session.address) {
            viewContext.notify("info", "Connect a wallet before voting.");
            viewContext.openWalletOnboarding();
            return;
          }

          const siblingButtons = root.querySelectorAll<HTMLButtonElement>(`[data-report-vote="${reportHash}"]`);
          siblingButtons.forEach((entry) => {
            entry.disabled = true;
          });

          try {
            await submitBugBondVote(reportHash, support);
            viewContext.notify("success", support ? "Upvote recorded." : "Downvote recorded.");
            await viewContext.rerender();
          } catch (error) {
            if (error instanceof NoBondVotingPowerError) {
              showLevelModal();
            } else {
              const message = error instanceof Error ? error.message : String(error);
              viewContext.notify("error", message);
            }
            siblingButtons.forEach((entry) => {
              entry.disabled = false;
            });
          }
        });
      });
      bindDetailUnlockFlow(root, viewContext);
    }
  };
};
