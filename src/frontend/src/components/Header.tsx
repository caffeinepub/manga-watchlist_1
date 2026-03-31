import { useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  LogOut,
  User,
} from "lucide-react";
import { useInternetIdentity } from "../hooks/useInternetIdentity";

interface HeaderProps {
  onAddClick: () => void;
  currentPage?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
}

export default function Header({
  currentPage,
  totalPages,
  onPageChange,
}: HeaderProps) {
  const { clear, identity } = useInternetIdentity();
  const queryClient = useQueryClient();

  const handleLogout = async () => {
    await clear();
    queryClient.clear();
  };

  const principalInitial = identity
    ? identity.getPrincipal().toString().charAt(0).toUpperCase()
    : "?";

  const showPagination =
    totalPages !== undefined &&
    totalPages > 1 &&
    currentPage !== undefined &&
    onPageChange;

  return (
    <header
      data-ocid="header.section"
      className="sticky top-0 z-50 w-full border-b border-border/50 bg-sidebar/80 backdrop-blur-md"
    >
      <div className="max-w-[1200px] mx-auto px-6 h-16 flex items-center gap-4">
        {/* Left: Logo */}
        <div className="flex items-center gap-2.5 shrink-0">
          <BookOpen className="w-5 h-5 text-primary" strokeWidth={1.5} />
          <span className="text-primary text-sm font-semibold tracking-widest uppercase hidden sm:block">
            Collection
          </span>
        </div>

        {/* Center spacer */}
        <div className="flex-1" />

        {/* Pagination controls */}
        {showPagination && (
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage <= 1}
              className="w-7 h-7 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-primary hover:border-primary/50 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs text-muted-foreground tabular-nums min-w-[4rem] text-center">
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="w-7 h-7 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:text-primary hover:border-primary/50 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Next page"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Right: Nav + Avatar */}
        <div className="flex items-center gap-4 shrink-0">
          <button
            type="button"
            data-ocid="header.link"
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors text-sm font-medium"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:block">Logout</span>
          </button>

          <div
            data-ocid="header.button"
            className="w-8 h-8 rounded-full gold-border flex items-center justify-center bg-secondary text-primary text-xs font-bold"
          >
            {principalInitial || <User className="w-4 h-4" />}
          </div>
        </div>
      </div>
    </header>
  );
}
