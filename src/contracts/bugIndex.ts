import { Contract } from "ethers";

import { chainConfig } from "../config/chains";
import type { SubmissionPublic } from "../types/submission";
import {
  indexToDisclosureMode,
  indexToTargetKind,
  normalizeAddress,
  parseTags
} from "../lib/utils";
import { RpcReadCache } from "../lib/rpcReadCache";

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
const readCache = new RpcReadCache();
const LATEST_REPORTS_TTL_MS = 15_000;
const REPORT_TTL_MS = 60_000;
const BUG_INDEX_READ_TIMEOUT_MS = 4_000;

const readContract = () => new Contract(bugIndexAddress(), bugIndexAbi, readProvider);

const withReadTimeout = async <T>(read: Promise<T>, label: string): Promise<T> => {
  const timeout = new Promise<never>((_resolve, reject) => {
    globalThis.setTimeout(() => reject(new Error(`${label} timed out.`)), BUG_INDEX_READ_TIMEOUT_MS);
  });
  return Promise.race([read, timeout]);
};

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

export const getBugReport = async (reportHash: `0x${string}`): Promise<SubmissionPublic | null> => {
  if (!isBugIndexConfigured()) {
    return null;
  }

  const key = `report:${bugIndexAddress()}:${reportHash}`;

  try {
    return await readCache.getOrLoad(key, REPORT_TTL_MS, async () => {
      const record = (await withReadTimeout(
        readContract().getReport(reportHash) as Promise<ContractSubmission>,
        "Bug index getReport"
      )) as ContractSubmission;
      return fromContractSubmission(record);
    });
  } catch {
    return readCache.getStale<SubmissionPublic>(key);
  }
};

export const getLatestBugReports = async (limit: number): Promise<SubmissionPublic[]> => {
  if (!isBugIndexConfigured()) {
    return [];
  }

  const key = `latest:${bugIndexAddress()}:${limit}`;

  try {
    return await readCache.getOrLoad(key, LATEST_REPORTS_TTL_MS, async () => {
      const hashes = await withReadTimeout(
        readContract().latestReportHashes(BigInt(limit)) as Promise<`0x${string}`[]>,
        "Bug index latestReportHashes"
      );
      const reports = await Promise.all(hashes.map((hash) => getBugReport(hash)));
      return reports.filter((entry): entry is SubmissionPublic => entry !== null);
    });
  } catch {
    return readCache.getStale<SubmissionPublic[]>(key) ?? [];
  }
};

export const getBugIndexAddress = (): `0x${string}` => bugIndexAddress();
