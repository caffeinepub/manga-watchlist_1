# Manga Watchlist

## Current State

The app already uses blob-storage for canister uploads and IndexedDB as local cache:
- `uploadFile` (useStorageClient) uploads images to the backend canister on add/edit and import.
- `MangaCard` already checks IndexedDB first (`getCachedImage`), falls back to canister URL (`getImageUrl`), then caches the result in IndexedDB.
- `MangaModal` loads the preview image by calling `getImageUrl(hash)` directly — bypassing IndexedDB.

## Requested Changes (Diff)

### Add
- Nothing new to add; architecture is already correct.

### Modify
- `MangaModal`: When loading the edit-mode cover preview, check IndexedDB (`getCachedImage`) first. Only call `getImageUrl` and fetch from canister if the image is not found in IndexedDB. After fetching from canister, cache it in IndexedDB.

### Remove
- Nothing.

## Implementation Plan

1. In `MangaModal.tsx`, replace the direct `getImageUrl(editEntry.coverImageKey).then(url => setImagePreview(url))` with an async function that:
   a. Calls `getCachedImage(key)` — if found, use the data URL directly as `imagePreview`.
   b. If not in cache, call `getImageUrl(key)` to get the canister URL, fetch it as a data URL (`fetchImageAsDataUrl`), cache it via `setCachedImage`, then set `imagePreview`.
2. Import `getCachedImage`, `setCachedImage`, `fetchImageAsDataUrl` from `../utils/imageCache` in `MangaModal.tsx`.
