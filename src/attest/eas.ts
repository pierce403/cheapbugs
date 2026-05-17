import { AbiCoder, Contract, Interface, type ContractTransactionReceipt } from "ethers";

import { authController } from "../services";
import { chainConfig } from "../config/chains";
import { EAS_SCHEMAS, ZERO_ADDRESS, ZERO_BYTES32 } from "../lib/constants";
import { getSchemaUid, setSchemaUidOverride } from "../lib/schema-overrides";
import { clamp, impactToIndex, payoutTypeToIndex, rewardClassToIndex, validityToIndex } from "../lib/utils";
import type { PayoutRecord } from "../types/payout";
import type { ReviewVerdict } from "../types/review";

const NO_EXPIRATION = 0n;
const abiCoder = AbiCoder.defaultAbiCoder();

const easAbi = [
  "function attest(tuple(bytes32 schema,tuple(address recipient,uint64 expirationTime,bool revocable,bytes32 refUID,bytes data,uint256 value) data) request) payable returns (bytes32)",
  "event Attested(address indexed recipient,address indexed attester,bytes32 uid,bytes32 indexed schemaUID)"
] as const;

const schemaRegistryAbi = [
  "function register(string schema,address resolver,bool revocable) returns (bytes32)",
  "event Registered(bytes32 indexed uid,address indexed registerer,tuple(bytes32 uid,address resolver,bool revocable,string schema) schema)"
] as const;

const easInterface = new Interface(easAbi);
const schemaRegistryInterface = new Interface(schemaRegistryAbi);

const toSigner = async () => authController.getSigner();

const easClient = async (): Promise<Contract> => {
  const signer = await toSigner();
  return new Contract(chainConfig.easContractAddress, easAbi, signer);
};

const schemaRegistryClient = async (): Promise<Contract> => {
  const signer = await toSigner();
  return new Contract(chainConfig.easSchemaRegistryAddress, schemaRegistryAbi, signer);
};

const schemaTypes = (definition: string): string[] =>
  definition.split(",").map((field) => {
    const [type] = field.trim().split(/\s+/);
    if (!type) {
      throw new Error(`Invalid EAS schema field: ${field}`);
    }
    return type;
  });

const encodeSchemaData = (definition: string, values: unknown[]): `0x${string}` =>
  abiCoder.encode(schemaTypes(definition), values) as `0x${string}`;

const uidFromReceipt = (
  receipt: ContractTransactionReceipt | null,
  contractInterface: Interface,
  eventName: "Attested" | "Registered"
): `0x${string}` => {
  if (!receipt) {
    throw new Error(`${eventName} transaction was not mined.`);
  }

  for (const log of receipt.logs) {
    try {
      const parsed = contractInterface.parseLog(log);
      if (parsed?.name === eventName) {
        return parsed.args.uid as `0x${string}`;
      }
    } catch {
      // Ignore logs emitted by other contracts in the same transaction.
    }
  }

  throw new Error(`${eventName} event was missing from transaction receipt.`);
};

export const registerSchema = async (name: keyof typeof EAS_SCHEMAS): Promise<`0x${string}`> => {
  const schema = EAS_SCHEMAS[name];
  const registry = await schemaRegistryClient();
  const transaction = await registry.register(schema.definition, schema.resolverAddress, schema.revocable);

  const uid = uidFromReceipt(await transaction.wait(), schemaRegistryInterface, "Registered");
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
  const encodedData = encodeSchemaData(EAS_SCHEMAS.ReviewVerdict.definition, [
    verdict.reportHash,
    validityToIndex(verdict.validity),
    impactToIndex(verdict.impact),
    rewardClassToIndex(verdict.rewardClass),
    clamp(Math.round(verdict.confidence), 0, 100),
    verdict.noteCid
  ]);

  const transaction = await eas.attest(
    {
      schema: schemaUid,
      data: {
        recipient: authController.getSession().address ?? ZERO_ADDRESS,
        expirationTime: NO_EXPIRATION,
        revocable: true,
        refUID: ZERO_BYTES32,
        data: encodedData,
        value: 0n
      }
    },
    { value: 0n }
  );

  return uidFromReceipt(await transaction.wait(), easInterface, "Attested");
};

export const createPayoutRecordAttestation = async (record: PayoutRecord): Promise<`0x${string}`> => {
  const schemaUid = getSchemaUid("PayoutRecord");
  if (!schemaUid) {
    throw new Error("Set VITE_PAYOUT_RECORD_SCHEMA_UID before issuing payout records.");
  }

  const eas = await easClient();
  const encodedData = encodeSchemaData(EAS_SCHEMAS.PayoutRecord.definition, [
    record.reportHash,
    payoutTypeToIndex(record.payoutType),
    record.asset,
    BigInt(record.amount || "0"),
    record.noteCid
  ]);

  const transaction = await eas.attest(
    {
      schema: schemaUid,
      data: {
        recipient: ZERO_ADDRESS,
        expirationTime: NO_EXPIRATION,
        revocable: true,
        refUID: ZERO_BYTES32,
        data: encodedData,
        value: 0n
      }
    },
    { value: 0n }
  );

  return uidFromReceipt(await transaction.wait(), easInterface, "Attested");
};
