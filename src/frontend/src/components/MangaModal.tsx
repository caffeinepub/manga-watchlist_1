import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Image as ImageIcon, Loader2, Plus, Upload, X } from "lucide-react";
import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Variant_Complete_Incomplete } from "../backend";
import type { MangaEntry } from "../backend";
import { useAddEntry, useUpdateEntry } from "../hooks/useQueries";
import { useStorageClient } from "../hooks/useStorageClient";
import {
  fetchImageAsDataUrl,
  getCachedImage,
  setCachedImage,
} from "../utils/imageCache";

interface FormState {
  mainTitle: string;
  altTitles: string[];
  synopsis: string;
  genres: string[];
  status: "Complete" | "Incomplete";
  rating: number;
  chaptersOwned: number;
  chaptersRead: number;
  notes: string;
}

const defaultForm = (): FormState => ({
  mainTitle: "",
  altTitles: [],
  synopsis: "",
  genres: [],
  status: "Incomplete",
  rating: 0,
  chaptersOwned: 0,
  chaptersRead: 0,
  notes: "",
});

interface MangaModalProps {
  open: boolean;
  onClose: () => void;
  editEntry?: MangaEntry | null;
  existingGenres?: string[];
}

export default function MangaModal({
  open,
  onClose,
  editEntry,
  existingGenres,
}: MangaModalProps) {
  const [form, setForm] = useState<FormState>(defaultForm());
  const [coverImageKey, setCoverImageKey] = useState<string | undefined>();
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [genreInput, setGenreInput] = useState("");
  // Preserve existing artRating/cenLevel when editing so backend stays consistent
  const hiddenArtRating = useRef(0);
  const hiddenCenLevel = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { mutateAsync: addEntry } = useAddEntry();
  const { mutateAsync: updateEntry } = useUpdateEntry();
  const { uploadFile, getImageUrl } = useStorageClient();

  // Populate form when editing
  useEffect(() => {
    if (open) {
      if (editEntry) {
        setForm({
          mainTitle: editEntry.mainTitle,
          altTitles: editEntry.altTitle
            ? editEntry.altTitle.split("||").filter(Boolean)
            : [],
          synopsis: editEntry.synopsis,
          genres: editEntry.genres,
          status:
            editEntry.status === Variant_Complete_Incomplete.Complete
              ? "Complete"
              : "Incomplete",
          rating: editEntry.rating,
          chaptersOwned: editEntry.chaptersOwned,
          chaptersRead: editEntry.chaptersRead,
          notes: editEntry.notes,
        });
        hiddenArtRating.current = editEntry.artRating;
        hiddenCenLevel.current = editEntry.cenLevel;
        setCoverImageKey(editEntry.coverImageKey);
        setPendingFile(null);
        if (editEntry.coverImageKey) {
          const key = editEntry.coverImageKey;
          (async () => {
            const cached = await getCachedImage(key);
            if (cached) {
              setImagePreview(cached);
            } else {
              const url = await getImageUrl(key);
              if (url) {
                try {
                  const dataUrl = await fetchImageAsDataUrl(url);
                  await setCachedImage(key, dataUrl);
                  setImagePreview(dataUrl);
                } catch {
                  setImagePreview(url);
                }
              }
            }
          })();
        } else {
          setImagePreview(null);
        }
      } else {
        setForm(defaultForm());
        hiddenArtRating.current = 0;
        hiddenCenLevel.current = 0;
        setCoverImageKey(undefined);
        setImagePreview(null);
        setPendingFile(null);
      }
      setUploadProgress(null);
      setGenreInput("");
    }
  }, [open, editEntry, getImageUrl]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const addGenre = (raw: string) => {
    const genre = raw.trim();
    if (!genre) return;
    if (!form.genres.includes(genre)) {
      setField("genres", [...form.genres, genre]);
    }
    setGenreInput("");
  };

  const removeGenre = (genre: string) => {
    setField(
      "genres",
      form.genres.filter((g) => g !== genre),
    );
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    const previewUrl = URL.createObjectURL(file);
    setImagePreview(previewUrl);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.mainTitle.trim()) {
      toast.error("Main title is required");
      return;
    }

    setIsSaving(true);
    try {
      let finalImageKey = coverImageKey;

      if (pendingFile) {
        setUploadProgress(0);
        const hash = await uploadFile(pendingFile, (pct) => {
          setUploadProgress(pct);
        });
        finalImageKey = hash;
        setUploadProgress(100);
      }

      const input = {
        mainTitle: form.mainTitle.trim(),
        altTitle: form.altTitles.filter(Boolean).join("||"),
        synopsis: form.synopsis.trim(),
        coverImageKey: finalImageKey,
        genres: form.genres,
        status:
          form.status === "Complete"
            ? Variant_Complete_Incomplete.Complete
            : Variant_Complete_Incomplete.Incomplete,
        rating: Math.round(form.rating * 10) / 10,
        artRating: hiddenArtRating.current,
        cenLevel: hiddenCenLevel.current,
        chaptersOwned: Math.round(form.chaptersOwned * 10) / 10,
        chaptersRead: Math.round(form.chaptersRead * 10) / 10,
        notes: form.notes.trim(),
      };

      if (editEntry) {
        await updateEntry({ id: editEntry.id, input });
        toast.success("Entry updated");
      } else {
        await addEntry(input);
        toast.success("Manga added to collection");
      }

      onClose();
    } catch {
      toast.error(editEntry ? "Failed to update entry" : "Failed to add entry");
    } finally {
      setIsSaving(false);
      setUploadProgress(null);
    }
  };

  const inputCls =
    "w-full px-3 py-2.5 rounded-lg bg-input border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all text-sm";
  const labelCls =
    "block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5";
  const numberInputCls = `${inputCls} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        data-ocid="manga.modal"
        className="max-w-2xl w-full bg-card border-primary/40 shadow-gold-lg p-0 gap-0"
      >
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/50">
          <DialogTitle className="text-primary font-semibold text-lg">
            {editEntry ? "Edit Entry" : "Add to Collection"}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[75vh]">
          <form
            id="manga-form"
            onSubmit={handleSubmit}
            className="px-6 py-5 space-y-5"
          >
            {/* Main Title */}
            <div>
              <label htmlFor="manga-main-title" className={labelCls}>
                Main Title *
              </label>
              <input
                id="manga-main-title"
                data-ocid="manga.input"
                type="text"
                value={form.mainTitle}
                onChange={(e) => setField("mainTitle", e.target.value)}
                placeholder="e.g. One Piece"
                required
                className={inputCls}
              />
            </div>

            {/* Alternate titles */}
            <div>
              <p className={labelCls}>Alternate Titles</p>
              <div className="space-y-2">
                {form.altTitles.map((t, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: ordered list of inputs
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={t}
                      onChange={(e) => {
                        const next = [...form.altTitles];
                        next[i] = e.target.value;
                        setField("altTitles", next);
                      }}
                      placeholder={`Alternate title ${i + 1}`}
                      className={inputCls}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setField(
                          "altTitles",
                          form.altTitles.filter((_, idx) => idx !== i),
                        )
                      }
                      className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                      aria-label="Remove alternate title"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setField("altTitles", [...form.altTitles, ""])}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors mt-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Alternate Title
                </button>
              </div>
            </div>

            {/* Synopsis */}
            <div>
              <label htmlFor="manga-synopsis" className={labelCls}>
                Synopsis
              </label>
              <textarea
                id="manga-synopsis"
                data-ocid="manga.textarea"
                value={form.synopsis}
                onChange={(e) => setField("synopsis", e.target.value)}
                placeholder="Brief description..."
                rows={3}
                className={`${inputCls} resize-none`}
              />
            </div>

            {/* Cover Image */}
            <div>
              <p className={labelCls}>Cover Image</p>
              <div className="flex gap-4 items-start">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-24 aspect-[3/4] rounded-lg border border-dashed border-border hover:border-primary/50 bg-secondary flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors group shrink-0 p-0 overflow-hidden"
                  aria-label="Upload cover image"
                >
                  {imagePreview ? (
                    <img
                      src={imagePreview}
                      alt="Cover preview"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <>
                      <ImageIcon className="w-6 h-6 text-muted-foreground/50 group-hover:text-primary/50 transition-colors" />
                      <span className="text-[10px] text-muted-foreground/50">
                        Upload
                      </span>
                    </>
                  )}
                </button>
                <div className="flex-1 space-y-2">
                  <input
                    data-ocid="manga.upload_button"
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                    aria-label="Select image file"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 border border-border hover:border-primary/40 text-sm text-foreground transition-all"
                  >
                    <Upload className="w-4 h-4" />
                    {pendingFile ? pendingFile.name : "Choose Image"}
                  </button>
                  {uploadProgress !== null && (
                    <div className="space-y-1">
                      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all duration-300"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {uploadProgress < 100
                          ? `Uploading... ${uploadProgress}%`
                          : "Upload complete"}
                      </p>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground/50">
                    JPG, PNG, WebP — portrait aspect ratio recommended
                  </p>
                </div>
              </div>
            </div>

            {/* Genres — manual text input */}
            <div>
              <p className={labelCls}>Genres</p>
              {/* Added genre chips */}
              {form.genres.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {form.genres.map((genre) => (
                    <span
                      key={genre}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-primary/20 border border-primary/60 text-primary"
                    >
                      {genre}
                      <button
                        type="button"
                        onClick={() => removeGenre(genre)}
                        className="ml-0.5 hover:text-destructive transition-colors"
                        aria-label={`Remove ${genre}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {/* Quick add from existing genres */}
              {existingGenres &&
                existingGenres.filter((g) => !form.genres.includes(g)).length >
                  0 && (
                  <div className="mb-2">
                    <p className="text-[10px] text-muted-foreground/60 mb-1.5">
                      Quick add:
                    </p>
                    <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                      {existingGenres
                        .filter((g) => !form.genres.includes(g))
                        .map((genre) => (
                          <button
                            key={genre}
                            type="button"
                            onClick={() => addGenre(genre)}
                            className="px-2.5 py-1 rounded-full text-xs border border-border/60 text-muted-foreground hover:border-primary/50 hover:text-primary hover:bg-primary/10 transition-all"
                          >
                            + {genre}
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              {/* Input row */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={genreInput}
                  onChange={(e) => setGenreInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addGenre(genreInput);
                    }
                  }}
                  placeholder="Type a genre and press Enter"
                  className={`${inputCls} flex-1`}
                />
                <button
                  type="button"
                  onClick={() => addGenre(genreInput)}
                  className="px-3 py-2 rounded-lg bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition-all text-sm font-semibold shrink-0"
                  aria-label="Add genre"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Status */}
            <fieldset>
              <legend className={labelCls}>Status</legend>
              <div className="flex gap-3">
                {(["Incomplete", "Complete"] as const).map((s) => (
                  <label
                    key={s}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-all ${
                      form.status === s
                        ? "bg-primary/20 border-primary/60 text-primary"
                        : "bg-secondary border-border text-muted-foreground hover:border-primary/30"
                    }`}
                  >
                    <input
                      data-ocid="manga.radio"
                      type="radio"
                      name="status"
                      value={s}
                      checked={form.status === s}
                      onChange={() => setField("status", s)}
                      className="sr-only"
                    />
                    <span
                      className={`w-2 h-2 rounded-full ${
                        form.status === s
                          ? "bg-primary"
                          : "bg-muted-foreground/40"
                      }`}
                    />
                    <span className="text-sm">{s}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {/* Rating */}
            <div
              className="grid grid-cols-1 gap-4"
              style={{ maxWidth: "200px" }}
            >
              <div>
                <label htmlFor="manga-rating" className={labelCls}>
                  Rating (0–10)
                </label>
                <input
                  id="manga-rating"
                  type="number"
                  value={form.rating}
                  onChange={(e) =>
                    setField("rating", Number.parseFloat(e.target.value) || 0)
                  }
                  min={0}
                  max={10}
                  step={0.1}
                  className={numberInputCls}
                />
              </div>
            </div>

            {/* Chapters */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="manga-ch-owned" className={labelCls}>
                  Chapters Owned
                </label>
                <input
                  id="manga-ch-owned"
                  type="number"
                  value={form.chaptersOwned}
                  onChange={(e) =>
                    setField(
                      "chaptersOwned",
                      Number.parseFloat(e.target.value) || 0,
                    )
                  }
                  min={0}
                  step={0.1}
                  className={numberInputCls}
                />
              </div>
              <div>
                <label htmlFor="manga-ch-read" className={labelCls}>
                  Chapters Read
                </label>
                <input
                  id="manga-ch-read"
                  type="number"
                  value={form.chaptersRead}
                  onChange={(e) =>
                    setField(
                      "chaptersRead",
                      Number.parseFloat(e.target.value) || 0,
                    )
                  }
                  min={0}
                  step={0.1}
                  className={numberInputCls}
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label htmlFor="manga-notes" className={labelCls}>
                Personal Notes
              </label>
              <textarea
                id="manga-notes"
                value={form.notes}
                onChange={(e) => setField("notes", e.target.value)}
                placeholder="Your thoughts, arcs to revisit, spoilers..."
                rows={3}
                className={`${inputCls} resize-none`}
              />
            </div>
          </form>
        </ScrollArea>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border/50 flex justify-end gap-3">
          <button
            data-ocid="manga.cancel_button"
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="px-5 py-2.5 rounded-lg bg-secondary border border-border text-foreground hover:border-primary/30 transition-all text-sm disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            data-ocid="manga.save_button"
            type="submit"
            form="manga-form"
            disabled={isSaving}
            className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-accent transition-all text-sm disabled:opacity-50 shadow-gold"
          >
            {isSaving ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </span>
            ) : editEntry ? (
              "Save Changes"
            ) : (
              "Add to Collection"
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
