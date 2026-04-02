import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BookMarked,
  BookOpen,
  ChevronDown,
  Download,
  Heart,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import type { MangaEntry, Variant_Complete_Incomplete } from "../backend";
import { useInternetIdentity } from "../hooks/useInternetIdentity";
import {
  useAddEntry,
  useDeleteEntry,
  useGetEntries,
  useUpdateEntry,
} from "../hooks/useQueries";
import { useStorageClient } from "../hooks/useStorageClient";
import { exportWatchlist } from "../utils/exportWatchlist";
import { clearLocalCache, saveLastSynced } from "../utils/syncManager";
import Footer from "./Footer";
import Header from "./Header";
import ImportModal from "./ImportModal";
import MangaCard from "./MangaCard";
import MangaModal from "./MangaModal";

const ENTRIES_PER_PAGE = 30;

type SortKey = "title" | "title-desc" | "rating-desc" | "rating-asc";
type StatusFilter = "All" | "Complete" | "Incomplete";

function CardSkeleton() {
  return (
    <div
      className="gold-border rounded-xl bg-card overflow-hidden flex flex-row"
      style={{ width: "1100px", height: "110px" }}
    >
      <Skeleton
        className="bg-secondary shrink-0"
        style={{ width: "145px", height: "110px" }}
      />
      <div className="flex-1 p-3 space-y-2">
        <Skeleton className="h-4 w-3/4 bg-secondary" />
        <Skeleton className="h-3 w-1/2 bg-secondary" />
        <Skeleton className="h-3 w-full bg-secondary" />
      </div>
    </div>
  );
}

