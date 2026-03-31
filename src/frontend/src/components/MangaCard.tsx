import { BookOpen, Heart, NotebookPen, Star } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MangaEntry } from "../backend";
import { Variant_Complete_Incomplete } from "../backend";
import { useStorageClient } from "../hooks/useStorageClient";
import {
  fetchImageAsDataUrl,
  getCachedImage,
  setCachedImage,
} from "../utils/imageCache";

type QuickEditField = "status" | "rating" | "chaptersOwned" | "chaptersRead";

interface QuickEditState {
  field: QuickEditField;
  value: string;
  top: number;
  left: number;
}

interface ChaptersBothState {
  readValue: string;
  ownedValue: string;
  top: number;
  left: number;
}

interface MangaCardProps {
  entry: MangaEntry;
  index: number;
  isFavourited: boolean;
  onToggleFavourite: (id: bigint) => void;
  onUpdateNotes: (id: bigint, notes: string) => void;
  onQuickUpdate: (
    id: bigint,
    updates: Partial<{
      status: string;
      rating: number;
      chaptersOwned: number;
      chaptersRead: number;
    }>,
  ) => void;
}

const FIELD_LABELS: Record<QuickEditField, string> = {
  status: "Status",
  rating: "Rating",
  chaptersOwned: "Owned",
  chaptersRead: "Read",
};

function calcPopupPos(
  rect: DOMRect,
  popupH: number,
  popupW: number,
): { top: number; left: number } {
  const m = 8;
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  let top = rect.bottom + 6;
  let left = rect.left + rect.width / 2 - popupW / 2;
  if (top + popupH > vh - m) top = rect.top - popupH - 6;
  if (left < m) left = m;
  if (left + popupW > vw - m) left = vw - popupW - m;
  if (top < m) top = m;
  return { top, left };
}

