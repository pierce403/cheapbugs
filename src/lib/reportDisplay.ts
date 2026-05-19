import type { SubmissionBundle } from "../types/submission";

import { textOrDash } from "./utils";

export const reportDisplayTitle = (bundle: SubmissionBundle): string =>
  textOrDash(bundle.publicMetadata.title ?? bundle.publicSubmission.reportId);

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
