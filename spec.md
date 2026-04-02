# Manga Watchlist

## Current State
Add works. Edit (updateEntry) and delete (deleteEntry) both fail silently with generic error toasts. Both take an `id: bigint` (IDL.Nat) as a parameter — addEntry does not.

## Requested Changes (Diff)

### Add
- Explicit BigInt coercion for `id` before passing to canister in both update and delete mutations
- BigInt field migration in `getLocalEntries` so old cached entries with number IDs are auto-upgraded
- Retry logic + `useRef` actor pattern in `useUpdateEntry` (matching `useDeleteEntry`)
- Actual error message surfaced in all error toasts (not just generic text)

### Modify
- `syncManager.ts` — `getLocalEntries` migrates number → bigint for id/createdAt/updatedAt on load
- `useQueries.ts` — `useUpdateEntry` gets useRef + retry; both mutations explicitly BigInt-cast the id
- `WatchlistScreen.tsx` — error toasts show actual message
- `MangaModal.tsx` — error toast shows actual message

### Remove
- Nothing removed

## Implementation Plan
1. Patch `getLocalEntries` to coerce number fields to bigint on read (migration safety)
2. Patch `useUpdateEntry` to use actorRef + retry loop + explicit BigInt(id)
3. Patch `useDeleteEntry` to add explicit BigInt(id)
4. Update error toast strings to include `e instanceof Error ? e.message : String(e)`
