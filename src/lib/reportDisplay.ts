import type { SubmissionBundle } from "../types/submission";

import { textOrDash } from "./utils";

export const reportDisplayTitle = (bundle: SubmissionBundle): string => {
  if (bundle.publicMetadata.title) {
    return textOrDash(bundle.publicMetadata.title);
  }
  if (bundle.publicMetadata.status === "loading") {
    return "loading...";
  }
  return textOrDash(bundle.publicSubmission.reportId);
};

export const reportDisplayTarget = (bundle: SubmissionBundle): string => {
  const targetReference = bundle.publicMetadata.targetReference;
  const targetKind = bundle.publicMetadata.targetKind ?? bundle.publicSubmission.targetKind;

  if (targetReference && targetKind) {
    return `${targetReference} (${targetKind})`;
  }

  return targetReference ?? targetKind ?? "-";
};

export const reportDisplayTargetKind = (bundle: SubmissionBundle): string =>
  bundle.publicMetadata.targetKind ?? bundle.publicSubmission.targetKind;

const formatLocalUnlockTime = (revealAt: number): string =>
  new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(new Date(revealAt));

export const reportDetailsUnlockText = (bundle: SubmissionBundle): string => {
  if (bundle.publicSubmission.detailsKeyRevealed) {
    return "unlocked";
  }

  if (!bundle.publicSubmission.revealAfter) {
    return "unknown";
  }

  const revealAt = Date.parse(bundle.publicSubmission.revealAfter);
  if (!Number.isFinite(revealAt)) {
    return "unknown";
  }

  const remainingMinutes = Math.ceil((revealAt - Date.now()) / 60_000);
  if (remainingMinutes <= 0) {
    return "unlockable";
  }

  const days = Math.floor(remainingMinutes / 1_440);
  const hours = Math.floor((remainingMinutes % 1_440) / 60);
  const minutes = remainingMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }

  const relative = hours > 0 ? (minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`) : `${Math.max(1, minutes)}m`;
  return `unlock at ${formatLocalUnlockTime(revealAt)} in ${relative}`;
};
