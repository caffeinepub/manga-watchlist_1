# Manga Watchlist

## Current State
Manga metadata is stored in the backend canister. The frontend always calls `getEntries()` on every load to fetch the full manga list — no local caching of entries. This means:
- On a new device, the full list is fetched (correct behavior)
- On return visits, the full list is fetched again even if nothing changed (unnecessary bandwidth)
- On new devices where something DID change, the full list is also fetched (acceptable)

Images are already cached in IndexedDB with backend canister as authoritative backup.

## Requested Changes (Diff)

### Add
- Backend: `getLastModified()` query — returns the latest `updatedAt` timestamp across all user entries (Int, or 0 if no entries)
- Backend: `getEntriesSince(since: Int)` query — returns only entries where `updatedAt > since`
- Backend: `getDeletedSince(since: Int)` query — returns array of deleted entry IDs (Nat) where deletion occurred after `since`
- Backend: `deletedEntries` state — per-user map storing (id, deletedAt) pairs when entries are deleted
- Frontend: Local manga entry cache in localStorage (keyed per principal)
- Frontend: `lastSynced` timestamp stored in localStorage (keyed per principal)
- Frontend: Delta sync logic on login/app load:
  1. Call `getLastModified()` (cheap single-value call)
  2. If result matches local `lastSynced` → use local cache, no further fetches
  3. If mismatch or no local data → call `getEntriesSince(lastSynced)` + `getDeletedSince(lastSynced)` → merge/remove from local cache → update `lastSynced`
  4. Special case: if `lastSynced` is 0 (new device), call full `getEntries()` instead

### Modify
- Backend: `deleteEntry` — also records (id, Time.now()) to per-user `deletedEntries` list
- Frontend: After add/update/delete mutations, update local cache and `lastSynced` optimistically (or refetch delta to stay in sync)
- Frontend: `useGetEntries` hook — use delta sync instead of always calling `getEntries()`

### Remove
- Nothing removed

## Implementation Plan
1. Update `main.mo`:
   - Add `deletedEntries: Map<Principal, [(Nat, Int)]>` state
   - Update `deleteEntry` to record deletion with timestamp
   - Add `getLastModified()` query
   - Add `getEntriesSince(since: Int)` query
   - Add `getDeletedSince(since: Int)` query
2. Update frontend sync layer:
   - Create `utils/syncManager.ts` with local cache read/write helpers (localStorage) and delta sync logic
   - Update `useGetEntries` (or WatchlistScreen) to use delta sync on load
   - After mutations (add/update/delete), update local cache and `lastSynced`
