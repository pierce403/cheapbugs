import { loadRecentBundles } from "../lib/reports";
import { authorDisplayFromMap, loadAuthorDisplayMap } from "../lib/authors";
import { getFeaturedReportHashes } from "../lib/eas";
import { reportDetailsUnlockText, reportDisplayTarget, reportDisplayTitle } from "../lib/reportDisplay";
import { escapeHtml, formatDate } from "../lib/utils";

import type { AppViewContext, ViewResult } from "./types";

export const renderHomeView = async (context: AppViewContext): Promise<ViewResult> => {
  const bundles = await loadRecentBundles(12);
  const featuredHashes = new Set(getFeaturedReportHashes());
  const featured = bundles.filter((bundle) => featuredHashes.has(bundle.publicSubmission.reportHash));
  const featuredBundles = featured.length ? featured : bundles.slice(0, 4);
  const authorDisplays = await loadAuthorDisplayMap(bundles.map((bundle) => bundle.publicSubmission.reporterAddress));

  const renderBugListingRow = (bundle: (typeof bundles)[number]): string => {
    const href = context.router.href(`/report/${bundle.publicSubmission.reportHash}`);
    const author = authorDisplayFromMap(authorDisplays, bundle.publicSubmission.reporterAddress);
    const profileHref = context.router.href(`/profile/${author.address}`);
    return `
      <tr>
        <td>${escapeHtml(formatDate(bundle.publicSubmission.createdAt))}</td>
        <td><a href="${href}" data-nav>${escapeHtml(reportDisplayTitle(bundle))}</a></td>
        <td>${escapeHtml(reportDisplayTarget(bundle))}</td>
        <td><a href="${profileHref}" data-nav>${escapeHtml(author.label)}</a></td>
        <td>${escapeHtml(reportDetailsUnlockText(bundle))}</td>
      </tr>
    `;
  };

  const featuredRows = featuredBundles.length
    ? featuredBundles.map(renderBugListingRow).join("")
    : `<tr><td colspan="5" class="muted-cell">No featured items configured yet.</td></tr>`;

  const recentRows = bundles.length
    ? bundles.map(renderBugListingRow).join("")
    : `<tr><td colspan="5" class="muted-cell">No onchain bug reports resolved yet.</td></tr>`;

  return {
    title: "CheapBugs",
    html: `
      <section class="panel intro-panel">
        <div class="intro-copy">
          <div class="panel-title">[ recent exploit archive ]</div>
          <p class="lede">
            CheapBugs is a public goods crowdfunding protocol designed to accelerate the identification and elimination
            of bugs in the global software ecosystem. Participation is generally open at the moment, but may eventually
            require some level of community stake to mitigate abuse. The protocol is designed to be sufficiently
            decentralized. This frontend is static HTML on GitHub. Bug data is stored on IPFS, communications happen over
            XMTP, and execution and payouts happen on the Base network. The community is encouraged to expand the
            ecosystem using any tools available, including generative AI tooling. Enjoy!
          </p>
        </div>
        <img class="intro-art" src="/cheapbugs.png" alt="CheapBugs bug artwork" />
      </section>

      <section class="panel">
        <div class="panel-title">[ featured items ]</div>
        <table class="data-table">
          <thead>
            <tr>
              <th>date</th>
              <th>title</th>
              <th>target</th>
              <th>author</th>
              <th>details</th>
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
              <th>date</th>
              <th>title</th>
              <th>target</th>
              <th>author</th>
              <th>details</th>
            </tr>
          </thead>
          <tbody>${recentRows}</tbody>
        </table>
      </section>
    `
  };
};
