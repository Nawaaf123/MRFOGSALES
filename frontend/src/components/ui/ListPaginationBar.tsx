import { Button } from "@/components/ui/button";
import { pageCount } from "@/lib/pagination";
import { ChevronLeft, ChevronRight } from "lucide-react";

type ListPaginationBarProps = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
  /** e.g. "shops" → "Showing 1–20 of 317 shops" */
  itemLabel?: string;
};

export function ListPaginationBar({
  page,
  pageSize,
  total,
  onPageChange,
  className,
  itemLabel,
}: ListPaginationBarProps) {
  const pages = pageCount(total, pageSize);
  if (total <= pageSize) return null;

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div
      className={`flex flex-col items-center justify-between gap-3 sm:flex-row ${className || ""}`}
    >
      <p className="text-sm text-muted-foreground">
        Showing {from}–{to} of {total}
        {itemLabel ? ` ${itemLabel}` : ""}
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Previous
        </Button>
        <span className="min-w-[5.5rem] text-center text-sm text-muted-foreground">
          Page {page} / {pages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