export default function WatchlistScreen() {
  const { identity } = useInternetIdentity();
  const principalStr = identity ? identity.getPrincipal().toString() : "anon";
  const favKey = `manga-favourites-${principalStr}`;

  const [searchQuery, setSearchQuery] = useState("");
  const [searchField, setSearchField] = useState<
    "title" | "notes" | "synopsis"
  >("title");
  const [showFavouritesOnly, setShowFavouritesOnly] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [genreFilter, setGenreFilter] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>("title");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editEntry, setEditEntry] = useState<MangaEntry | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const [confirmDelete, setConfirmDelete] = useState<bigint | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [showImport, setShowImport] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);

  // Favourites stored in localStorage, keyed per principal
  const [favourites, setFavourites] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(favKey);
      return stored
        ? new Set<string>(JSON.parse(stored) as string[])
        : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });

  const { data: entries = [], isLoading } = useGetEntries();
  const { mutateAsync: deleteEntry, isPending: isDeleting } = useDeleteEntry();
  const { mutateAsync: addEntry } = useAddEntry();
  const { mutateAsync: updateEntry } = useUpdateEntry();
  const { getImageUrl } = useStorageClient();

  // Close filter popup when clicking outside
  useEffect(() => {
    if (!showFilters) return;
    const handler = (e: MouseEvent) => {
      if (
        filterPanelRef.current &&
        !filterPanelRef.current.contains(e.target as Node) &&
        filterBtnRef.current &&
        !filterBtnRef.current.contains(e.target as Node)
      ) {
        setShowFilters(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showFilters]);

  // Genres that actually exist in the collection, sorted alphabetically
  const availableGenres = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) {
      for (const g of e.genres) set.add(g);
    }
    return Array.from(set).sort();
  }, [entries]);

  // Reset page when filters change
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on filter change
  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchQuery,
    searchField,
    showFavouritesOnly,
    statusFilter,
    genreFilter,
    sortBy,
  ]);

  // Drop any selected genres that no longer exist in the collection
  useEffect(() => {
    if (availableGenres.length > 0) {
      setGenreFilter((prev) => prev.filter((g) => availableGenres.includes(g)));
    } else {
      // All genres gone — clear filter
      setGenreFilter([]);
    }
  }, [availableGenres]);

  const filtered = entries
    .filter((e) => {
      if (showFavouritesOnly && !favourites.has(e.id.toString())) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (searchField === "title") {
          const altTitles = e.altTitle
            ? e.altTitle.split("||").filter(Boolean)
            : [];
          const matchesTitle =
            e.mainTitle.toLowerCase().includes(q) ||
            altTitles.some((t) => t.toLowerCase().includes(q));
          if (!matchesTitle) return false;
        } else if (searchField === "notes") {
          if (!e.notes.toLowerCase().includes(q)) return false;
        } else if (searchField === "synopsis") {
          if (!e.synopsis.toLowerCase().includes(q)) return false;
        }
      }
      if (statusFilter !== "All" && e.status !== statusFilter) return false;
      if (
        genreFilter.length > 0 &&
        !genreFilter.every((g) => e.genres.includes(g))
      )
        return false;
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "title":
          return a.mainTitle.localeCompare(b.mainTitle);
        case "title-desc":
          return b.mainTitle.localeCompare(a.mainTitle);
        case "rating-desc":
          return b.rating - a.rating;
        case "rating-asc":
          return a.rating - b.rating;
        default:
          return 0;
      }
    });

  const totalPages = Math.max(1, Math.ceil(filtered.length / ENTRIES_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedEntries = filtered.slice(
    (safePage - 1) * ENTRIES_PER_PAGE,
    safePage * ENTRIES_PER_PAGE,
  );

  const toggleFavourite = (id: bigint) => {
    setFavourites((prev) => {
      const next = new Set(prev);
      const key = id.toString();
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      try {
        localStorage.setItem(favKey, JSON.stringify([...next]));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const handleUpdateNotes = async (id: bigint, notes: string) => {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    try {
      await updateEntry({
        id,
        input: {
          mainTitle: entry.mainTitle,
          altTitle: entry.altTitle,
          synopsis: entry.synopsis,
          genres: entry.genres,
          status: entry.status,
          rating: entry.rating,
          artRating: entry.artRating,
          cenLevel: entry.cenLevel,
          chaptersOwned: entry.chaptersOwned,
          chaptersRead: entry.chaptersRead,
          coverImageKey: entry.coverImageKey,
          notes,
        },
      });
      toast.success("Notes saved");
    } catch {
      toast.error("Failed to save notes");
    }
  };

  const handleQuickUpdate = async (
    id: bigint,
    updates: Partial<{
      status: string;
      rating: number;
      chaptersOwned: number;
      chaptersRead: number;
    }>,
  ) => {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    try {
      await updateEntry({
        id,
        input: {
          mainTitle: entry.mainTitle,
          altTitle: entry.altTitle,
          synopsis: entry.synopsis,
          genres: entry.genres,
          status:
            updates.status !== undefined
              ? (updates.status as Variant_Complete_Incomplete)
              : entry.status,
          rating: updates.rating ?? entry.rating,
          artRating: entry.artRating,
          cenLevel: entry.cenLevel,
          chaptersOwned: updates.chaptersOwned ?? entry.chaptersOwned,
          chaptersRead: updates.chaptersRead ?? entry.chaptersRead,
          coverImageKey: entry.coverImageKey,
          notes: entry.notes,
        },
      });
      toast.success("Updated");
    } catch {
      toast.error("Failed to update");
    }
  };

  const handleDeleteRequest = (id: bigint) => {
    setConfirmDelete(id);
  };

  const confirmDeleteEntry = async () => {
    if (confirmDelete === null) return;
    const entryToDelete = entries.find((e) => e.id === confirmDelete);
    try {
      await deleteEntry(confirmDelete);
      setConfirmDelete(null);
      if (entryToDelete) {
        clearLocalCache(principalStr);
        saveLastSynced(principalStr, 0n);
        let undone = false;
        toast.success("Entry removed", {
          duration: 10000,
          action: {
            label: "Undo",
            onClick: async () => {
              if (undone) return;
              undone = true;
              try {
                const input = {
                  mainTitle: entryToDelete.mainTitle,
                  altTitle: entryToDelete.altTitle,
                  synopsis: entryToDelete.synopsis,
                  genres: entryToDelete.genres,
                  status: entryToDelete.status,
                  rating: entryToDelete.rating,
                  artRating: entryToDelete.artRating,
                  cenLevel: entryToDelete.cenLevel,
                  chaptersOwned: entryToDelete.chaptersOwned,
                  chaptersRead: entryToDelete.chaptersRead,
                  notes: entryToDelete.notes,
                  coverImageKey: entryToDelete.coverImageKey,
                };
                await addEntry(input);
                toast.success("Entry restored");
              } catch {
                toast.error("Failed to restore entry");
              }
            },
          },
        });
      } else {
        toast.success("Entry removed");
      }
    } catch {
      toast.error("Failed to delete entry");
      setConfirmDelete(null);
    }
  };

  const handleDeleteAll = async () => {
    const backup = [...entries];
    setIsDeletingAll(true);
    setShowDeleteAll(false);

    let failCount = 0;
    for (const e of backup) {
      try {
        await deleteEntry(e.id);
      } catch {
        failCount++;
      }
    }

    setIsDeletingAll(false);

    if (failCount > 0) {
      toast.warning(
        `Deleted ${backup.length - failCount} entries, ${failCount} failed`,
      );
      return;
    }

    clearLocalCache(principalStr);
    saveLastSynced(principalStr, 0n);
    let undone = false;
    toast.success(`Deleted all ${backup.length} entries`, {
      duration: 10000,
      action: {
        label: "Undo",
        onClick: async () => {
          if (undone) return;
          undone = true;
          try {
            for (const e of backup) {
              await addEntry({
                mainTitle: e.mainTitle,
                altTitle: e.altTitle,
                synopsis: e.synopsis,
                genres: e.genres,
                status: e.status,
                rating: e.rating,
                artRating: e.artRating,
                cenLevel: e.cenLevel,
                chaptersOwned: e.chaptersOwned,
                chaptersRead: e.chaptersRead,
                notes: e.notes,
                coverImageKey: e.coverImageKey,
              });
            }
            toast.success(`Restored ${backup.length} entries`);
          } catch {
            toast.error("Failed to restore entries");
          }
        },
      },
    });
  };

  const handleEdit = (entry: MangaEntry) => {
    setEditEntry(entry);
    setIsModalOpen(true);
  };

  const handleAddNew = () => {
    setEditEntry(null);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditEntry(null);
  };

  const toggleGenreFilter = (genre: string) => {
    setGenreFilter((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre],
    );
  };

  const handleExport = async () => {
    setIsExporting(true);
    const toastId = toast.loading("Preparing export...");
    try {
      await exportWatchlist(entries, favourites, getImageUrl, (msg) =>
        toast.loading(msg, { id: toastId }),
      );
      toast.success("Export complete!", { id: toastId });
    } catch {
      toast.error("Export failed", { id: toastId });
    } finally {
      setIsExporting(false);
    }
  };

  const completeCount = entries.filter((e) => e.status === "Complete").length;
  const incompleteCount = entries.filter(
    (e) => e.status === "Incomplete",
  ).length;
  const favouriteCount = entries.filter((e) =>
    favourites.has(e.id.toString()),
  ).length;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header
        onAddClick={handleAddNew}
        currentPage={safePage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
      />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="hero-gradient py-5 md:py-8 relative overflow-hidden">
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] rounded-full bg-primary/5 blur-[120px]" />
          </div>
          <div className="max-w-[1200px] mx-auto px-6 text-center relative z-10">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <button
                type="button"
                data-ocid="watchlist.primary_button"
                onClick={handleAddNew}
                className="px-4 py-1.5 rounded-full bg-primary text-primary-foreground font-semibold text-xs hover:bg-accent transition-all duration-200 shadow-gold inline-flex items-center gap-2"
              >
                <Plus className="w-3 h-3" />
                Add New Manga
              </button>
            </motion.div>

            {/* Stats */}
            {entries.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
                className="flex items-center justify-center gap-5 mt-4 text-sm"
              >
                <div className="text-center">
                  <p className="text-primary font-bold text-2xl">
                    {entries.length}
                  </p>
                  <p className="text-muted-foreground text-xs uppercase tracking-wider">
                    Total
                  </p>
                </div>
                <div className="w-px h-8 bg-border" />
                <div className="text-center">
                  <p className="text-emerald-400 font-bold text-2xl">
                    {completeCount}
                  </p>
                  <p className="text-muted-foreground text-xs uppercase tracking-wider">
                    Complete
                  </p>
                </div>
                <div className="w-px h-8 bg-border" />
                <div className="text-center">
                  <p className="text-amber-400 font-bold text-2xl">
                    {incompleteCount}
                  </p>
                  <p className="text-muted-foreground text-xs uppercase tracking-wider">
                    Reading
                  </p>
                </div>
                {favouriteCount > 0 && (
                  <>
                    <div className="w-px h-8 bg-border" />
                    <div className="text-center">
                      <p
                        className="font-bold text-2xl"
                        style={{ color: "#ec4899" }}
                      >
                        {favouriteCount}
                      </p>
                      <p className="text-muted-foreground text-xs uppercase tracking-wider">
                        Favourited
                      </p>
                    </div>
                  </>
                )}
              </motion.div>
            )}
          </div>
        </section>

        {/* Collection Section */}
        <section className="max-w-[1200px] mx-auto px-6 py-10">
          {/* Section header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <BookMarked className="w-5 h-5 text-primary" />
              <h2 className="text-primary font-bold text-xl tracking-tight">
                My Collection
                {filtered.length > 0 && (
                  <span className="ml-2 text-muted-foreground text-sm font-normal">
                    ({filtered.length})
                  </span>
                )}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {/* Export button */}
              <button
                type="button"
                data-ocid="watchlist.secondary_button"
                onClick={handleExport}
                disabled={isExporting || entries.length === 0}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:border-primary/30 hover:text-primary transition-all text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
                {isExporting ? "Exporting..." : "Export"}
              </button>
              {/* Import button */}
              <button
                type="button"
                data-ocid="watchlist.open_modal_button"
                onClick={() => setShowImport(true)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:border-primary/30 hover:text-primary transition-all text-sm"
              >
                <Upload className="w-4 h-4" />
                Import
              </button>
              {/* Delete All button */}
              {entries.length > 0 && (
                <button
                  type="button"
                  data-ocid="watchlist.delete_button"
                  onClick={() => setShowDeleteAll(true)}
                  disabled={isDeletingAll}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:border-destructive/50 hover:text-destructive transition-all text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-4 h-4" />
                  {isDeletingAll ? "Deleting..." : "Delete All"}
                </button>
              )}
              {/* Favourites toggle */}
              <button
                type="button"
                data-ocid="watchlist.toggle"
                onClick={() => setShowFavouritesOnly(!showFavouritesOnly)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-all ${
                  showFavouritesOnly
                    ? "border-pink-500/50 text-pink-400 bg-pink-500/10"
                    : "border-border text-muted-foreground hover:border-pink-400/30"
                }`}
                aria-pressed={showFavouritesOnly}
              >
                <Heart
                  className="w-4 h-4"
                  style={{
                    fill: showFavouritesOnly ? "#ec4899" : "none",
                    stroke: showFavouritesOnly ? "#ec4899" : "currentColor",
                  }}
                />
                Favourites
              </button>
              {/* Filters toggle */}
              <button
                ref={filterBtnRef}
                type="button"
                data-ocid="watchlist.tab"
                onClick={() => {
                  setShowFilters(!showFilters);
                }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-all ${
                  showFilters
                    ? "border-primary/50 text-primary bg-primary/10"
                    : "border-border text-muted-foreground hover:border-primary/30"
                }`}
              >
                <SlidersHorizontal className="w-4 h-4" />
                Filters
                {genreFilter.length > 0 && (
                  <span className="ml-1 bg-primary/20 text-primary text-xs px-1.5 py-0.5 rounded-full font-semibold">
                    {genreFilter.length}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Search + Sort bar row */}
          <div className="flex items-center gap-2 mb-6">
            {/* Search field selector */}
            <div className="relative">
              <select
                data-ocid="watchlist.select"
                value={searchField}
                onChange={(e) =>
                  setSearchField(
                    e.target.value as "title" | "notes" | "synopsis",
                  )
                }
                className="appearance-none pl-3 pr-8 py-2 rounded-lg bg-input border border-border text-foreground text-sm focus:outline-none focus:border-primary/50 cursor-pointer"
              >
                <option value="title">Title</option>
                <option value="notes">Notes</option>
                <option value="synopsis">Synopsis</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            </div>
            {/* Search input */}
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                data-ocid="watchlist.search_input"
                type="text"
                placeholder={`Search by ${searchField}...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-10 py-2 rounded-lg bg-input border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Clear search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            {/* Standalone Sort dropdown */}
            <div className="relative">
              <select
                data-ocid="watchlist.select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
                className="appearance-none pl-3 pr-8 py-2 rounded-lg bg-input border border-border text-foreground text-sm focus:outline-none focus:border-primary/50 cursor-pointer"
                style={{
                  color: "#C8A24A",
                  borderColor: "rgba(200,162,74,0.3)",
                }}
              >
                <option value="title" style={{ color: "inherit" }}>
                  A-Z
                </option>
                <option value="title-desc" style={{ color: "inherit" }}>
                  Z-A
                </option>
                <option value="rating-desc" style={{ color: "inherit" }}>
                  Rating ↓
                </option>
                <option value="rating-asc" style={{ color: "inherit" }}>
                  Rating ↑
                </option>
              </select>
              <ChevronDown
                className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
                style={{ color: "#C8A24A" }}
              />
            </div>
          </div>

          <div>
            {/* Card List - now full width */}
            <div className="min-w-0 overflow-x-auto">
              {isLoading ? (
                <div
                  data-ocid="watchlist.loading_state"
                  className="flex flex-col gap-2"
                >
                  {Array.from({ length: 6 }).map((_, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
                    <CardSkeleton key={i} />
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <motion.div
                  data-ocid="watchlist.empty_state"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center justify-center gap-5 py-24 text-center"
                >
                  <div className="w-20 h-20 rounded-2xl gold-border flex items-center justify-center bg-card">
                    <BookOpen
                      className="w-10 h-10 text-primary/50"
                      strokeWidth={1}
                    />
                  </div>
                  <div>
                    <p className="text-foreground font-semibold text-lg mb-1">
                      {entries.length === 0
                        ? "Your collection is empty"
                        : "No matches found"}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {entries.length === 0
                        ? "Start building your manga library."
                        : "Try adjusting your filters."}
                    </p>
                  </div>
                  {entries.length === 0 && (
                    <button
                      type="button"
                      data-ocid="watchlist.secondary_button"
                      onClick={handleAddNew}
                      className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:bg-accent transition-all shadow-gold"
                    >
                      <Plus className="w-4 h-4" />
                      Add First Manga
                    </button>
                  )}
                </motion.div>
              ) : (
                <div className="flex flex-col gap-2">
                  {paginatedEntries.map((entry, i) => (
                    // Outer row: card + external edit/delete buttons
                    <div
                      key={entry.id.toString()}
                      className="flex flex-row items-center gap-3 group/row"
                    >
                      <MangaCard
                        entry={entry}
                        index={i}
                        isFavourited={favourites.has(entry.id.toString())}
                        onToggleFavourite={toggleFavourite}
                        onUpdateNotes={handleUpdateNotes}
                        onQuickUpdate={handleQuickUpdate}
                      />

                      {/* Edit / Delete — outside the card, fade in on row hover */}
                      <div className="flex flex-col gap-2 opacity-0 group-hover/row:opacity-100 transition-opacity duration-200 shrink-0">
                        <button
                          type="button"
                          data-ocid={`manga.edit_button.${i + 1}`}
                          onClick={() => handleEdit(entry)}
                          className="p-2 rounded-lg bg-card hover:bg-primary/20 border border-border/50 hover:border-primary/50 text-muted-foreground hover:text-primary transition-all"
                          aria-label="Edit entry"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          data-ocid={`manga.delete_button.${i + 1}`}
                          onClick={() => handleDeleteRequest(entry.id)}
                          className="p-2 rounded-lg bg-card hover:bg-destructive/20 border border-border/50 hover:border-destructive/50 text-muted-foreground hover:text-destructive transition-all"
                          aria-label="Delete entry"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Bottom pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-8">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                    className="px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-primary hover:border-primary/50 transition-all disabled:opacity-30 disabled:cursor-not-allowed text-sm"
                  >
                    Previous
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                    (page) => (
                      <button
                        type="button"
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`w-8 h-8 rounded-lg border text-sm transition-all ${
                          page === safePage
                            ? "border-primary/60 bg-primary/20 text-primary font-semibold"
                            : "border-border text-muted-foreground hover:border-primary/40 hover:text-primary"
                        }`}
                      >
                        {page}
                      </button>
                    ),
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setCurrentPage((p) => Math.min(totalPages, p + 1))
                    }
                    disabled={safePage >= totalPages}
                    className="px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-primary hover:border-primary/50 transition-all disabled:opacity-30 disabled:cursor-not-allowed text-sm"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Filter popup - fixed overlay via portal */}
          {showFilters &&
            createPortal(
              <div
                ref={filterPanelRef}
                style={{
                  position: "fixed",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  zIndex: 9999,
                  width: "280px",
                  maxHeight: "80vh",
                  overflowY: "auto",
                }}
              >
                <motion.div
                  data-ocid="watchlist.panel"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="gold-border rounded-xl bg-card p-4 space-y-5"
                >
                  {/* Status filter */}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      Status
                    </p>
                    <div className="space-y-1">
                      {(
                        ["All", "Incomplete", "Complete"] as StatusFilter[]
                      ).map((s) => (
                        <button
                          type="button"
                          key={s}
                          data-ocid="watchlist.tab"
                          onClick={() => setStatusFilter(s)}
                          className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-all ${
                            statusFilter === s
                              ? "bg-primary/20 text-primary border border-primary/40"
                              : "text-muted-foreground hover:bg-secondary border border-transparent"
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Genre filter — only shows genres that exist in the collection */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Genre
                        {genreFilter.length > 0 && (
                          <span className="ml-1 text-primary">
                            ({genreFilter.length} AND)
                          </span>
                        )}
                      </p>
                      {genreFilter.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setGenreFilter([])}
                          className="text-[10px] text-muted-foreground hover:text-primary transition-colors"
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    {availableGenres.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground/40 italic">
                        No genres in collection
                      </p>
                    ) : (
                      <div className="space-y-1 max-h-52 overflow-y-auto">
                        {availableGenres.map((genre) => {
                          const active = genreFilter.includes(genre);
                          return (
                            <button
                              type="button"
                              key={genre}
                              onClick={() => toggleGenreFilter(genre)}
                              className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all ${
                                active
                                  ? "bg-primary/20 text-primary border border-primary/40"
                                  : "text-muted-foreground hover:bg-secondary border border-transparent"
                              }`}
                            >
                              <span
                                className={`w-3 h-3 rounded border shrink-0 flex items-center justify-center ${
                                  active
                                    ? "border-primary bg-primary/30"
                                    : "border-border"
                                }`}
                              >
                                {active && (
                                  <span className="w-1.5 h-1.5 rounded-sm bg-primary" />
                                )}
                              </span>
                              {genre}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </motion.div>
              </div>,
              document.body,
            )}
        </section>
      </main>

      <Footer />

      {/* Add/Edit Modal */}
      <MangaModal
        open={isModalOpen}
        onClose={handleCloseModal}
        editEntry={editEntry}
        existingGenres={availableGenres}
      />

      {/* Import Modal */}
      <ImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
        entries={entries}
        favourites={favourites}
        onFavouritesChange={(next) => {
          setFavourites(next);
          try {
            localStorage.setItem(favKey, JSON.stringify([...next]));
          } catch {
            // ignore
          }
        }}
        favKey={favKey}
      />

      {/* Delete All confirmation overlay */}
      {showDeleteAll && (
        <div
          data-ocid="manga.dialog"
          role="presentation"
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          onClick={(e) =>
            e.target === e.currentTarget && setShowDeleteAll(false)
          }
          onKeyDown={(e) => e.key === "Escape" && setShowDeleteAll(false)}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="gold-border rounded-xl bg-card p-6 max-w-sm w-full mx-4 space-y-4"
          >
            <div className="flex items-center gap-3">
              <Trash2 className="w-5 h-5 text-destructive" />
              <h3 className="font-semibold text-foreground">
                Delete All Manga
              </h3>
            </div>
            <p className="text-muted-foreground text-sm">
              Are you sure? This will delete all {entries.length} manga{" "}
              {entries.length === 1 ? "entry" : "entries"} from your collection.
              You will have 10 seconds to undo this action.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                data-ocid="manga.cancel_button"
                onClick={() => setShowDeleteAll(false)}
                className="px-4 py-2 rounded-lg bg-secondary border border-border text-foreground hover:border-primary/30 transition-all text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                data-ocid="manga.confirm_button"
                onClick={handleDeleteAll}
                className="px-4 py-2 rounded-lg bg-destructive/20 border border-destructive/50 text-destructive hover:bg-destructive/30 transition-all text-sm"
              >
                Delete All
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Delete confirmation overlay */}
      {confirmDelete !== null && (
        <div
          data-ocid="manga.dialog"
          role="presentation"
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          onClick={(e) =>
            e.target === e.currentTarget && setConfirmDelete(null)
          }
          onKeyDown={(e) => e.key === "Escape" && setConfirmDelete(null)}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="gold-border rounded-xl bg-card p-6 max-w-sm w-full mx-4 space-y-4"
          >
            <div className="flex items-center gap-3">
              <Trash2 className="w-5 h-5 text-destructive" />
              <h3
                id="delete-dialog-title"
                className="font-semibold text-foreground"
              >
                Remove Entry
              </h3>
            </div>
            <p className="text-muted-foreground text-sm">
              Are you sure you want to remove this manga from your collection?
              This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                data-ocid="manga.cancel_button"
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 rounded-lg bg-secondary border border-border text-foreground hover:border-primary/30 transition-all text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                data-ocid="manga.confirm_button"
                onClick={confirmDeleteEntry}
                disabled={isDeleting}
                className="px-4 py-2 rounded-lg bg-destructive/20 border border-destructive/50 text-destructive hover:bg-destructive/30 transition-all text-sm disabled:opacity-50"
              >
                {isDeleting ? "Removing..." : "Remove"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
