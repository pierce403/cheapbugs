export type StoredJson = {
  uri: string;
  cid: string;
  provider: string;
};

export type PinataPresignResponse = {
  url: string;
  method?: "PUT" | "POST";
  headers?: Record<string, string>;
  fields?: Record<string, string>;
  cid?: string;
};

export type StorageUploadContext = {
  name: string;
  cacheControl?: string;
};

export interface StorageProvider {
  readonly id: string;
  readonly label: string;
  isConfigured(): boolean;
  uploadJson<T>(value: T, context: StorageUploadContext): Promise<StoredJson>;
  downloadJson<T>(uri: string): Promise<T>;
}
