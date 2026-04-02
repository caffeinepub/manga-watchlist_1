import type { MangaEntry } from "../backend";
import type { backendInterface } from "../backend";

// BigInt-safe JSON helpers
function bigintReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return `__bigint__${value.toString()}`;
  }
  return value;
}

function bigintReviver(_key: string, value: unknown): unknown {
  if (typeof value === "string" && value.startsWith("__bigint__")) {
    return BigInt(value.slice(10));
  }
  return value;
}

function entriesKey(principal: string) {
  return `manga-entries-${principal}`;
}

function syncKey(principal: string) {
  return `manga-lastsync-${principal}`;
}

export function getLocalEntries(principal: string): MangaEntry[] {
  try {
    const raw = localStorage.getItem(entriesKey(principal));
    if (!raw) return [];
    return JSON.parse(raw, bigintReviver) as MangaEntry[];
  } catch {
    return [];
  }
}

export function saveLocalEntries(
  principal: string,
  entries: MangaEntry[],
): void {
  try {
    localStorage.setItem(
      entriesKey(principal),
      JSON.stringify(entries, bigintReplacer),
    );
  } catch {
    // localStorage may be full or unavailable
  }
}

export function getLastSynced(principal: string): bigint {
  try {
    const raw = localStorage.getItem(syncKey(principal));
    if (!raw) return 0n;
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

export function saveLastSynced(principal: string, ts: bigint): void {
  try {
    localStorage.setItem(syncKey(principal), ts.toString());
  } catch {
    // ignore
  }
}

export function clearLocalCache(principal: string): void {
  try {
    localStorage.removeItem(entriesKey(principal));
    localStorage.removeItem(syncKey(principal));
  } catch {
    // ignore
  }
}

export async function syncEntries(
  actor: backendInterface,
  principal: string,
): Promise<MangaEntry[]> {
  const backendLastModified = await actor.getLastModified();
  const localLastSynced = getLastSynced(principal);

  // Up to date — return local cache
  if (backendLastModified === localLastSynced) {
    const cached = getLocalEntries(principal);
    if (cached.length > 0 || backendLastModified === 0n) {
      return cached;
    }
  }

  // No local data — full pull (first time on this device)
  if (localLastSynced === 0n) {
    const entries = await actor.getEntries();
    saveLocalEntries(principal, entries);
    saveLastSynced(principal, backendLastModified);
    return entries;
  }

  // Delta sync — only fetch what changed
  const [updated, deletedIds] = await Promise.all([
    actor.getEntriesSince(localLastSynced),
    actor.getDeletedSince(localLastSynced),
  ]);

  const deletedSet = new Set(deletedIds.map((id) => id.toString()));
  let local = getLocalEntries(principal);

  // Remove deleted entries
  local = local.filter((e) => !deletedSet.has(e.id.toString()));

  // Upsert updated entries
  const updatedMap = new Map(updated.map((e) => [e.id.toString(), e]));
  local = local.map((e) => updatedMap.get(e.id.toString()) ?? e);
  for (const e of updated) {
    if (!local.find((l) => l.id.toString() === e.id.toString())) {
      local.push(e);
    }
  }

  saveLocalEntries(principal, local);
  saveLastSynced(principal, backendLastModified);
  return local;
}
