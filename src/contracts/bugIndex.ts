import { Contract, JsonRpcProvider } from "ethers";
import { ethers6Adapter } from "thirdweb/adapters/ethers6";

import { appChain, chainConfig } from "../config/chains";
import type { SubmissionPublic } from "../types/submission";
import { authController } from "../services";
import {
  disclosureModeToIndex,
  indexToDisclosureMode,
  indexToTargetKind,
  normalizeAddress,
  parseTags,
  targetKindToIndex
} from "../lib/utils";

import { bugIndexAbi } from "./bugIndexAbi";

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

const readProvider = new JsonRpcProvider(chainConfig.rpcUrl, chainConfig.id);

const readContract = () => new Contract(bugIndexAddress(), bugIndexAbi, readProvider);

const writeContract = async (): Promise<Contract> => {
  const account = authController.getActiveAccount();
  if (!account) {
    throw new Error("Connect a wallet before submitting onchain reports.");
  }

  const signer = await ethers6Adapter.signer.toEthers({
    client: authController.requireClient(),
    chain: appChain,
    account
  });

  return new Contract(bugIndexAddress(), bugIndexAbi, signer);
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

export const submitBugReportOnChain = async (
  submission: SubmissionPublic
): Promise<{ txHash: `0x${string}` }> => {
  const contract = await writeContract();
  const tx = await contract.submitReport({
    reportHash: submission.reportHash,
    reportId: submission.reportId,
    createdAt: BigInt(Math.floor(new Date(submission.createdAt).getTime() / 1000)),
    disclosureMode: disclosureModeToIndex(submission.disclosureMode),
    publicSummary: submission.publicSummary,
    encryptedPayloadCid: submission.encryptedPayloadCid,
    targetKind: targetKindToIndex(submission.targetKind),
    targetRefHash: submission.targetRefHash,
    tags: submission.tags.join(","),
    contentHash: submission.contentHash
  });

  const receipt = await tx.wait();
  return {
    txHash: (receipt?.hash ?? tx.hash) as `0x${string}`
  };
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
