import { EAS, NO_EXPIRATION, SchemaEncoder, SchemaRegistry } from "@ethereum-attestation-service/eas-sdk";
import { ethers6Adapter } from "thirdweb/adapters/ethers6";

import { authController } from "../services";
import { chainConfig, appChain } from "../config/chains";
import { EAS_SCHEMAS, ZERO_ADDRESS, ZERO_BYTES32 } from "../lib/constants";
import { getSchemaUid, setSchemaUidOverride } from "../lib/schema-overrides";
import { clamp, impactToIndex, payoutTypeToIndex, rewardClassToIndex, validityToIndex } from "../lib/utils";
import type { PayoutRecord } from "../types/payout";
import type { ReviewVerdict } from "../types/review";

const reviewEncoder = new SchemaEncoder(EAS_SCHEMAS.ReviewVerdict.definition);
const payoutEncoder = new SchemaEncoder(EAS_SCHEMAS.PayoutRecord.definition);

const toSigner = async () => {
  const account = authController.getActiveAccount();
  if (!account) {
    throw new Error("Connect a wallet first.");
  }

  return ethers6Adapter.signer.toEthers({
    client: authController.requireClient(),
    chain: appChain,
    account
  });
};

const easClient = async (): Promise<EAS> => {
  const signer = await toSigner();
  const eas = new EAS(chainConfig.easContractAddress);
  eas.connect(signer);
  return eas;
};

const schemaRegistryClient = async (): Promise<SchemaRegistry> => {
  const signer = await toSigner();
  const registry = new SchemaRegistry(chainConfig.easSchemaRegistryAddress);
  registry.connect(signer);
  return registry;
};

export const registerSchema = async (name: keyof typeof EAS_SCHEMAS): Promise<`0x${string}`> => {
  const schema = EAS_SCHEMAS[name];
  const registry = await schemaRegistryClient();
  const transaction = await registry.register({
    schema: schema.definition,
    resolverAddress: schema.resolverAddress,
    revocable: schema.revocable
  });

  const uid = (await transaction.wait()) as `0x${string}`;
  setSchemaUidOverride(name, uid);
  return uid;
};

export const createReviewVerdictAttestation = async (
  verdict: Omit<ReviewVerdict, "reviewer" | "createdAt">
): Promise<`0x${string}`> => {
  const schemaUid = getSchemaUid("ReviewVerdict");
  if (!schemaUid) {
    throw new Error("Set VITE_REVIEW_VERDICT_SCHEMA_UID before submitting verdicts.");
  }

  const eas = await easClient();
  const encodedData = reviewEncoder.encodeData([
    { name: "reportHash", value: verdict.reportHash, type: "bytes32" },
    { name: "validity", value: validityToIndex(verdict.validity), type: "uint8" },
    { name: "impact", value: impactToIndex(verdict.impact), type: "uint8" },
    { name: "rewardClass", value: rewardClassToIndex(verdict.rewardClass), type: "uint8" },
    { name: "confidence", value: clamp(Math.round(verdict.confidence), 0, 100), type: "uint8" },
    { name: "noteCID", value: verdict.noteCid, type: "string" }
  ]);

  const transaction = await eas.attest({
    schema: schemaUid,
    data: {
      recipient: authController.getSession().address ?? ZERO_ADDRESS,
      expirationTime: NO_EXPIRATION,
      revocable: true,
      refUID: ZERO_BYTES32,
      data: encodedData
    }
  });

  return transaction.wait() as Promise<`0x${string}`>;
};

export const createPayoutRecordAttestation = async (record: PayoutRecord): Promise<`0x${string}`> => {
  const schemaUid = getSchemaUid("PayoutRecord");
  if (!schemaUid) {
    throw new Error("Set VITE_PAYOUT_RECORD_SCHEMA_UID before issuing payout records.");
  }

  const eas = await easClient();
  const encodedData = payoutEncoder.encodeData([
    { name: "reportHash", value: record.reportHash, type: "bytes32" },
    { name: "payoutType", value: payoutTypeToIndex(record.payoutType), type: "uint8" },
    { name: "asset", value: record.asset, type: "address" },
    { name: "amount", value: BigInt(record.amount || "0"), type: "uint256" },
    { name: "noteCID", value: record.noteCid, type: "string" }
  ]);

  const transaction = await eas.attest({
    schema: schemaUid,
    data: {
      recipient: ZERO_ADDRESS,
      expirationTime: NO_EXPIRATION,
      revocable: true,
      refUID: ZERO_BYTES32,
      data: encodedData
    }
  });

  return transaction.wait() as Promise<`0x${string}`>;
};
