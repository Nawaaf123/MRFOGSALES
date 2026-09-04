import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Calendar, Filter, Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Card } from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

interface InvoiceFiltersProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusChange: (value: string) => void;
  shopFilter: string;
  onShopChange: (value: string) => void;
  sortBy: string;
  onSortChange: (value: string) => void;
  dateFrom: string;
  onDateFromChange: (value: string) => void;
  dateTo: string;
  onDateToChange: (value: string) => void;
  shops: any[];
  onClearFilters: () => void;
}

export const InvoiceFilters = ({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusChange,
  shopFilter,
  onShopChange,
  sortBy,
  onSortChange,
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  shops,
  onClearFilters,
}: InvoiceFiltersProps) => {
  const [shopComboOpen, setShopComboOpen] = useState(false);
  const hasActiveFilters = searchQuery || statusFilter !== "all" || shopFilter !== "all" || dateFrom || dateTo || sortBy !== "date_desc";
  
  const selectedShop = shops?.find((shop) => shop.id === shopFilter);

  return (
    <Card className="p-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold">Filters</h3>
          </div>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={onClearFilters}>
              Clear All
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Search */}
          <div className="space-y-2">
            <Label htmlFor="search">Search</Label>
            <Input
              id="search"
              placeholder="Invoice #, shop, city, address..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>

          {/* Payment Status */}
          <div className="space-y-2">
            <Label htmlFor="status">Payment Status</Label>
            <Select value={statusFilter} onValueChange={onStatusChange}>
              <SelectTrigger id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="unpaid">Unpaid</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Shop Filter */}
          <div className="space-y-2">
            <Label htmlFor="shop">Shop</Label>
            <Popover open={shopComboOpen} onOpenChange={setShopComboOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={shopComboOpen}
                  className="w-full justify-between"
                >
                  {shopFilter === "all" 
                    ? "All Shops" 
                    : selectedShop?.name || "Select shop..."}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[300px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search shops..." />
                  <CommandList>
                    <CommandEmpty>No shop found.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value="all"
                        onSelect={() => {
                          onShopChange("all");
                          setShopComboOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            shopFilter === "all" ? "opacity-100" : "opacity-0"
                          )}
                        />
                        All Shops
                      </CommandItem>
                      {shops?.map((shop) => (
                        <CommandItem
                          key={shop.id}
                          value={shop.name}
                          onSelect={() => {
                            onShopChange(shop.id);
                            setShopComboOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              shopFilter === shop.id ? "opacity-100" : "opacity-0"
                            )}
                          />
                          {shop.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {/* Sort By */}
          <div className="space-y-2">
            <Label htmlFor="sort">Sort By</Label>
            <Select value={sortBy} onValueChange={onSortChange}>
              <SelectTrigger id="sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date_desc">Newest First</SelectItem>
                <SelectItem value="date_asc">Oldest First</SelectItem>
                <SelectItem value="amount_desc">Highest Amount</SelectItem>
                <SelectItem value="amount_asc">Lowest Amount</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Date Range */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="dateFrom">From Date</Label>
            <div className="relative">
              <Input
                id="dateFrom"
                type="date"
                value={dateFrom}
                onChange={(e) => onDateFromChange(e.target.value)}
              />
              <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dateTo">To Date</Label>
            <div className="relative">
              <Input
                id="dateTo"
                type="date"
                value={dateTo}
                onChange={(e) => onDateToChange(e.target.value)}
              />
              <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};
