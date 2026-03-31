import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle,
  CheckCircle2,
  FileJson,
  FolderOpen,
  Loader2,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Variant_Complete_Incomplete } from "../backend";
import type { MangaEntry, MangaEntryInput } from "../backend";
import { useAddEntry, useUpdateEntry } from "../hooks/useQueries";
import { useStorageClient } from "../hooks/useStorageClient";

// ---------------------------------------------------------------------------
// Retry helper — exponential back-off with jitter
// ---------------------------------------------------------------------------
async function retryAsync<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 800,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts - 1) {
        await new Promise((r) =>
          setTimeout(r, baseDelayMs * 2 ** attempt + Math.random() * 400),
        );
      }
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Field mapping — maps common export variants → canonical field names
// ---------------------------------------------------------------------------

const FIELD_ALIASES: Record<string, string[]> = {
  mainTitle: ["title", "name", "mangaTitle", "mainTitle"],
  altTitle1: ["altTitle1", "altTitle", "alternateTitle"],
  altTitle2: ["altTitle2"],
  synopsis: ["synopsis", "description", "summary"],
  genres: ["genres", "genre", "category", "categories", "tags"],
  rating: ["rating", "score", "userRating", "myRating"],
  chaptersOwned: [
    "chaptersOwned",
    "availableChapters",
    "owned",
    "chaptersTotal",
    "totalChapters",
  ],
  chaptersRead: ["chaptersRead", "read", "progress", "currentChapter"],
  personalNotes: ["personalNotes", "notes", "comment", "comments", "myNotes"],
  bookmarked: [
    "bookmarked",
    "isBookmarked",
    "isFavourite",
    "favorite",
    "favourite",
    "starred",
  ],
  imageFilename: [
    "imageFilename",
    "coverImage",
    "cover",
    "image",
    "coverImageKey",
    "thumbnail",
  ],
};

/** Find a key in a record using case-insensitive matching. */
function findKey(
  record: Record<string, any>,
  alias: string,
): string | undefined {
  return Object.keys(record).find(
    (k) => k.toLowerCase() === alias.toLowerCase(),
  );
}

/**
 * Remaps any incoming JSON object to use canonical field names.
 * Handles special cases:
 *  - alternateTitles[] → altTitle1, altTitle2
 *  - coverImages[]     → imageFilename
 *  - completed/isComplete boolean → _completed flag
 */
