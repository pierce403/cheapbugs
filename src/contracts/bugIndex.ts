import { Contract } from "ethers";

import { chainConfig } from "../config/chains";
import type { SubmissionPublic } from "../types/submission";
import {
  indexToDisclosureMode,
  indexToTargetKind,
  normalizeAddress,
  parseTags
} from "../lib/utils";

import { bugIndexAbi } from "./bugIndexAbi";
import { createBaseReadProvider } from "./rpcProvider";

type ContractSubmission = {
  reportHash: `0x${string}`;
  reportId: string;
  reporter: string;
  createdAt: bigint;
  disclosureMode: number;
  publicSummary: string;
  encryptedPayloadCid: string;
  targetKind: number;
  targetRefHash: `0x${string}`;
  tags: string;
  contentHash: `0x${string}`;
};

const bugIndexAddress = (): `0x${string}` => {
  if (!chainConfig.bugIndexAddress) {
    throw new Error("Set VITE_BUG_INDEX_ADDRESS to the deployed Base bug index contract.");
  }

  return chainConfig.bugIndexAddress;
};

export const isBugIndexConfigured = (): boolean => Boolean(chainConfig.bugIndexAddress);

const readProvider = createBaseReadProvider();

const readContract = () => new Contract(bugIndexAddress(), bugIndexAbi, readProvider);

const fromContractSubmission = (entry: ContractSubmission): SubmissionPublic => ({
  reportId: entry.reportId,
  reportHash: entry.reportHash,
  reporterAddress: normalizeAddress(entry.reporter),
  createdAt: new Date(Number(entry.createdAt) * 1000).toISOString(),
  disclosureMode: indexToDisclosureMode(Number(entry.disclosureMode)),
  publicSummary: entry.publicSummary,
  encryptedPayloadCid: entry.encryptedPayloadCid,
  targetKind: indexToTargetKind(Number(entry.targetKind)),
  targetRefHash: entry.targetRefHash,
  tags: parseTags(entry.tags),
  contentHash: entry.contentHash
});

export const submitBugReportOnChain = async (
  _submission: SubmissionPublic
): Promise<never> => {
  throw new Error("Direct onchain report submission is disabled. Send submissions to a broker for signed publishing.");
};

export const getBugReport = async (reportHash: `0x${string}`): Promise<SubmissionPublic | null> => {
  if (!isBugIndexConfigured()) {
    return null;
  }

  const contract = readContract();

  try {
    const record = (await contract.getReport(reportHash)) as ContractSubmission;
    return fromContractSubmission(record);
  } catch {
    return null;
  }
};

export const getLatestBugReports = async (limit: number): Promise<SubmissionPublic[]> => {
  if (!isBugIndexConfigured()) {
    return [];
  }

  const contract = readContract();
  const hashes = (await contract.latestReportHashes(BigInt(limit))) as `0x${string}`[];
  const reports = await Promise.all(hashes.map((hash) => getBugReport(hash)));
  return reports.filter((entry): entry is SubmissionPublic => entry !== null);
};

export const getBugIndexAddress = (): `0x${string}` => bugIndexAddress();
