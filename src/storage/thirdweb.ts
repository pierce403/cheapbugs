import { download, upload } from "thirdweb/storage";

import { requireThirdwebClient, thirdwebClient } from "../auth/thirdweb";
import type { StorageProvider, StoredJson } from "../types/storage";
import { extractCid, normalizeIpfsUri } from "../lib/ipfs";

export class ThirdwebStorageProvider implements StorageProvider {
  readonly id = "thirdweb";
  readonly label = "thirdweb Storage";

  isConfigured(): boolean {
    return Boolean(thirdwebClient);
  }

  async uploadJson<T>(value: T, context: { name: string }): Promise<StoredJson> {
    const uri = await upload({
      client: requireThirdwebClient(),
      files: [
        {
          name: context.name,
          data: value as Record<string, unknown>
        }
      ]
    });

    const normalized = normalizeIpfsUri(uri);
    return {
      uri: normalized,
      cid: extractCid(normalized),
      provider: this.id
    };
  }

  async downloadJson<T>(uri: string): Promise<T> {
    const response = await download({
      client: requireThirdwebClient(),
      uri: normalizeIpfsUri(uri)
    });

    return response.json() as Promise<T>;
  }
}
