import { STORAGE_KEYS } from "./constants";

type AccessMap = Record<string, string>;

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
