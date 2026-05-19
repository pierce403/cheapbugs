import { Contract, Interface } from "ethers";

import { chainConfig } from "../config/chains";
import type { SubmissionPublic } from "../types/submission";
import { authController } from "../services";
import type { HexString } from "../types/domain";
import {
  indexToDisclosureMode,
  indexToTargetKind,
  normalizeAddress,
  parseTags
} from "../lib/utils";
import { RpcReadCache, scheduleBaseRpcRead } from "../lib/rpcReadCache";
import { QueryCache } from "../lib/cache";

import { bugIndexAbi } from "./bugIndexAbi";
import { getBondVotingLevel } from "./bondVault";
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
  bugBundleHash: `0x${string}`;
  encryptedDetailsHash: `0x${string}`;
  detailsKeyCommitment: `0x${string}`;
  revealAfter: bigint;
  detailsKeyRevealed: boolean;
};

type ContractBondVote = {
  reportHash?: `0x${string}`;
  voter?: string;
  createdAt?: bigint;
  support?: boolean;
  weight?: bigint;
  0: `0x${string}`;
  1: string;
  2: bigint;
  3: boolean;
  4: bigint;
};

export type BugVoteState = {
  reportHash: `0x${string}`;
  upWeight: bigint;
  downWeight: bigint;
  score: bigint;
  voterSupport: boolean | null;
  voterWeight: number;
};

export class NoBondVotingPowerError extends Error {
  constructor() {
    super("Voting requires staked BUGZ.");
    this.name = "NoBondVotingPowerError";
  }
}

const bugIndexAddress = (): `0x${string}` => {
  if (!chainConfig.bugIndexAddress) {
    throw new Error("Set VITE_BUG_INDEX_ADDRESS to the deployed Base bug index contract.");
  }

  return chainConfig.bugIndexAddress;
};

export const isBugIndexConfigured = (): boolean => Boolean(chainConfig.bugIndexAddress);

const readProvider = createBaseReadProvider();
const readCache = new RpcReadCache();
const persistentCache = new QueryCache("cheapbugs.bugIndex.v2");
const LATEST_REPORTS_TTL_MS = 15_000;
const REPORT_TTL_MS = 60_000;
const PERSISTENT_REPORT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PERSISTENT_LATEST_TTL_MS = 60_000;
const BUG_VOTES_TTL_MS = 15_000;
const BUG_INDEX_READ_TIMEOUT_MS = 4_000;
const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target,bool allowFailure,bytes callData)[] calls) view returns (tuple(bool success,bytes returnData)[] returnData)"
];

const bugIndexInterface = new Interface(bugIndexAbi);
const readContract = () => new Contract(bugIndexAddress(), bugIndexAbi, readProvider);
const readMulticall = () => new Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, readProvider);

const withReadTimeout = async <T>(read: Promise<T>, label: string): Promise<T> => {
  const timeout = new Promise<never>((_resolve, reject) => {
    globalThis.setTimeout(() => reject(new Error(`${label} timed out.`)), BUG_INDEX_READ_TIMEOUT_MS);
  });
  return Promise.race([read, timeout]);
};

const emptyVoteState = (reportHash: `0x${string}`): BugVoteState => ({
  reportHash,
  upWeight: 0n,
  downWeight: 0n,
  score: 0n,
  voterSupport: null,
  voterWeight: 0
});

const shortenError = (message: string): string => (message.length > 240 ? `${message.slice(0, 237)}...` : message);

const submitVoteError = (error: unknown): Error => {
  const raw = error instanceof Error ? error.message : String(error);
  if (/NoVotingPower/i.test(raw)) {
    return new NoBondVotingPowerError();
  }
  if (/user rejected|denied transaction|rejected the request/i.test(raw)) {
    return new Error("Vote was rejected in the wallet.");
  }
  if (/insufficient funds|insufficient.*gas/i.test(raw)) {
    return new Error("Vote needs more Base ETH for gas.");
  }
  if (/VotingClosed/i.test(raw)) {
    return new Error("Voting is closed for this report.");
  }
  if (/MissingBug/i.test(raw)) {
    return new Error("This report is not in the bug index.");
  }
  return new Error(`Vote failed: ${shortenError(raw)}`);
};

