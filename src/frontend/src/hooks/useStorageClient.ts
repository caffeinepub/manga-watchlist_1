import { HttpAgent } from "@icp-sdk/core/agent";
import { useCallback } from "react";
import { loadConfig } from "../config";
import { StorageClient } from "../utils/StorageClient";
import { useInternetIdentity } from "./useInternetIdentity";

let cachedConfigPromise: ReturnType<typeof loadConfig> | null = null;

function getConfig() {
  if (!cachedConfigPromise) cachedConfigPromise = loadConfig();
  return cachedConfigPromise;
}

export function useStorageClient() {
  const { identity } = useInternetIdentity();

  const uploadFile = useCallback(
    async (file: File, onProgress?: (pct: number) => void): Promise<string> => {
      const config = await getConfig();
      const agent = new HttpAgent({
        identity: identity ?? undefined,
        host: config.backend_host,
      });
      const client = new StorageClient(
        config.bucket_name,
        config.storage_gateway_url,
        config.backend_canister_id,
        config.project_id,
        agent,
      );
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { hash } = await client.putFile(bytes, onProgress);
      return hash;
    },
    [identity],
  );

  const getImageUrl = useCallback(async (hash: string): Promise<string> => {
    if (!hash) return "";
    const config = await getConfig();
    const gw = config.storage_gateway_url;
    if (!gw || gw === "nogateway") return "";
    return `${gw}/v1/blob/?blob_hash=${encodeURIComponent(hash)}&owner_id=${encodeURIComponent(config.backend_canister_id)}&project_id=${encodeURIComponent(config.project_id)}`;
  }, []);

  return { uploadFile, getImageUrl };
}