function normalizeRecord(raw: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};

  // Copy recognised fields using alias lookup
  for (const [canonical, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      const foundKey = findKey(raw, alias);
      if (foundKey !== undefined && out[canonical] === undefined) {
        out[canonical] = raw[foundKey];
        break;
      }
    }
  }

  // Special: alternateTitles array → altTitle1 / altTitle2
  const altTitlesKey = findKey(raw, "alternateTitles");
  if (altTitlesKey !== undefined) {
    const arr = raw[altTitlesKey];
    if (Array.isArray(arr)) {
      if (arr[0] !== undefined && out.altTitle1 === undefined)
        out.altTitle1 = String(arr[0]);
      if (arr[1] !== undefined && out.altTitle2 === undefined)
        out.altTitle2 = String(arr[1]);
    }
  }

  // Special: coverImages array → imageFilename
  const coverImagesKey = findKey(raw, "coverImages");
  if (coverImagesKey !== undefined) {
    const arr = raw[coverImagesKey];
    if (
      Array.isArray(arr) &&
      arr[0] !== undefined &&
      out.imageFilename === undefined
    ) {
      out.imageFilename = String(arr[0]);
    }
  }

  // Special: completed / isComplete boolean → _completed flag
  const completedKey = findKey(raw, "completed") ?? findKey(raw, "isComplete");
  if (completedKey !== undefined) {
    const val = raw[completedKey];
    out._completed = val === true || val === "complete" || val === "completed";
  }
  // Also handle status string
  const statusKey = findKey(raw, "status");
  if (statusKey !== undefined) {
    const val = String(raw[statusKey]).toLowerCase();
    if (val === "complete" || val === "completed") {
      out._completed = true;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------

interface ParsedEntry {
  mainTitle: string;
  altTitle1: string;
  altTitle2: string;
  synopsis: string;
  genres: string[];
  rating: number;
  chaptersOwned: number;
  chaptersRead: number;
  personalNotes: string;
  bookmarked: boolean;
  imageFilename: string;
  completed: boolean;
}

interface ConflictItem {
  entry: ParsedEntry;
  existing: MangaEntry;
  action: "skip" | "overwrite";
}

type ImportStep =
  | { kind: "select" }
  | { kind: "parsing" }
  | {
      kind: "conflicts";
      newEntries: ParsedEntry[];
      conflicts: ConflictItem[];
      dir: Map<string, File>;
    }
  | {
      kind: "importing";
      total: number;
      current: number;
      warnings: string[];
    }
  | {
      kind: "done";
      added: number;
      updated: number;
      skipped: number;
      warnings: string[];
    };

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  entries: MangaEntry[];
  favourites: Set<string>;
  onFavouritesChange: (next: Set<string>) => void;
  favKey: string;
}

export default function ImportModal({
  open,
  onClose,
  entries,
  favourites,
  onFavouritesChange,
}: ImportModalProps) {
  const [step, setStep] = useState<ImportStep>({ kind: "select" });
  const [jsonFile, setJsonFile] = useState<File | null>(null);
  const [imageFileMap, setImageFileMap] = useState<Map<string, File>>(
    new Map(),
  );
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const { mutateAsync: addEntry } = useAddEntry();
  const { mutateAsync: updateEntry } = useUpdateEntry();
  const { uploadFile } = useStorageClient();

  const reset = () => {
    setStep({ kind: "select" });
    setJsonFile(null);
    setImageFileMap(new Map());
  };

  const handleClose = () => {
    if (step.kind !== "importing") reset();
    onClose();
  };

  const handleJsonInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (file) setJsonFile(file);
  };

  const handleFolderInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const map = new Map<string, File>();
    for (const f of files) {
      const parts = f.webkitRelativePath
        ? f.webkitRelativePath.split("/")
        : [f.name];
      map.set(parts[parts.length - 1], f);
    }
    setImageFileMap(map);
  };

  const runImport = async (
    newEntries: ParsedEntry[],
    conflicts: ConflictItem[],
    imageFiles: Map<string, File>,
  ) => {
    const overwriteItems = conflicts.filter((c) => c.action === "overwrite");
    const skippedCount = conflicts.filter((c) => c.action === "skip").length;

    const toProcess = [
      ...newEntries.map((e) => ({
        entry: e,
        isOverwrite: false,
        existing: null as MangaEntry | null,
      })),
      ...overwriteItems.map((c) => ({
        entry: c.entry,
        isOverwrite: true,
        existing: c.existing,
      })),
    ];

    const total = toProcess.length + skippedCount;
    const warnings: string[] = [];
    let added = 0;
    let updated = 0;
    const newFavIds: string[] = [];

    setStep({ kind: "importing", total, current: 0, warnings: [] });

    for (let i = 0; i < toProcess.length; i++) {
      const { entry, isOverwrite, existing } = toProcess[i];

      setStep({
        kind: "importing",
        total,
        current: i + 1,
        warnings: [...warnings],
      });

      let coverImageKey: string | undefined;

      if (entry.imageFilename && imageFiles.size > 0) {
        const imageFile = imageFiles.get(entry.imageFilename) ?? null;
        if (!imageFile) {
          warnings.push(
            `Missing image for "${entry.mainTitle}": ${entry.imageFilename}`,
          );
        } else {
          try {
            coverImageKey = await retryAsync(() => uploadFile(imageFile));
          } catch {
            warnings.push(`Failed to upload image for "${entry.mainTitle}"`);
          }
        }
      } else if (entry.imageFilename && imageFiles.size === 0) {
        warnings.push(
          `No folder selected — skipping image for "${entry.mainTitle}"`,
        );
      }

      const finalCoverImageKey =
        coverImageKey !== undefined
          ? coverImageKey
          : isOverwrite && existing?.coverImageKey
            ? existing.coverImageKey
            : undefined;

      const altTitle = [entry.altTitle1, entry.altTitle2]
        .filter(Boolean)
        .join("||");

      const input: MangaEntryInput = {
        mainTitle: entry.mainTitle,
        altTitle,
        synopsis: entry.synopsis,
        genres: entry.genres,
        status: entry.completed
          ? Variant_Complete_Incomplete.Complete
          : Variant_Complete_Incomplete.Incomplete,
        rating: entry.rating,
        artRating: 0,
        cenLevel: 0,
        chaptersOwned: entry.chaptersOwned,
        chaptersRead: entry.chaptersRead,
        notes: entry.personalNotes,
        coverImageKey: finalCoverImageKey,
      };

      try {
        if (isOverwrite && existing) {
          await retryAsync(() => updateEntry({ id: existing.id, input }));
          updated++;
          if (entry.bookmarked) newFavIds.push(existing.id.toString());
        } else {
          const newId = await retryAsync(() => addEntry(input));
          added++;
          if (entry.bookmarked) newFavIds.push(newId.toString());
        }
      } catch (err) {
        console.error("Import entry error:", err);
        warnings.push(`Failed to import "${entry.mainTitle}"`);
      }

      // yield between entries to prevent event-loop starvation
      await new Promise((r) => setTimeout(r, 50));
    }

    if (newFavIds.length > 0) {
      const next = new Set(favourites);
      for (const id of newFavIds) next.add(id);
      onFavouritesChange(next);
    }

    setStep({
      kind: "done",
      added,
      updated,
      skipped: skippedCount,
      warnings,
    });
  };

  const handleStartImport = async () => {
    if (!jsonFile) return;
    setStep({ kind: "parsing" });

    try {
      const text = await jsonFile.text();
      const raw = JSON.parse(text);
      const rawArray: any[] = Array.isArray(raw) ? raw : [raw];

      // Normalise every record — maps field name variants to canonical names
      const parsed: ParsedEntry[] = rawArray
        .map((r: any) => {
          const n = normalizeRecord(r);
          const genres = Array.isArray(n.genres)
            ? n.genres.map(String)
            : typeof n.genres === "string"
              ? n.genres
                  .split(",")
                  .map((g: string) => g.trim())
                  .filter(Boolean)
              : [];
          return {
            mainTitle: String(n.mainTitle ?? "").trim(),
            altTitle1: String(n.altTitle1 ?? "").trim(),
            altTitle2: String(n.altTitle2 ?? "").trim(),
            synopsis: String(n.synopsis ?? "").trim(),
            genres,
            rating: Number(n.rating) || 0,
            chaptersOwned: Number(n.chaptersOwned) || 0,
            chaptersRead: Number(n.chaptersRead) || 0,
            personalNotes: String(n.personalNotes ?? "").trim(),
            bookmarked: Boolean(n.bookmarked),
            imageFilename: String(n.imageFilename ?? "").trim(),
            completed: Boolean(n._completed),
          } satisfies ParsedEntry;
        })
        .filter((e: ParsedEntry) => e.mainTitle !== "");

      if (parsed.length === 0) {
        toast.error("No valid entries found — check your JSON file");
        setStep({ kind: "select" });
        return;
      }

      // Separate into new entries vs. conflicts
      const newEntries: ParsedEntry[] = [];
      const conflicts: ConflictItem[] = [];

      for (const pe of parsed) {
        const existing = entries.find(
          (e) => e.mainTitle.toLowerCase() === pe.mainTitle.toLowerCase(),
        );
        if (existing) {
          conflicts.push({ entry: pe, existing, action: "skip" });
        } else {
          newEntries.push(pe);
        }
      }

      if (conflicts.length > 0) {
        setStep({
          kind: "conflicts",
          newEntries,
          conflicts,
          dir: imageFileMap,
        });
      } else {
        await runImport(newEntries, [], imageFileMap);
      }
    } catch (err) {
      console.error("Import parse error:", err);
      toast.error("Failed to parse file — check it is valid JSON");
      setStep({ kind: "select" });
    }
  };

  const updateConflictAction = (
    index: number,
    action: "skip" | "overwrite",
  ) => {
    setStep((prev) => {
      if (prev.kind !== "conflicts") return prev;
      const next = [...prev.conflicts];
      next[index] = { ...next[index], action };
      return { ...prev, conflicts: next };
    });
  };

  const setAllConflictActions = (action: "skip" | "overwrite") => {
    setStep((prev) => {
      if (prev.kind !== "conflicts") return prev;
      return {
        ...prev,
        conflicts: prev.conflicts.map((c) => ({ ...c, action })),
      };
    });
  };

  const handleBeginImport = async () => {
    if (step.kind !== "conflicts") return;
    await runImport(step.newEntries, step.conflicts, step.dir);
  };

  const getTitle = () => {
    switch (step.kind) {
      case "select":
        return "Import Collection";
      case "parsing":
        return "Reading File...";
      case "conflicts": {
        const n = step.conflicts.length;
        return `${n} duplicate ${n === 1 ? "entry" : "entries"} found`;
      }
      case "importing":
        return "Importing...";
      case "done":
        return "Import Complete";
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent
        data-ocid="import.dialog"
        className="max-w-2xl bg-card border-primary/30 text-foreground"
      >
        <input
          ref={jsonInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleJsonInputChange}
        />
        <input
          ref={folderInputRef}
          type="file"
          className="hidden"
          // @ts-ignore
          webkitdirectory=""
          mozdirectory=""
          multiple
          onChange={handleFolderInputChange}
        />
        <DialogHeader>
          <DialogTitle className="text-primary font-display text-lg">
            {getTitle()}
          </DialogTitle>
        </DialogHeader>

        {/* ── Step: Select ── */}
        {step.kind === "select" && (
          <div className="space-y-4 py-2">
            <p className="text-muted-foreground text-sm">
              Select a JSON export file and, optionally, the folder containing
              cover images. Field names are auto-mapped from any app export
              format.
            </p>

            {/* JSON File */}
            <div className="space-y-2">
              <button
                type="button"
                data-ocid="import.upload_button"
                onClick={() => jsonInputRef.current?.click()}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-dashed border-primary/30 hover:border-primary/60 bg-secondary/50 hover:bg-secondary transition-all text-sm text-muted-foreground hover:text-foreground"
              >
                <FileJson className="w-5 h-5 text-primary shrink-0" />
                <span className="flex-1 text-left">
                  {jsonFile ? (
                    <span className="text-foreground font-medium">
                      {jsonFile.name}
                    </span>
                  ) : (
                    "Select JSON File"
                  )}
                </span>
                <Upload className="w-4 h-4 shrink-0" />
              </button>
            </div>

            {/* Image Folder */}
            <div className="space-y-2">
              <button
                type="button"
                data-ocid="import.dropzone"
                onClick={() => folderInputRef.current?.click()}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-dashed border-border hover:border-primary/40 bg-secondary/30 hover:bg-secondary/60 transition-all text-sm text-muted-foreground hover:text-foreground"
              >
                <FolderOpen className="w-5 h-5 text-muted-foreground shrink-0" />
                <span className="flex-1 text-left">
                  {imageFileMap.size > 0 ? (
                    <span className="text-foreground font-medium">
                      {imageFileMap.size} images loaded
                    </span>
                  ) : (
                    <>
                      Select Image Folder{" "}
                      <span className="text-muted-foreground/50">
                        (optional)
                      </span>
                    </>
                  )}
                </span>
                <FolderOpen className="w-4 h-4 shrink-0" />
              </button>
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-border">
              <button
                type="button"
                data-ocid="import.cancel_button"
                onClick={handleClose}
                className="px-4 py-2 rounded-lg bg-secondary border border-border text-foreground hover:border-primary/30 transition-all text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                data-ocid="import.primary_button"
                onClick={handleStartImport}
                disabled={!jsonFile}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-accent transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Start Import
              </button>
            </div>
          </div>
        )}

        {/* ── Step: Parsing ── */}
        {step.kind === "parsing" && (
          <div className="flex items-center justify-center gap-3 py-10">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
            <p className="text-muted-foreground text-sm">Parsing file...</p>
          </div>
        )}

        {/* ── Step: Conflicts ── */}
        {step.kind === "conflicts" && (
          <div className="space-y-4 py-2">
            <p className="text-muted-foreground text-sm">
              Choose how to handle each duplicate. Entries marked{" "}
              <span className="text-primary font-medium">Overwrite</span> will
              replace the existing entry.
            </p>

            {/* Global actions */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground mr-1">
                Set all:
              </span>
              <button
                type="button"
                onClick={() => setAllConflictActions("skip")}
                className="px-3 py-1.5 rounded-lg border border-border bg-secondary text-muted-foreground hover:border-primary/30 hover:text-foreground transition-all text-xs"
              >
                Skip All
              </button>
              <button
                type="button"
                onClick={() => setAllConflictActions("overwrite")}
                className="px-3 py-1.5 rounded-lg border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-all text-xs"
              >
                Overwrite All
              </button>
            </div>

            {/* Conflict list */}
            <div
              style={{ overflowY: "auto", maxHeight: "288px" }}
              className="rounded-lg border border-border"
            >
              <div className="p-1">
                {step.conflicts.map((conflict, i) => (
                  <div
                    key={conflict.existing.id.toString()}
                    data-ocid={`import.item.${i + 1}`}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg hover:bg-secondary/50 transition-colors"
                  >
                    <span className="text-sm text-foreground truncate flex-1">
                      {conflict.entry.mainTitle}
                    </span>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        type="button"
                        data-ocid="import.toggle"
                        onClick={() => updateConflictAction(i, "skip")}
                        className={`px-3 py-1 rounded-md border text-xs font-medium transition-all ${
                          conflict.action === "skip"
                            ? "bg-primary/20 border-primary/60 text-primary"
                            : "bg-secondary border-border text-muted-foreground hover:border-primary/30"
                        }`}
                      >
                        Skip
                      </button>
                      <button
                        type="button"
                        data-ocid="import.toggle"
                        onClick={() => updateConflictAction(i, "overwrite")}
                        className={`px-3 py-1 rounded-md border text-xs font-medium transition-all ${
                          conflict.action === "overwrite"
                            ? "bg-primary/20 border-primary/60 text-primary"
                            : "bg-secondary border-border text-muted-foreground hover:border-primary/30"
                        }`}
                      >
                        Overwrite
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-border">
              <button
                type="button"
                data-ocid="import.cancel_button"
                onClick={handleClose}
                className="px-4 py-2 rounded-lg bg-secondary border border-border text-foreground hover:border-primary/30 transition-all text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                data-ocid="import.submit_button"
                onClick={handleBeginImport}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-accent transition-all"
              >
                Begin Import
              </button>
            </div>
          </div>
        )}

        {/* ── Step: Importing ── */}
        {step.kind === "importing" && (
          <div data-ocid="import.loading_state" className="space-y-4 py-2">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
              <p className="text-sm text-muted-foreground">
                Processing{" "}
                <span className="text-foreground font-medium">
                  {step.current}
                </span>{" "}
                of{" "}
                <span className="text-foreground font-medium">
                  {step.total}
                </span>
              </p>
            </div>

            <Progress
              value={step.total > 0 ? (step.current / step.total) * 100 : 0}
              className="h-2 bg-secondary [&>div]:bg-primary"
            />

            {step.warnings.length > 0 && (
              <ScrollArea className="max-h-32">
                <div className="space-y-1">
                  {step.warnings.map((w, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: stable warning accumulator
                    <div key={i} className="flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-400">{w}</p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        )}

        {/* ── Step: Done ── */}
        {step.kind === "done" && (
          <div data-ocid="import.success_state" className="space-y-4 py-2">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/10 border border-primary/20">
              <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
              <div className="flex gap-5 text-sm">
                <div>
                  <span className="text-primary font-bold text-lg">
                    {step.added}
                  </span>
                  <span className="text-muted-foreground ml-1">added</span>
                </div>
                <div>
                  <span className="text-primary font-bold text-lg">
                    {step.updated}
                  </span>
                  <span className="text-muted-foreground ml-1">updated</span>
                </div>
                <div>
                  <span className="text-muted-foreground font-bold text-lg">
                    {step.skipped}
                  </span>
                  <span className="text-muted-foreground ml-1">skipped</span>
                </div>
              </div>
            </div>

            {step.warnings.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
                  Warnings ({step.warnings.length})
                </p>
                <ScrollArea className="max-h-44 rounded-lg border border-amber-500/20 bg-amber-500/5">
                  <div className="p-3 space-y-1.5">
                    {step.warnings.map((w, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: stable final list
                      <div key={i} className="flex items-start gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-300/80">{w}</p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-border">
              <button
                type="button"
                data-ocid="import.close_button"
                onClick={handleClose}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-accent transition-all"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