const fromContractBondVote = (vote: ContractBondVote): Pick<BugVoteState, "voterSupport" | "voterWeight"> => {
  const weight = Number(vote.weight ?? vote[4] ?? 0n);
  return {
    voterSupport: weight > 0 ? Boolean(vote.support ?? vote[3]) : null,
    voterWeight: weight
  };
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
  contentHash: entry.contentHash,
  bugBundleHash: entry.bugBundleHash,
  encryptedDetailsHash: entry.encryptedDetailsHash,
  detailsKeyCommitment: entry.detailsKeyCommitment,
  revealAfter: new Date(Number(entry.revealAfter) * 1000).toISOString(),
  detailsKeyRevealed: entry.detailsKeyRevealed
});

export const getBugReport = async (reportHash: `0x${string}`): Promise<SubmissionPublic | null> => {
  if (!isBugIndexConfigured()) {
    return null;
  }

  const key = `report:${bugIndexAddress()}:${reportHash}`;
  const stale = persistentCache.getStale<SubmissionPublic>(key);
  const cached = persistentCache.get<SubmissionPublic>(key);
  if (cached) {
    return readCache.set(key, cached, REPORT_TTL_MS);
  }

  try {
    const report = await readCache.getOrLoad(key, REPORT_TTL_MS, async () => {
      const record = (await withReadTimeout(
        scheduleBaseRpcRead("Bug index getReport", () =>
          readContract().getReport(reportHash) as Promise<ContractSubmission>
        ),
        "Bug index getReport"
      )) as ContractSubmission;
      return fromContractSubmission(record);
    });
    return persistentCache.set(key, report, PERSISTENT_REPORT_TTL_MS);
  } catch {
    const staleReport = readCache.getStale<SubmissionPublic>(key) ?? stale;
    if (staleReport) {
      return persistentCache.set(key, staleReport, PERSISTENT_REPORT_TTL_MS);
    }
    return null;
  }
};

export const getLatestBugReports = async (limit: number): Promise<SubmissionPublic[]> => {
  if (!isBugIndexConfigured()) {
    return [];
  }

  const key = `latest:${bugIndexAddress()}:${limit}`;
  const stale = persistentCache.getStale<SubmissionPublic[]>(key);
  const cached = persistentCache.get<SubmissionPublic[]>(key);
  if (cached) {
    return readCache.set(key, cached, LATEST_REPORTS_TTL_MS);
  }

  try {
    const reports = await readCache.getOrLoad(key, LATEST_REPORTS_TTL_MS, async () => {
      const hashes = await withReadTimeout(
        scheduleBaseRpcRead("Bug index latestReportHashes", () =>
          readContract().latestReportHashes(BigInt(limit)) as Promise<`0x${string}`[]>
        ),
        "Bug index latestReportHashes"
      );
      const reports = await Promise.all(hashes.map((hash) => getBugReport(hash)));
      return reports.filter((entry): entry is SubmissionPublic => entry !== null);
    });
    return persistentCache.set(key, reports, PERSISTENT_LATEST_TTL_MS);
  } catch {
    const staleReports = readCache.getStale<SubmissionPublic[]>(key) ?? stale;
    if (staleReports) {
      return persistentCache.set(key, staleReports, PERSISTENT_LATEST_TTL_MS);
    }
    return [];
  }
};

const loadBugVoteStatesSerial = async (
  reportHashes: `0x${string}`[],
  voter: HexString | null
): Promise<Map<`0x${string}`, BugVoteState>> => {
  const index = readContract();
  const entries = await Promise.all(
    reportHashes.map(async (reportHash): Promise<[reportHash: `0x${string}`, state: BugVoteState]> => {
      try {
        const [upWeight, downWeight, vote] = await Promise.all([
          withReadTimeout(
            scheduleBaseRpcRead("Bug index upVoteWeight", () =>
              index.upVoteWeight(reportHash) as Promise<bigint>
            ),
            "Bug index upVoteWeight"
          ),
          withReadTimeout(
            scheduleBaseRpcRead("Bug index downVoteWeight", () =>
              index.downVoteWeight(reportHash) as Promise<bigint>
            ),
            "Bug index downVoteWeight"
          ),
          voter
            ? withReadTimeout(
                scheduleBaseRpcRead("Bug index getBondVote", () =>
                  index.getBondVote(reportHash, voter) as Promise<ContractBondVote>
                ),
                "Bug index getBondVote"
              )
            : Promise.resolve(null)
        ]);
        const voterState = vote ? fromContractBondVote(vote) : { voterSupport: null, voterWeight: 0 };
        return [
          reportHash,
          {
            reportHash,
            upWeight,
            downWeight,
            score: upWeight - downWeight,
            ...voterState
          }
        ];
      } catch {
        return [reportHash, emptyVoteState(reportHash)];
      }
    })
  );

  return new Map(entries);
};

