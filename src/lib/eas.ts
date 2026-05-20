import { chainConfig } from "../config/chains";
import { env } from "../config/env";
import { reviewerSet } from "../config/reviewers";
import { QueryCache } from "./cache";
import { getSchemaUid } from "./schema-overrides";
import { indexToImpact, indexToRewardClass, indexToValidity, normalizeAddress, timestampToIso } from "./utils";
import type { ReviewDisplayState, ReviewVerdict } from "../types/review";

type GraphqlAttestation = {
  id: `0x${string}`;
  decodedDataJson: string;
  attester: `0x${string}`;
  recipient: `0x${string}`;
  time: number;
  timeCreated: number;
  refUID: `0x${string}`;
  revoked: boolean;
  txid: `0x${string}`;
  schemaId: `0x${string}`;
};

type DecodedField = {
  name: string;
  type: string;
  value: {
    value: unknown;
  };
};

const cache = new QueryCache("cheapbugs.eas");
const GRAPHQL_TTL = 30_000;

const graphql = async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
  const key = JSON.stringify({ query, variables });
  return cache.getOrLoad(key, GRAPHQL_TTL, async () => {
    const response = await fetch(chainConfig.easGraphqlUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ query, variables })
    });

    if (!response.ok) {
      throw new Error(`EAS GraphQL request failed with ${response.status}.`);
    }

    const payload = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (payload.errors?.length) {
      throw new Error(payload.errors.map((entry) => entry.message).join("; "));
    }

    if (!payload.data) {
      throw new Error("EAS GraphQL returned an empty payload.");
    }

    return payload.data;
  });
};

const parseDecodedData = (value: string): DecodedField[] => JSON.parse(value) as DecodedField[];
const normalizeHex = (value: string): `0x${string}` => value.toLowerCase() as `0x${string}`;

const readField = <T>(fields: DecodedField[], name: string): T => {
  const field = fields.find((entry) => entry.name === name);
  if (!field) {
    throw new Error(`Missing EAS decoded field: ${name}`);
  }

  return field.value.value as T;
};

const reviewFromAttestation = (attestation: GraphqlAttestation): ReviewVerdict => {
  const fields = parseDecodedData(attestation.decodedDataJson);
  return {
    reportHash: normalizeHex(readField<`0x${string}`>(fields, "reportHash")),
    reviewer: normalizeAddress(attestation.attester),
    validity: indexToValidity(Number(readField<string | number>(fields, "validity"))),
    impact: indexToImpact(Number(readField<string | number>(fields, "impact"))),
    rewardClass: indexToRewardClass(Number(readField<string | number>(fields, "rewardClass"))),
    confidence: Number(readField<string | number>(fields, "confidence")),
    noteCid: readField<string>(fields, "noteCID"),
    createdAt: timestampToIso(attestation.time)
  };
};

export const getReviewVerdictsByReportHash = async (reportHash: `0x${string}`): Promise<ReviewVerdict[]> => {
  const schemaUid = getSchemaUid("ReviewVerdict");
  if (!schemaUid) {
    return [];
  }

  const query = `
    query ReviewVerdicts($schemaId: String!, $needle: String!, $take: Int!) {
      attestations(
        where: {
          schemaId: { equals: $schemaId }
          revoked: { equals: false }
          isOffchain: { equals: false }
          decodedDataJson: { contains: $needle }
        }
        orderBy: [{ timeCreated: desc }]
        take: $take
      ) {
        id
        decodedDataJson
        attester
        recipient
        time
        timeCreated
        refUID
        revoked
        txid
        schemaId
      }
    }
  `;

  const data = await graphql<{ attestations: GraphqlAttestation[] }>(query, {
    schemaId: schemaUid,
    needle: reportHash.toLowerCase(),
    take: 100
  });

  const normalizedReportHash = reportHash.toLowerCase();
  return data.attestations.flatMap((attestation) => {
    try {
      const review = reviewFromAttestation(attestation);
      return review.reportHash.toLowerCase() === normalizedReportHash ? [review] : [];
    } catch {
      return [];
    }
  });
};

export const computeReviewDisplayState = (reviews: ReviewVerdict[]): ReviewDisplayState => {
  const latestByReviewer = new Map<string, ReviewVerdict>();
  reviews.forEach((review) => {
    const normalized = normalizeAddress(review.reviewer);
    const existing = latestByReviewer.get(normalized);
    if (!existing || new Date(review.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
      latestByReviewer.set(normalized, review);
    }
  });

  const allLatest = Array.from(latestByReviewer.values()).sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt)
  );

  const trusted = allLatest.filter((review) => reviewerSet.has(normalizeAddress(review.reviewer)));
  const ignored = allLatest.filter((review) => !reviewerSet.has(normalizeAddress(review.reviewer)));
  const confidenceAverage = trusted.length
    ? Math.round(trusted.reduce((total, review) => total + review.confidence, 0) / trusted.length)
    : null;

  return {
    headline: trusted[0] ?? null,
    latest: allLatest,
    trusted,
    ignored,
    confidenceAverage
  };
};

export const getFeaturedReportHashes = (): string[] => env.featuredReportIds;
