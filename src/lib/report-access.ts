import { STORAGE_KEYS } from "./constants";

type AccessMap = Record<string, string>;

const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

export const detailsKeyHexToAccessKey = (detailsKey: string | null | undefined): string | null => {
  const normalized = detailsKey?.toLowerCase();
  if (!normalized || !/^0x[a-f0-9]{64}$/.test(normalized) || /^0x0{64}$/.test(normalized)) {
    return null;
  }

  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(2 + index * 2, 4 + index * 2), 16);
  }
  return bytesToBase64Url(bytes);
};

const readMap = (): AccessMap => {
  const raw = window.localStorage.getItem(STORAGE_KEYS.reportAccess);
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as AccessMap;
  } catch {
    return {};
  }
};

const writeMap = (value: AccessMap): void => {
  window.localStorage.setItem(STORAGE_KEYS.reportAccess, JSON.stringify(value));
};

export const saveReportAccessKey = (reportHash: string, accessKey: string): void => {
  const current = readMap();
  current[reportHash] = accessKey;
  writeMap(current);
};

export const getReportAccessKey = (reportHash: string): string | null => readMap()[reportHash] ?? null;

export const removeReportAccessKey = (reportHash: string): void => {
  const current = readMap();
  delete current[reportHash];
  writeMap(current);
};
