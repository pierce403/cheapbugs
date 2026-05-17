import type { StorageProvider, StoredJson } from "../types/storage";
import { toGatewayUrl } from "../lib/ipfs";

export class GatewayStorageProvider implements StorageProvider {
  readonly id = "ipfs-gateway";
  readonly label = "IPFS Gateway";

  isConfigured(): boolean {
    return true;
  }

  async uploadJson<T>(_value: T, _context: { name: string }): Promise<StoredJson> {
    throw new Error("IPFS uploads need a configured Pinata presign endpoint. Set VITE_STORAGE_PROVIDER=pinata.");
  }

  async downloadJson<T>(uri: string): Promise<T> {
    const response = await fetch(toGatewayUrl(uri));
    if (!response.ok) {
      throw new Error(`IPFS gateway download failed with ${response.status}.`);
    }

    return response.json() as Promise<T>;
  }
}
