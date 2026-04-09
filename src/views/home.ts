import { loadRecentBundles } from "../lib/reports";
import { loadPatronLeaderboard } from "../lib/token";
import { chainConfig } from "../config/chains";
import { getFeaturedReportHashes } from "../lib/eas";
import { escapeHtml, formatDate, formatTokenAmount, shortHash, textOrDash } from "../lib/utils";

import type { AppViewContext, ViewResult } from "./types";

export const renderHomeView = async (context: AppViewContext): Promise<ViewResult> => {
  const bundles = await loadRecentBundles(12);
  const patronPreview = await loadPatronLeaderboard(3);
  const featuredHashes = new Set(getFeaturedReportHashes());
  const featured = bundles.filter((bundle) => featuredHashes.has(bundle.publicSubmission.reportHash));
  const featuredBundles = featured.length ? featured : bundles.slice(0, 4);

  const featuredRows = featuredBundles.length
    ? featuredBundles
        .map((bundle) => {
          const href = context.router.href(`/report/${bundle.publicSubmission.reportHash}`);
          return `
            <tr>
              <td><a href="${href}" data-nav>${escapeHtml(bundle.publicSubmission.reportId)}</a></td>
              <td>${escapeHtml(bundle.publicSubmission.targetKind)}</td>
              <td>${escapeHtml(bundle.publicSubmission.disclosureMode)}</td>
              <td>${escapeHtml(textOrDash(bundle.publicSubmission.tags.join(", ")))}</td>
              <td>${escapeHtml(bundle.publicSubmission.publicSummary)}</td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="5" class="muted-cell">No featured items configured yet.</td></tr>`;

  const recentRows = bundles.length
    ? bundles
        .map((bundle) => {
          const href = context.router.href(`/report/${bundle.publicSubmission.reportHash}`);
          return `
            <tr>
              <td><a href="${href}" data-nav>${escapeHtml(bundle.publicSubmission.reportId)}</a></td>
              <td>${escapeHtml(shortHash(bundle.publicSubmission.reporterAddress))}</td>
              <td>${escapeHtml(formatDate(bundle.publicSubmission.createdAt))}</td>
              <td>${escapeHtml(bundle.publicSubmission.disclosureMode)}</td>
              <td>${escapeHtml(bundle.publicSubmission.targetKind)}</td>
              <td>${escapeHtml(bundle.publicSubmission.publicSummary)}</td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="6" class="muted-cell">No onchain bug reports resolved yet.</td></tr>`;

  const patronRows = patronPreview.entries.length
    ? patronPreview.entries
        .map(
          (entry, index) => `
            <tr>
              <td>${escapeHtml(String(index + 1).padStart(2, "0"))}</td>
              <td>${entry.ensName ? escapeHtml(entry.ensName) : escapeHtml(shortHash(entry.address, 12, 6))}</td>
              <td>${escapeHtml(formatTokenAmount(entry.balance))} BUGZ</td>
              <td>${escapeHtml(entry.ensLookupStatus)}</td>
            </tr>
          `
        )
        .join("")
    : `
      <tr><td>01</td><td><a href="${context.router.href("/token")}" data-nav>token manager</a></td><td>-</td><td>deploy BUGZ first</td></tr>
      <tr><td>02</td><td><a href="${context.router.href("/patrons")}" data-nav>patrons board</a></td><td>-</td><td>holder scan later</td></tr>
      <tr><td>03</td><td>ens preferred</td><td>-</td><td>leaderboard placeholder</td></tr>
    `;

  return {
    title: "CheapBugs",
    html: `
      <section class="panel intro-panel">
        <div class="panel-title">[ recent exploit archive ]</div>
        <p class="lede">
          CheapBugs is a static Base-native report board. Public report metadata is filed onchain through the bug index contract,
          reviewer verdicts live on EAS, and private dossier material is encrypted client-side before upload.
        </p>
        ${
          chainConfig.bugIndexAddress
            ? `<p class="helper-copy">bug index: ${escapeHtml(chainConfig.bugIndexAddress)}</p>`
            : `<p class="warning-copy">bug index contract address is not configured yet. Public onchain browsing will stay empty until deployment.</p>`
        }
      </section>

      <section class="panel">
        <div class="panel-title">[ featured items ]</div>
        <table class="data-table">
          <thead>
            <tr>
              <th>report</th>
              <th>target</th>
              <th>mode</th>
              <th>tags</th>
              <th>summary</th>
            </tr>
          </thead>
          <tbody>${featuredRows}</tbody>
        </table>
      </section>

      <section class="panel">
        <div class="panel-title">[ recent reports ]</div>
        <table class="data-table">
          <thead>
            <tr>
              <th>id</th>
              <th>reporter</th>
              <th>created</th>
              <th>mode</th>
              <th>target</th>
              <th>public summary</th>
            </tr>
          </thead>
          <tbody>${recentRows}</tbody>
        </table>
      </section>

      <section class="panel">
        <div class="panel-title">[ patrons of the arts ]</div>
        <table class="data-table compact-table">
          <thead>
            <tr>
              <th>rank</th>
              <th>handle</th>
              <th>holdings</th>
              <th>status</th>
            </tr>
          </thead>
          <tbody>${patronRows}</tbody>
        </table>
      </section>
    `
  };
};
