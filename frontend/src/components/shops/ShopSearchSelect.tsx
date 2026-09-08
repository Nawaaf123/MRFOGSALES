import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { api, type ApiError } from "@/lib/api";
import { buildPageParams, type Paginated } from "@/lib/pagination";
import { useAuth } from "@/lib/auth";
import { isNetworkApiError } from "@/lib/invoiceCreateDraft";
import { loadOfflineShopsCache, saveOfflineShopsCache } from "@/lib/offlineCatalogCache";

export type ShopPickerOption = {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
};

type ShopSearchSelectProps = {
  value: string;
  /** Called with selected id ("all" when allowAll) and the shop row when applicable. */
  onChange: (value: string, shop: ShopPickerOption | null) => void;
  /** Show an "All shops" option (invoice list filter). */
  allowAll?: boolean;
  allLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Label to show when value is set but not in the current result page. */
  selectedLabel?: string | null;
  className?: string;
  triggerClassName?: string;
};

function shopSubtitle(shop: ShopPickerOption) {
  return [shop.city, shop.state].filter(Boolean).join(", ");
}

export function ShopSearchSelect({
  value,
  onChange,
  allowAll = false,
  allLabel = "All shops",
  placeholder = "Select shop",
  disabled = false,
  selectedLabel = null,
  className,
  triggerClassName,
}: ShopSearchSelectProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const listParams = useMemo(
    () =>
      buildPageParams({
        search: debouncedSearch || undefined,
        page: 1,
        page_size: 50,
      }),
    [debouncedSearch]
  );

  const { data, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["shops", "picker", listParams],
    queryFn: async () => {
      try {
        const page = await api<Paginated<ShopPickerOption>>(`/shops${listParams}`, {
          timeoutMs: 15_000,
        });
        if (user?.id && page.items?.length) {
          const existing = loadOfflineShopsCache<ShopPickerOption>(user.id) || [];
          const map = new Map(existing.map((s) => [s.id, s]));
          for (const shop of page.items) map.set(shop.id, shop);
          saveOfflineShopsCache(user.id, Array.from(map.values()));
        }
        return page;
      } catch (err) {
        if (user?.id && isNetworkApiError(err as ApiError)) {
          const cached = loadOfflineShopsCache<ShopPickerOption>(user.id) || [];
          const q = debouncedSearch.toLowerCase();
          const filtered = q
            ? cached.filter(
                (s) =>
                  s.name.toLowerCase().includes(q) ||
                  (s.city || "").toLowerCase().includes(q) ||
                  (s.state || "").toLowerCase().includes(q)
              )
            : cached;
          return {
            items: filtered.slice(0, 50),
            total: filtered.length,
            page: 1,
            page_size: 50,
          } satisfies Paginated<ShopPickerOption>;
        }
        throw err;
      }
    },
    enabled: open,
    staleTime: 60_000,
  });

  const shops = data?.items ?? [];

  const triggerText = useMemo(() => {
    if (allowAll && (value === "all" || !value)) return allLabel;
    if (selectedLabel) return selectedLabel;
    const match = shops.find((s) => s.id === value);
    if (match) return match.name;
    if (value) return "Selected shop";
    return placeholder;
  }, [allowAll, allLabel, value, selectedLabel, shops, placeholder]);

  return (
    <div className={className}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "h-11 w-full justify-between font-normal",
              !value && "text-muted-foreground",
              triggerClassName
            )}
          >
            <span className="truncate">{triggerText}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search shops..."
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              {isFetching && (
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading shops…
                </div>
              )}
              {isError && !isFetching && (
                <div className="space-y-2 px-3 py-2 text-xs">
                  <p className="text-destructive">
                    {(error as ApiError)?.message || "Could not load shops"}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => void refetch()}
                  >
                    Retry
                  </Button>
                </div>
              )}
              <CommandEmpty>{isFetching ? " " : "No shops found."}</CommandEmpty>
              <CommandGroup>
                {allowAll && (
                  <CommandItem
                    value="__all__"
                    onSelect={() => {
                      onChange("all", null);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === "all" || !value ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {allLabel}
                  </CommandItem>
                )}
                {shops.map((shop) => {
                  const sub = shopSubtitle(shop);
                  return (
                    <CommandItem
                      key={shop.id}
                      value={shop.id}
                      onSelect={() => {
                        onChange(shop.id, shop);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          value === shop.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="block truncate">{shop.name}</span>
                        {sub ? (
                          <span className="block truncate text-xs text-muted-foreground">{sub}</span>
                        ) : null}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              {typeof data?.total === "number" && data.total > shops.length && (
                <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
                  Showing {shops.length} of {data.total}. Type to search.
                </p>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
