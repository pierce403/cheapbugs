import { EAS_SCHEMAS, STORAGE_KEYS } from "./constants";

type SchemaName = keyof typeof EAS_SCHEMAS;
type SchemaOverrideRecord = Partial<Record<SchemaName, `0x${string}`>>;

const storageKey = `${STORAGE_KEYS.cachePrefix}:schema-uids`;

const readOverrides = (): SchemaOverrideRecord => {
  if (typeof window === "undefined") {
    return {};
  }

  const raw = window.localStorage.getItem(storageKey);
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as SchemaOverrideRecord;
  } catch {
    return {};
  }
};

const writeOverrides = (value: SchemaOverrideRecord): void => {
  window.localStorage.setItem(storageKey, JSON.stringify(value));
};

export const getSchemaUid = (name: SchemaName): `0x${string}` | "" => readOverrides()[name] ?? EAS_SCHEMAS[name].uid;

export const setSchemaUidOverride = (name: SchemaName, uid: `0x${string}`): void => {
  const current = readOverrides();
  current[name] = uid;
  writeOverrides(current);
};

export const getSchemaCatalog = (): Array<(typeof EAS_SCHEMAS)[SchemaName]> =>
  (Object.keys(EAS_SCHEMAS) as SchemaName[]).map((name) => ({
    ...EAS_SCHEMAS[name],
    uid: getSchemaUid(name)
  }));
