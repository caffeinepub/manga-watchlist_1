// JSZip loaded dynamically
import type { MangaEntry } from "../backend";
import { fetchImageAsDataUrl, getCachedImage } from "./imageCache";

const CHUNK_BYTES = 28 * 1024 * 1024; // 28 MiB per chunk

function sanitizeTitle(title: string): string {
  return title.replace(/[^a-zA-Z0-9-]/g, "_");
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function exportWatchlist(
  entries: MangaEntry[],
  favourites: Set<string>,
  getImageUrl: (hash: string) => Promise<string>,
  onProgress: (msg: string) => void,
): Promise<void> {
  type RecordWithImage = {
    record: Record<string, unknown>;
    imageData?: Uint8Array;
    imageFilename: string;
  };

  // Dynamic import for JSZip from CDN
  const jszipUrl =
    "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
  // biome-ignore lint: CDN dynamic import
  // @ts-ignore
  const JSZipModule = await import(/* @vite-ignore */ jszipUrl);
  const JSZip = JSZipModule.default ?? JSZipModule;

  const records: RecordWithImage[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    onProgress(`Processing ${i + 1} of ${entries.length}: ${entry.mainTitle}`);

    const altParts = entry.altTitle ? entry.altTitle.split("||") : [];
    const imageFilename = entry.coverImageKey
      ? `${sanitizeTitle(entry.mainTitle)}_${entry.id}.jpg`
      : "";

    const record: Record<string, unknown> = {
      mainTitle: entry.mainTitle,
      altTitle1: altParts[0] ?? "",
      altTitle2: altParts[1] ?? "",
      synopsis: entry.synopsis,
      genres: entry.genres,
      rating: entry.rating,
      chaptersOwned: entry.chaptersOwned,
      chaptersRead: entry.chaptersRead,
      personalNotes: entry.notes,
      bookmarked: favourites.has(entry.id.toString()),
      imageFilename,
    };

    let imageData: Uint8Array | undefined;

    if (entry.coverImageKey) {
      try {
        let dataUrl = await getCachedImage(entry.coverImageKey);
        if (!dataUrl) {
          const url = await getImageUrl(entry.coverImageKey);
          if (url) {
            try {
              dataUrl = await fetchImageAsDataUrl(url);
            } catch {
              onProgress(`⚠ Could not fetch image for "${entry.mainTitle}"`);
            }
          }
        }
        if (dataUrl) {
          imageData = dataUrlToUint8Array(dataUrl);
        } else {
          onProgress(`⚠ No cached image available for "${entry.mainTitle}"`);
        }
      } catch {
        onProgress(`⚠ Failed to retrieve image for "${entry.mainTitle}"`);
      }
    }

    records.push({ record, imageData, imageFilename });
  }

  // Group into chunks where total image binary size per chunk ≤ 28 MiB
  const chunks: RecordWithImage[][] = [];
  let currentChunk: RecordWithImage[] = [];
  let currentSize = 0;

  for (const item of records) {
    const itemSize = item.imageData?.byteLength ?? 0;
    if (currentChunk.length > 0 && currentSize + itemSize > CHUNK_BYTES) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentSize = 0;
    }
    currentChunk.push(item);
    currentSize += itemSize;
  }
  if (currentChunk.length > 0) chunks.push(currentChunk);

  // Generate and download each ZIP chunk
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci];
    const isMulti = chunks.length > 1;
    const filename = isMulti
      ? `manga-watchlist-part-${ci + 1}.zip`
      : "manga-watchlist.zip";

    onProgress(
      isMulti
        ? `Creating ZIP part ${ci + 1} of ${chunks.length}...`
        : "Creating ZIP...",
    );

    const zip = new JSZip();
    zip.file(
      "watchlist.json",
      JSON.stringify(
        chunk.map((item) => item.record),
        null,
        2,
      ),
    );

    const imagesFolder = zip.folder("images")!;
    for (const item of chunk) {
      if (item.imageData && item.imageFilename) {
        imagesFolder.file(item.imageFilename, item.imageData);
      }
    }

    const blob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
