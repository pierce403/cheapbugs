import { getAddress, isAddress } from "ethers";

import { loadAuthorDisplay } from "../lib/authors";
import { loadRecentBundles } from "../lib/reports";
import { reportDetailsUnlockText, reportDisplayTarget, reportDisplayTitle } from "../lib/reportDisplay";
import { loadBugzAddressBalance } from "../lib/token";
import { escapeHtml, formatDate, formatTokenAmount, normalizeAddress, shortHash } from "../lib/utils";

import type { AppViewContext, ViewResult } from "./types";

const renderProfileAvatar = (label: string, avatarUrl: string | null): string => {
  if (avatarUrl) {
    return `<img class="profile-page-avatar" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(label)} avatar" referrerpolicy="no-referrer" />`;
  }

  return `<div class="profile-page-avatar identity-avatar-fallback">${escapeHtml(label.slice(0, 1).toUpperCase())}</div>`;
};

export const renderProfileView = async (context: AppViewContext): Promise<ViewResult> => {
  const rawAddress = context.route.params.address ?? "";

  if (!isAddress(rawAddress)) {
    return {
      title: "Profile Not Found",
      html: `
        <section class="panel">
          <div class="panel-title">[ profile ]</div>
          <p class="warning-copy">That profile address is not a valid EVM address.</p>
        </section>
      `
    };
  }

  const checksumAddress = getAddress(rawAddress) as `0x${string}`;
  const normalizedAddress = normalizeAddress(checksumAddress);
  const [author, bugzBalance, recentBundles] = await Promise.all([
    loadAuthorDisplay(normalizedAddress),
    loadBugzAddressBalance(normalizedAddress),
    loadRecentBundles(100)
  ]);
  const submissions = recentBundles.filter(
    (bundle) => normalizeAddress(bundle.publicSubmission.reporterAddress) === normalizedAddress
  );
  const primary = author.ensName ?? shortHash(checksumAddress, 14, 6);
  const bugzText =
    bugzBalance.connectedBalance !== null
      ? `${formatTokenAmount(bugzBalance.connectedBalance, bugzBalance.decimals)} ${bugzBalance.symbol}`
      : "unavailable";
  const ensStatus =
    author.ensLookupStatus === "resolved"
      ? "resolved"
      : author.ensLookupStatus === "missing"
        ? "not registered"
        : author.ensLookupStatus === "error"
          ? "lookup unavailable"
          : author.ensLookupStatus;
  const submissionRows = submissions.length
    ? submissions
        .map((bundle) => {
          const href = context.router.href(`/report/${bundle.publicSubmission.reportHash}`);
          return `
            <tr>
              <td>${escapeHtml(formatDate(bundle.publicSubmission.createdAt))}</td>
              <td><a href="${href}" data-nav>${escapeHtml(reportDisplayTitle(bundle))}</a></td>
              <td>${escapeHtml(reportDisplayTarget(bundle))}</td>
              <td>${escapeHtml(primary)}</td>
              <td>${escapeHtml(reportDetailsUnlockText(bundle))}</td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="5" class="muted-cell">No recent submissions found for this address.</td></tr>`;

  return {
    title: primary,
    html: `
      <section class="panel profile-page-panel">
        <div class="profile-page-header">
          ${renderProfileAvatar(primary, author.ensAvatarUrl)}
          <div class="profile-page-copy">
            <div class="panel-title">[ author profile ]</div>
            <div class="profile-page-name">${escapeHtml(primary)}</div>
            <div class="profile-page-address">${escapeHtml(checksumAddress)}</div>
          </div>
        </div>
        <table class="data-table compact-table profile-table">
          <tbody>
            <tr><th>ENS</th><td>${author.ensName ? escapeHtml(author.ensName) : "-"}</td></tr>
            <tr><th>ENS status</th><td>${escapeHtml(ensStatus)}</td></tr>
            <tr><th>BUGZ</th><td title="${escapeHtml(bugzBalance.errorMessage ?? "")}">${escapeHtml(bugzText)}</td></tr>
            <tr><th>submissions</th><td>${escapeHtml(String(submissions.length))} recent</td></tr>
          </tbody>
        </table>
      </section>

      <section class="panel">
        <div class="panel-title">[ previous submissions ]</div>
        <p class="helper-copy">showing matches from the latest 100 bug-index records</p>
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
          <tbody>${submissionRows}</tbody>
        </table>
      </section>
    `
  };
};