// Vertical-scrolling, word-wrapping title component
function ScrollingTitle({
  title,
  className,
}: {
  title: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const singleRef = useRef<HTMLDivElement>(null);
  const [shouldScroll, setShouldScroll] = useState(false);
  const [duration, setDuration] = useState(8);
  const [isPaused, setIsPaused] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refs are stable, title triggers remeasure
  useEffect(() => {
    const measure = () => {
      if (containerRef.current && singleRef.current) {
        const containerH = containerRef.current.clientHeight;
        const singleH = singleRef.current.scrollHeight;
        if (singleH > containerH) {
          setShouldScroll(true);
          setDuration(Math.max(8, (singleH + 22) / 7.5));
        } else {
          setShouldScroll(false);
        }
      }
    };
    measure();
    const t = setTimeout(measure, 100);
    return () => clearTimeout(t);
  }, [title]);

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden h-full ${className ?? ""}`}
    >
      {shouldScroll ? (
        <div
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
          style={{
            animation: `marquee-vertical-loop ${duration}s linear infinite`,
            animationPlayState: isPaused ? "paused" : "running",
            wordBreak: "break-word",
            whiteSpace: "normal",
          }}
        >
          <div ref={singleRef}>{title}</div>
          <div aria-hidden style={{ height: "1.4em" }} />
          <div aria-hidden>{title}</div>
          <div aria-hidden style={{ height: "1.4em" }} />
        </div>
      ) : (
        <div
          ref={singleRef}
          style={{ wordBreak: "break-word", whiteSpace: "normal" }}
        >
          {title}
        </div>
      )}
    </div>
  );
}

export default function MangaCard({
  entry,
  index,
  isFavourited,
  onToggleFavourite,
  onUpdateNotes,
  onQuickUpdate,
}: MangaCardProps) {
  const cardRef = useRef<HTMLElement>(null);
  const notebookBtnRef = useRef<HTMLButtonElement>(null);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [titleIndex, setTitleIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  // Cover popup
  const [hoverPopup, setHoverPopup] = useState(false);
  const [popupTitleIndex, setPopupTitleIndex] = useState(0);
  const [coverPopupPos, setCoverPopupPos] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Notes popup
  const [noteVisible, setNoteVisible] = useState(false);
  const [noteEditing, setNoteEditing] = useState(false);
  const [noteText, setNoteText] = useState(entry.notes);
  const [notePopupPos, setNotePopupPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const noteHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset popup title index when popup closes
  useEffect(() => {
    if (!hoverPopup) setPopupTitleIndex(0);
  }, [hoverPopup]);

  // Quick edit (status, rating)
  const [quickEdit, setQuickEdit] = useState<QuickEditState | null>(null);

  // Combined chapters edit
  const [chaptersBothEdit, setChaptersBothEdit] =
    useState<ChaptersBothState | null>(null);

  const { getImageUrl } = useStorageClient();

  // Lazy load: only start fetching once the card scrolls into view
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([ioEntry]) => {
        if (ioEntry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // IDB-first image load
  // biome-ignore lint/correctness/useExhaustiveDependencies: retryKey is an intentional re-run trigger
  useEffect(() => {
    if (!isVisible || !entry.coverImageKey) return;
    let cancelled = false;

    async function loadImage() {
      const key = entry.coverImageKey!;

      // 1. Try IDB cache first
      const cached = await getCachedImage(key);
      if (cached) {
        if (!cancelled) setImageUrl(cached);
        return;
      }

      // 2. Need network – bail if offline
      if (!navigator.onLine) return;

      try {
        const networkUrl = await getImageUrl(key);
        if (!networkUrl) return;
        const dataUrl = await fetchImageAsDataUrl(networkUrl);
        if (!cancelled) setImageUrl(dataUrl);
        setCachedImage(key, dataUrl); // fire-and-forget
      } catch {
        // Compression failed, try raw URL as fallback
        try {
          const networkUrl = await getImageUrl(key);
          if (networkUrl && !cancelled) setImageUrl(networkUrl);
        } catch {
          if (!cancelled) setImageError(true);
        }
      }
    }

    loadImage();
    return () => {
      cancelled = true;
    };
  }, [isVisible, entry.coverImageKey, getImageUrl, retryKey]);

  // Retry when coming back online
  useEffect(() => {
    if (!entry.coverImageKey || imageUrl) return;
    const handleOnline = () => {
      if (isVisible) {
        setImageError(false);
        setRetryKey((k) => k + 1);
      }
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [entry.coverImageKey, imageUrl, isVisible]);

  useEffect(() => {
    if (!noteEditing) setNoteText(entry.notes);
  }, [entry.notes, noteEditing]);

  const altTitles = entry.altTitle
    ? entry.altTitle.split("||").filter(Boolean)
    : [];
  const totalTitles = 1 + altTitles.length;
  const displayTitle =
    titleIndex === 0 ? entry.mainTitle : altTitles[titleIndex - 1];

  const isComplete = entry.status === Variant_Complete_Incomplete.Complete;
  const ratingHigh = entry.rating >= 8;
  const hasNotes = entry.notes.trim().length > 0;

  const genreCol1 = entry.genres.slice(0, 4);
  const genreCol2 = entry.genres.slice(4, 8);
  const genreOverflow = Math.max(0, entry.genres.length - 8);

  // ── Cover hover ───────────────────────────────────────────────
  const handleCoverMouseEnter = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect();
      const popupH = 600;
      const margin = 8;
      let top = rect.top + rect.height / 2 - 200;
      if (top < margin) top = margin;
      if (top + popupH > window.innerHeight - margin)
        top = window.innerHeight - margin - popupH;
      top = Math.max(margin, top);
      setCoverPopupPos({
        left: rect.left + 430,
        top,
      });
    }
    showTimerRef.current = setTimeout(() => setHoverPopup(true), 300);
  };
  const handleCoverMouseLeave = () => {
    if (showTimerRef.current) clearTimeout(showTimerRef.current);
    hideTimerRef.current = setTimeout(() => setHoverPopup(false), 500);
  };
  const handlePopupMouseEnter = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
  };
  const handlePopupMouseLeave = () => {
    setHoverPopup(false);
  };

  // ── Notes popup ───────────────────────────────────────────────
  const computeNotePos = () => {
    if (!notebookBtnRef.current) return;
    const rect = notebookBtnRef.current.getBoundingClientRect();
    const popupW = 260;
    const popupH = 200;
    let top = rect.top - popupH - 8;
    let left = rect.right - popupW;
    if (top < 8) top = rect.bottom + 8;
    if (left < 8) left = 8;
    setNotePopupPos({ top, left });
  };

  const handleNoteIconMouseEnter = () => {
    if (noteHideTimerRef.current) clearTimeout(noteHideTimerRef.current);
    computeNotePos();
    setNoteVisible(true);
  };
  const handleNoteIconMouseLeave = () => {
    if (noteEditing) return;
    noteHideTimerRef.current = setTimeout(() => setNoteVisible(false), 400);
  };
  const handleNotePopupMouseEnter = () => {
    if (noteHideTimerRef.current) clearTimeout(noteHideTimerRef.current);
  };
  const handleNotePopupMouseLeave = () => {
    if (noteEditing) return;
    noteHideTimerRef.current = setTimeout(() => setNoteVisible(false), 300);
  };
  const handleNoteIconClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    computeNotePos();
    setNoteVisible(true);
    setNoteEditing(true);
    setNoteText(entry.notes);
  };
  const handleNoteSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    onUpdateNotes(entry.id, noteText);
    setNoteEditing(false);
    setNoteVisible(false);
  };
  const handleNoteCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNoteEditing(false);
    setNoteText(entry.notes);
    setNoteVisible(false);
  };

  // ── Quick edit (status / rating) ──────────────────────────────
  const openQuickEdit = (
    e: React.MouseEvent<Element>,
    field: QuickEditField,
  ) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const popupW = 180;
    const popupH = field === "status" ? 108 : 122;
    const pos = calcPopupPos(rect, popupH, popupW);
    const value =
      field === "status"
        ? isComplete
          ? "Complete"
          : "Incomplete"
        : field === "rating"
          ? entry.rating.toString()
          : field === "chaptersOwned"
            ? entry.chaptersOwned.toString()
            : entry.chaptersRead.toString();
    setQuickEdit({ field, value, ...pos });
  };

  const saveQuickEdit = (overrideValue?: string) => {
    if (!quickEdit) return;
    const { field } = quickEdit;
    const val = overrideValue ?? quickEdit.value;
    if (field === "status") {
      onQuickUpdate(entry.id, { status: val });
    } else {
      const num = Number.parseFloat(val);
      if (!Number.isNaN(num)) {
        onQuickUpdate(entry.id, { [field]: Math.max(0, num) });
      }
    }
    setQuickEdit(null);
  };

  const getStep = (field: QuickEditField) =>
    field === "chaptersOwned" || field === "chaptersRead" ? "1" : "0.5";

  // ── Combined chapters edit ────────────────────────────────────
  const openChaptersBothEdit = (e: React.MouseEvent<Element>) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const popupW = 200;
    const popupH = 170;
    const pos = calcPopupPos(rect, popupH, popupW);
    setChaptersBothEdit({
      readValue: entry.chaptersRead.toString(),
      ownedValue: entry.chaptersOwned.toString(),
      ...pos,
    });
  };

  const saveChaptersBothEdit = () => {
    if (!chaptersBothEdit) return;
    const read = Number.parseFloat(chaptersBothEdit.readValue);
    const owned = Number.parseFloat(chaptersBothEdit.ownedValue);
    onQuickUpdate(entry.id, {
      chaptersRead: Number.isNaN(read) ? entry.chaptersRead : Math.max(0, read),
      chaptersOwned: Number.isNaN(owned)
        ? entry.chaptersOwned
        : Math.max(0, owned),
    });
    setChaptersBothEdit(null);
  };

  return (
    <>
      <motion.article
        ref={cardRef}
        data-ocid={`manga.item.${index + 1}`}
        initial={{ opacity: 0, x: -16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, delay: Math.min(index * 0.025, 0.25) }}
        className="gold-border rounded-xl bg-card overflow-visible flex flex-row group hover:shadow-gold transition-shadow duration-300 relative"
        style={{ width: "1100px", height: "110px", flexShrink: 0 }}
      >
        {/* ── Cover ── 145px ───────────────────────────────────── */}
        <div
          className="relative overflow-hidden rounded-l-xl shrink-0 cursor-pointer"
          style={{ width: "145px", height: "110px" }}
          onMouseEnter={handleCoverMouseEnter}
          onMouseLeave={handleCoverMouseLeave}
        >
          {imageUrl && !imageError ? (
            <img
              src={imageUrl}
              alt={entry.mainTitle}
              className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500"
              onError={() => setImageError(true)}
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-muted-foreground/40">
              <BookOpen className="w-8 h-8" strokeWidth={1} />
              <span className="text-[9px]">No Cover</span>
            </div>
          )}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 pointer-events-none" />
        </div>

        {/* ── Title Area ── 285px (50% wider than original 190px) ── */}
        <div
          className="flex items-start py-2 px-3 border-r border-transparent shrink-0 gap-1"
          style={{ width: "285px" }}
        >
          {/* Scrolling/wrapping title fills the inner height */}
          <div className="flex-1 overflow-hidden" style={{ height: "94px" }}>
            <ScrollingTitle
              title={displayTitle}
              className="text-foreground font-semibold text-sm"
            />
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setTitleIndex((i) => (i + 1) % totalTitles);
            }}
            className="shrink-0 font-bold rounded transition-colors hover:brightness-125 self-start"
            style={{
              color: "#8B6914",
              background: "transparent",
              border: "none",
              padding: "0",
              fontSize: "26px",
              fontWeight: "900",
              width: "32px",
              height: "54px",
              visibility: altTitles.length > 0 ? "visible" : "hidden",
            }}
            aria-label="Cycle to next title"
          >
            →
          </button>
        </div>

        {/* ── Status Column ── 150px ─────────────────────────────── */}
        <div
          className="flex flex-col justify-center items-center py-2 px-2 border-r border-transparent shrink-0 gap-1"
          style={{ width: "150px" }}
        >
          <button
            type="button"
            onClick={(e) => openQuickEdit(e, "status")}
            className="hover:bg-white/[0.03] transition-colors cursor-pointer rounded px-1"
            title="Edit status"
          >
            <span
              className={`text-[13px] font-bold text-center leading-tight ${
                isComplete ? "rainbow-text" : "text-amber-400"
              }`}
            >
              {isComplete ? "Complete" : "Incomplete"}
            </span>
          </button>
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Chapters
            </span>
            {/* Single click area opens combined edit for both chapters */}
            <button
              type="button"
              onClick={openChaptersBothEdit}
              className="flex items-center gap-0.5 hover:text-primary hover:bg-primary/10 transition-colors px-1 py-0.5 rounded cursor-pointer"
              title="Edit chapters read and owned"
              style={{ fontSize: "12px" }}
            >
              <span>{entry.chaptersRead.toFixed(1)}</span>
              <span className="text-muted-foreground">/</span>
              <span>{entry.chaptersOwned.toFixed(1)}</span>
            </button>
          </div>
        </div>

        {/* ── Rating Column ── 80px ────────────────── */}
        <div
          className="flex flex-col justify-center py-2 px-3 border-r border-transparent shrink-0 gap-0.5"
          style={{ width: "80px" }}
        >
          <button
            type="button"
            onClick={(e) => openQuickEdit(e, "rating")}
            className="flex items-center justify-between w-full hover:bg-white/[0.03] px-0.5 rounded transition-colors cursor-pointer"
            title="Edit rating"
          >
            <span className="text-muted-foreground flex items-center gap-0.5">
              <Star
                className="w-3.5 h-3.5"
                style={{ color: "#C8A24A", fill: "#C8A24A" }}
              />
            </span>
            <span
              className={`text-[15px] font-bold ${ratingHigh ? "rainbow-text" : "text-primary"}`}
            >
              {entry.rating.toFixed(1)}
            </span>
          </button>
        </div>

        {/* ── Genres Column ── flex-1 ───────────────────────────── */}
        <div className="flex flex-col justify-center py-2 px-3 flex-1 min-w-0">
          {entry.genres.length > 0 ? (
            <div>
              <div className="flex gap-2">
                <div className="flex flex-col gap-1 min-w-0">
                  {genreCol1.map((genre) => (
                    <span
                      key={genre}
                      className="text-[11px] px-1.5 py-0.5 rounded border border-primary/30 text-primary/70 truncate leading-none block"
                    >
                      {genre}
                    </span>
                  ))}
                </div>
                {genreCol2.length > 0 && (
                  <div className="flex flex-col gap-1 min-w-0">
                    {genreCol2.map((genre) => (
                      <span
                        key={genre}
                        className="text-[11px] px-1.5 py-0.5 rounded border border-primary/30 text-primary/70 truncate leading-none block"
                      >
                        {genre}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {genreOverflow > 0 && (
                <span className="text-[9px] text-muted-foreground mt-0.5 block">
                  +{genreOverflow} more
                </span>
              )}
            </div>
          ) : (
            <span className="text-[9px] text-muted-foreground/30 italic">
              —
            </span>
          )}
        </div>

        {/* ── Actions ── 80px ──────────────────────────────────── */}
        <div
          className="flex flex-col justify-center items-center py-2 px-2 gap-2 shrink-0"
          style={{ width: "80px" }}
        >
          <button
            type="button"
            data-ocid={`manga.favourite_button.${index + 1}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavourite(entry.id);
            }}
            className="p-1 rounded-full transition-all duration-200 hover:scale-125 active:scale-95"
            aria-label={
              isFavourited ? "Remove from favourites" : "Add to favourites"
            }
            aria-pressed={isFavourited}
          >
            <Heart
              className="w-4 h-4 transition-colors duration-200"
              style={{
                fill: isFavourited ? "#ec4899" : "none",
                stroke: isFavourited ? "#ec4899" : "#6b7280",
              }}
            />
          </button>

          <button
            ref={notebookBtnRef}
            type="button"
            data-ocid={`manga.notes_button.${index + 1}`}
            onMouseEnter={handleNoteIconMouseEnter}
            onMouseLeave={handleNoteIconMouseLeave}
            onClick={handleNoteIconClick}
            className="p-1 rounded-full transition-all duration-200 hover:scale-125 active:scale-95"
            aria-label={hasNotes ? "View / edit notes" : "Add notes"}
          >
            <NotebookPen
              className="w-4 h-4 transition-colors duration-200"
              style={{ color: hasNotes ? "#ef4444" : "#6b7280" }}
            />
          </button>
        </div>
      </motion.article>

      {/* ── Portals: all floating UI rendered in document.body ── */}
      {createPortal(
        <>
          {/* Cover Hover Popup */}
          <AnimatePresence>
            {hoverPopup && coverPopupPos && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -8 }}
                transition={{ duration: 0.18 }}
                className="gold-border rounded-xl bg-card overflow-hidden flex flex-col"
                style={{
                  position: "fixed",
                  width: "300px",
                  height: "600px",
                  left: coverPopupPos.left,
                  top: coverPopupPos.top,
                  zIndex: 9999,
                  boxShadow:
                    "0 20px 60px rgba(0,0,0,0.85), 0 0 0 1px oklch(0.72 0.14 73 / 0.4)",
                }}
                onMouseEnter={handlePopupMouseEnter}
                onMouseLeave={handlePopupMouseLeave}
              >
                <div className="shrink-0" style={{ height: "300px" }}>
                  {imageUrl && !imageError ? (
                    <img
                      src={imageUrl}
                      alt={entry.mainTitle}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground/30">
                      <BookOpen className="w-12 h-12" strokeWidth={1} />
                    </div>
                  )}
                </div>
                <div className="px-4 pt-3 pb-1 shrink-0 flex items-start gap-1">
                  <div
                    className="flex-1 overflow-hidden"
                    style={{ height: "44px" }}
                  >
                    <ScrollingTitle
                      title={
                        popupTitleIndex === 0
                          ? entry.mainTitle
                          : altTitles[popupTitleIndex - 1]
                      }
                      className="text-foreground font-semibold text-sm"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPopupTitleIndex((i) => (i + 1) % totalTitles);
                    }}
                    className="shrink-0 font-bold rounded transition-colors hover:brightness-125"
                    style={{
                      visibility: altTitles.length > 0 ? "visible" : "hidden",
                      color: "#8B6914",
                      background: "transparent",
                      border: "none",
                      fontSize: "26px",
                      fontWeight: "900",
                      width: "32px",
                      height: "44px",
                      lineHeight: 1,
                      cursor: "pointer",
                    }}
                    aria-label="Next title"
                  >
                    ›
                  </button>
                </div>
                <div className="mx-4 my-2 border-t border-border/40 shrink-0" />
                <div className="flex-1 overflow-y-auto px-4 pb-4">
                  {entry.synopsis ? (
                    <p className="text-muted-foreground text-[14.3px] leading-relaxed">
                      {entry.synopsis}
                    </p>
                  ) : (
                    <p className="text-muted-foreground/30 text-[14.3px] italic">
                      No synopsis available.
                    </p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Notes Popup */}
          <AnimatePresence>
            {noteVisible && notePopupPos && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 6 }}
                transition={{ duration: 0.15 }}
                className="gold-border rounded-xl bg-card overflow-hidden"
                style={{
                  position: "fixed",
                  top: notePopupPos.top,
                  left: notePopupPos.left,
                  width: "260px",
                  zIndex: 9999,
                  boxShadow: "0 10px 40px rgba(0,0,0,0.8)",
                }}
                onMouseEnter={handleNotePopupMouseEnter}
                onMouseLeave={handleNotePopupMouseLeave}
              >
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <NotebookPen className="w-3 h-3 text-muted-foreground" />
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                        Notes
                      </p>
                    </div>
                    {!noteEditing && (
                      <button
                        type="button"
                        onClick={handleNoteIconClick}
                        className="text-[9px] text-primary/70 hover:text-primary transition-colors px-1.5 py-0.5 rounded border border-primary/30 hover:border-primary/60"
                      >
                        Edit
                      </button>
                    )}
                  </div>

                  {noteEditing ? (
                    <div className="flex flex-col gap-2">
                      <textarea
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            e.preventDefault();
                            setNoteEditing(false);
                            setNoteText(entry.notes);
                            setNoteVisible(false);
                          }
                        }}
                        className="w-full h-24 text-[11px] bg-background border border-border/50 rounded-lg p-2 text-foreground resize-none focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                        placeholder="Add your notes here..."
                        // biome-ignore lint/a11y/noAutofocus: intentional for inline editor
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="flex gap-2 justify-end">
                        <button
                          type="button"
                          onClick={handleNoteCancel}
                          className="text-[10px] px-2.5 py-1 rounded-lg bg-secondary text-muted-foreground hover:text-foreground border border-border transition-all"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleNoteSave}
                          className="text-[10px] px-2.5 py-1 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 border border-primary/40 transition-all font-semibold"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="max-h-32 overflow-y-auto">
                      {hasNotes ? (
                        <p className="text-[11px] text-foreground/70 leading-relaxed whitespace-pre-wrap">
                          {entry.notes}
                        </p>
                      ) : (
                        <p className="text-[11px] text-muted-foreground/40 italic">
                          No notes yet. Click to add.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Quick Edit Popup (status / rating) */}
          <AnimatePresence>
            {quickEdit && (
              <>
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss does not need keyboard equivalent */}
                <div
                  className="fixed inset-0"
                  style={{ zIndex: 9998 }}
                  onClick={() => setQuickEdit(null)}
                />
                <motion.div
                  key={quickEdit.field}
                  initial={{ opacity: 0, scale: 0.92, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.92, y: -4 }}
                  transition={{ duration: 0.12 }}
                  className="gold-border rounded-xl bg-card"
                  style={{
                    position: "fixed",
                    top: quickEdit.top,
                    left: quickEdit.left,
                    width: "180px",
                    zIndex: 9999,
                    boxShadow: "0 12px 40px rgba(0,0,0,0.85)",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="p-3">
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold mb-2">
                      {FIELD_LABELS[quickEdit.field]}
                    </p>

                    {quickEdit.field === "status" ? (
                      <div className="flex flex-col gap-1.5">
                        {(["Complete", "Incomplete"] as const).map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => saveQuickEdit(s)}
                            className={`w-full py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
                              (s === "Complete" ? isComplete : !isComplete)
                                ? "border-primary/60 bg-primary/20 text-primary"
                                : "border-border/50 text-muted-foreground hover:border-primary/30 hover:text-foreground"
                            }`}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <input
                          type="number"
                          value={quickEdit.value}
                          onChange={(e) =>
                            setQuickEdit((prev) =>
                              prev ? { ...prev, value: e.target.value } : null,
                            )
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              saveQuickEdit();
                            }
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setQuickEdit(null);
                            }
                          }}
                          step={getStep(quickEdit.field)}
                          min="0"
                          max={quickEdit.field === "rating" ? "10" : undefined}
                          className="w-full text-sm bg-background border border-border/50 rounded-lg px-2.5 py-1.5 text-foreground text-center font-semibold focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                          // biome-ignore lint/a11y/noAutofocus: intentional for quick edit
                          autoFocus
                          onFocus={(e) => e.target.select()}
                        />
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => setQuickEdit(null)}
                            className="flex-1 text-[10px] py-1 rounded-lg bg-secondary text-muted-foreground hover:text-foreground border border-border transition-all"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => saveQuickEdit()}
                            className="flex-1 text-[10px] py-1 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 border border-primary/40 transition-all font-semibold"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* Combined Chapters Edit Popup */}
          <AnimatePresence>
            {chaptersBothEdit && (
              <>
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss */}
                <div
                  className="fixed inset-0"
                  style={{ zIndex: 9998 }}
                  onClick={() => setChaptersBothEdit(null)}
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.92, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.92, y: -4 }}
                  transition={{ duration: 0.12 }}
                  className="gold-border rounded-xl bg-card"
                  style={{
                    position: "fixed",
                    top: chaptersBothEdit.top,
                    left: chaptersBothEdit.left,
                    width: "200px",
                    zIndex: 9999,
                    boxShadow: "0 12px 40px rgba(0,0,0,0.85)",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="p-3">
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider font-semibold mb-3">
                      Chapters
                    </p>
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-muted-foreground w-10 shrink-0">
                          Read
                        </span>
                        <input
                          type="number"
                          value={chaptersBothEdit.readValue}
                          onChange={(e) =>
                            setChaptersBothEdit((prev) =>
                              prev
                                ? { ...prev, readValue: e.target.value }
                                : null,
                            )
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              saveChaptersBothEdit();
                            }
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setChaptersBothEdit(null);
                            }
                          }}
                          step="1"
                          min="0"
                          className="flex-1 text-sm bg-background border border-border/50 rounded-lg px-2 py-1.5 text-foreground text-center font-semibold focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                          // biome-ignore lint/a11y/noAutofocus: intentional for quick edit
                          autoFocus
                          onFocus={(e) => e.target.select()}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-muted-foreground w-10 shrink-0">
                          Owned
                        </span>
                        <input
                          type="number"
                          value={chaptersBothEdit.ownedValue}
                          onChange={(e) =>
                            setChaptersBothEdit((prev) =>
                              prev
                                ? { ...prev, ownedValue: e.target.value }
                                : null,
                            )
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              saveChaptersBothEdit();
                            }
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setChaptersBothEdit(null);
                            }
                          }}
                          step="1"
                          min="0"
                          className="flex-1 text-sm bg-background border border-border/50 rounded-lg px-2 py-1.5 text-foreground text-center font-semibold focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                          onFocus={(e) => e.target.select()}
                        />
                      </div>
                      <div className="flex gap-1.5 mt-1">
                        <button
                          type="button"
                          onClick={() => setChaptersBothEdit(null)}
                          className="flex-1 text-[10px] py-1 rounded-lg bg-secondary text-muted-foreground hover:text-foreground border border-border transition-all"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={saveChaptersBothEdit}
                          className="flex-1 text-[10px] py-1 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 border border-primary/40 transition-all font-semibold"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </>,
        document.body,
      )}
    </>
  );
}
