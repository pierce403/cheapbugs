import type { SubmissionPrivate } from "../types/submission";

import { hashJson, stableStringify } from "./utils";

export type EncryptedEnvelope = {
  version: 1;
  algorithm: "AES-GCM";
  kdf: "PBKDF2";
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PBKDF2_ITERATIONS = 210_000;

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
};

const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const randomBytes = (length: number): Uint8Array => crypto.getRandomValues(new Uint8Array(length));

const deriveKey = async (secret: string, salt: Uint8Array): Promise<CryptoKey> => {
  const material = await crypto.subtle.importKey("raw", toArrayBuffer(encoder.encode(secret)), "PBKDF2", false, [
    "deriveKey"
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS
    },
    material,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    ["encrypt", "decrypt"]
  );
};

export const createAccessKey = (): string => bytesToBase64(randomBytes(24));

export const encryptJson = async <T>(value: T, secret: string): Promise<EncryptedEnvelope> => {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(secret, salt);
  const plaintext = encoder.encode(stableStringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(plaintext));

  return {
    version: 1,
    algorithm: "AES-GCM",
    kdf: "PBKDF2",
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
};

export const decryptJson = async <T>(envelope: EncryptedEnvelope, secret: string): Promise<T> => {
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);
  const key = await deriveKey(secret, salt);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(ciphertext)
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
};

export const computePrivateContentHash = (value: SubmissionPrivate): `0x${string}` => hashJson(value);
