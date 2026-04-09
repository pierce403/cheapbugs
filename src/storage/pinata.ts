import type { PinataPresignResponse, StorageProvider, StoredJson } from "../types/storage";

import { env } from "../config/env";
import { extractCid, normalizeIpfsUri, toGatewayUrl } from "../lib/ipfs";

const assertResponse = async (response: Response): Promise<void> => {
  if (!response.ok) {
    throw new Error(await response.text());
  }
};

export class PinataStorageProvider implements StorageProvider {
  readonly id = "pinata";
  readonly label = "Pinata Presigned Upload";

  isConfigured(): boolean {
    return Boolean(env.pinataPresignEndpoint);
  }

  async uploadJson<T>(value: T, context: { name: string }): Promise<StoredJson> {
    if (!this.isConfigured()) {
      throw new Error("Pinata presign endpoint is not configured.");
    }

    const presign = await fetch(env.pinataPresignEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        name: context.name,
        contentType: "application/json"
      })
    });

    await assertResponse(presign);
    const payload = (await presign.json()) as PinataPresignResponse;
    const method = payload.method ?? "PUT";
    const body = JSON.stringify(value);

    if (method === "POST" && payload.fields) {
      const formData = new FormData();
      Object.entries(payload.fields).forEach(([key, fieldValue]) => {
        formData.append(key, fieldValue);
      });
      formData.append("file", new Blob([body], { type: "application/json" }), context.name);

      const uploadResponse = await fetch(payload.url, {
        method: "POST",
        body: formData
      });

      await assertResponse(uploadResponse);
    } else {
      const uploadResponse = await fetch(payload.url, {
        method,
        headers: {
          "content-type": "application/json",
          ...(payload.headers ?? {})
        },
        body
      });

      await assertResponse(uploadResponse);
    }

    if (!payload.cid) {
      throw new Error("Pinata presign endpoint must return the final CID for static-site retrieval.");
    }

    const uri = normalizeIpfsUri(`ipfs://${payload.cid}`);
    return {
      uri,
      cid: extractCid(uri),
      provider: this.id
    };
  }

  async downloadJson<T>(uri: string): Promise<T> {
    const response = await fetch(toGatewayUrl(uri));
    if (!response.ok) {
      throw new Error(`Pinata download failed with ${response.status}.`);
    }

    return response.json() as Promise<T>;
  }
}