const loadBugVoteStatesViaMulticall = async (
  reportHashes: `0x${string}`[],
  voter: HexString | null
): Promise<Map<`0x${string}`, BugVoteState>> => {
  const target = bugIndexAddress();
  const calls = reportHashes.flatMap((reportHash) => [
    {
      target,
      allowFailure: true,
      callData: bugIndexInterface.encodeFunctionData("upVoteWeight", [reportHash])
    },
    {
      target,
      allowFailure: true,
      callData: bugIndexInterface.encodeFunctionData("downVoteWeight", [reportHash])
    },
    ...(voter
      ? [
          {
            target,
            allowFailure: true,
            callData: bugIndexInterface.encodeFunctionData("getBondVote", [reportHash, voter])
          }
        ]
      : [])
  ]);

  const results = await withReadTimeout(
    scheduleBaseRpcRead("Bug index vote multicall", () =>
      readMulticall().aggregate3(calls) as Promise<Array<{ success?: boolean; returnData?: string; 0: boolean; 1: string }>>
    ),
    "Bug index vote multicall"
  );

  const callsPerReport = voter ? 3 : 2;
  const states = new Map<`0x${string}`, BugVoteState>();

  reportHashes.forEach((reportHash, index) => {
    const offset = index * callsPerReport;
    const upResult = results[offset];
    const downResult = results[offset + 1];
    const voteResult = voter ? results[offset + 2] : null;

    if (!upResult || !downResult || !(upResult.success ?? upResult[0]) || !(downResult.success ?? downResult[0])) {
      states.set(reportHash, emptyVoteState(reportHash));
      return;
    }

    const upWeight = bugIndexInterface.decodeFunctionResult("upVoteWeight", upResult.returnData ?? upResult[1])[0] as bigint;
    const downWeight = bugIndexInterface.decodeFunctionResult(
      "downVoteWeight",
      downResult.returnData ?? downResult[1]
    )[0] as bigint;
    const vote =
      voteResult && (voteResult.success ?? voteResult[0])
        ? (bugIndexInterface.decodeFunctionResult("getBondVote", voteResult.returnData ?? voteResult[1])[0] as ContractBondVote)
        : null;
    const voterState = vote ? fromContractBondVote(vote) : { voterSupport: null, voterWeight: 0 };

    states.set(reportHash, {
      reportHash,
      upWeight,
      downWeight,
      score: upWeight - downWeight,
      ...voterState
    });
  });

  return states;
};

export const loadBugVoteStates = async (
  reportHashes: `0x${string}`[],
  voter?: HexString | null
): Promise<Map<`0x${string}`, BugVoteState>> => {
  const uniqueHashes = [...new Set(reportHashes)];
  if (!isBugIndexConfigured() || uniqueHashes.length === 0) {
    return new Map(uniqueHashes.map((reportHash) => [reportHash, emptyVoteState(reportHash)]));
  }

  const normalizedVoter = voter ? normalizeAddress(voter) : null;
  const key = `votes:${bugIndexAddress()}:${normalizedVoter ?? "guest"}:${uniqueHashes.join(",")}`;

  try {
    return await readCache.getOrLoad(key, BUG_VOTES_TTL_MS, async () => {
      try {
        return await loadBugVoteStatesViaMulticall(uniqueHashes, normalizedVoter);
      } catch {
        return loadBugVoteStatesSerial(uniqueHashes, normalizedVoter);
      }
    });
  } catch {
    return new Map(uniqueHashes.map((reportHash) => [reportHash, emptyVoteState(reportHash)]));
  }
};

export const submitBugBondVote = async (reportHash: `0x${string}`, support: boolean): Promise<HexString> => {
  const account = authController.getSession().address;
  if (!account) {
    throw new Error("Connect a wallet before voting.");
  }

  const normalizedAccount = normalizeAddress(account);
  const level = await getBondVotingLevel(normalizedAccount);
  if (level <= 0) {
    throw new NoBondVotingPowerError();
  }

  try {
    const signer = await authController.getSigner();
    const signerAddress = normalizeAddress(await signer.getAddress());
    if (signerAddress !== normalizedAccount) {
      throw new Error("Connected wallet changed. Reconnect before voting.");
    }

    const contract = new Contract(bugIndexAddress(), bugIndexAbi, signer);
    const tx = await contract.submitBondVote(reportHash, support);
    const receipt = await tx.wait();
    readCache.clear();
    return normalizeAddress(receipt?.hash ?? tx.hash);
  } catch (error) {
    throw submitVoteError(error);
  }
};

export const getBugIndexAddress = (): `0x${string}` => bugIndexAddress();
