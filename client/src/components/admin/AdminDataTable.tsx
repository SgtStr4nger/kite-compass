import { useState } from "react";
import { Check, ChevronDown, ChevronUp, Filter, X } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type {
  AdminDataTableProps,
  AdminFilterOption,
  AdminTableColumn,
  AdminTableFilters,
  ColumnFilterType,
  ColumnFilterValue,
} from "@/lib/types";

const PER_PAGE_DEFAULT = [25, 50, 100];

function filterActive(value: ColumnFilterValue): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Boolean(value.from || value.to);
  if (typeof value === "boolean") return value;
  return String(value).length > 0;
}

function MultiselectFilter({
  options,
  value,
  onChange,
}: {
  options: AdminFilterOption[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (val: string) => {
    onChange(value.includes(val) ? value.filter((v) => v !== val) : [...value, val]);
  };
  return (
    <Command>
      <CommandInput placeholder="Search…" />
      <CommandList>
        <CommandEmpty>No options.</CommandEmpty>
        <CommandGroup>
          {options.map((opt) => {
            const checked = value.includes(opt.value);
            return (
              <CommandItem key={opt.value} value={opt.value} onSelect={() => toggle(opt.value)}>
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => toggle(opt.value)}
                  className="mr-2"
                />
                <span>{opt.label}</span>
                {checked && <Check className="ml-auto h-4 w-4 text-primary" />}
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

function DateRangeFilter({
  value,
  onChange,
}: {
  value: { from?: string; to?: string };
  onChange: (next: { from?: string; to?: string }) => void;
}) {
  return (
    <div className="space-y-2">
      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">From</div>
        <Input type="date" value={value.from ?? ""} onChange={(e) => onChange({ ...value, from: e.target.value || undefined })} />
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">To</div>
        <Input type="date" value={value.to ?? ""} onChange={(e) => onChange({ ...value, to: e.target.value || undefined })} />
      </div>
    </div>
  );
}

function ColumnFilter({
  column,
  value,
  onChange,
}: {
  column: AdminTableColumn<any>;
  value: ColumnFilterValue;
  onChange: (next: ColumnFilterValue) => void;
}) {
  const type: ColumnFilterType = column.filterType ?? "text";
  const options = column.filterOptions ?? [];

  if (type === "multiselect") {
    const selected = (Array.isArray(value) ? value : []) as string[];
    return (
      <div>
        <MultiselectFilter options={options} value={selected} onChange={(next) => onChange(next)} />
        {selected.length > 0 && (
          <Button size="sm" variant="ghost" className="mt-2 w-full" onClick={() => onChange([])}>
            <X className="mr-1 h-3 w-3" /> Clear ({selected.length})
          </Button>
        )}
      </div>
    );
  }

  if (type === "dateRange") {
    const range = (value && typeof value === "object" ? value : {}) as { from?: string; to?: string };
    return (
      <div>
        <DateRangeFilter value={range} onChange={(next) => onChange({ ...next })} />
        {(range.from || range.to) && (
          <Button size="sm" variant="ghost" className="mt-2 w-full" onClick={() => onChange({})}>
            <X className="mr-1 h-3 w-3" /> Clear
          </Button>
        )}
      </div>
    );
  }

  if (type === "select" || type === "boolean") {
    const current = typeof value === "string" ? value : "";
    return (
      <Select value={current} onValueChange={(v) => onChange(v || undefined)}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Any" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">Any</SelectItem>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // text
  const current = typeof value === "string" ? value : "";
  return (
    <div className="space-y-2">
      <Input
        value={current}
        placeholder={`Filter ${column.header.toLowerCase()}…`}
        onChange={(e) => onChange(e.target.value || undefined)}
        autoFocus
      />
      {current.length > 0 && (
        <Button size="sm" variant="ghost" className="w-full" onClick={() => onChange(undefined)}>
          <X className="mr-1 h-3 w-3" /> Clear
        </Button>
      )}
    </div>
  );
}

export default function AdminDataTable<T>({
  columns,
  rows,
  keyField = "id" as keyof T,
  total,
  page,
  perPage,
  sortBy,
  sortDir,
  filters = {},
  selectedIds = [],
  loading,
  emptyMessage = "No results found.",
  perPageOptions = PER_PAGE_DEFAULT,
  toolbar,
  onSortChange,
  onFilterChange,
  onPageChange,
  onPerPageChange,
  onSelect,
  onSelectAll,
  allSelected,
  onSelectAllToggle,
  onRowClick,
}: AdminDataTableProps<T>) {
  const visibleIds = rows.map((row) => row[keyField] as string | number);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const headerChecked: boolean | "indeterminate" = onSelectAllToggle
    ? (allSelected ?? false)
    : allVisibleSelected;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const colCount = columns.length + 1; // +1 for selection checkbox

  return (
    <div className="rounded-2xl border border-card-border bg-card">
      {toolbar != null && <div className="border-b border-border p-3">{toolbar}</div>}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-border text-muted-foreground">
              {onSelect && (
                <TableHead className="w-10 px-2 py-3">
                  <Checkbox
                    checked={headerChecked}
                    onCheckedChange={(c) => (onSelectAllToggle ? onSelectAllToggle(!!c) : onSelectAll?.(c ? visibleIds : []))}
                  />
                </TableHead>
              )}
              {columns.map((col) => (
                <TableHead key={col.key} className={cn("font-medium py-3", col.headerClassName)} style={{ width: col.width }}>
                  <div className="flex items-center gap-1">
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => onSortChange?.(col.key)}
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        {col.header}
                        {sortBy === col.key ? (
                          sortDir === "asc" ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />
                        ) : null}
                      </button>
                    ) : (
                      <span>{col.header}</span>
                    )}
                    {col.filterable && onFilterChange && (
                      <HeaderFilterCell
                        column={col}
                        value={filters[col.key]}
                        onFilterChange={onFilterChange}
                      />
                    )}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={colCount} className="px-4 py-6">
                  <div className="space-y-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <Skeleton key={i} className="h-9 w-full rounded-md" />
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            )}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={colCount} className="px-4 py-8 text-center text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              rows.map((row) => {
                const id = row[keyField] as string | number;
                const checked = selectedIds.includes(id);
                return (
                  <TableRow
                    key={String(id)}
                    className={cn("border-b border-border last:border-0", onRowClick && "cursor-pointer hover:bg-secondary/20")}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {onSelect && (
                      <TableCell className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(c) => onSelect?.(id, !!c)}
                        />
                      </TableCell>
                    )}
                    {columns.map((col) => (
                      <TableCell key={col.key} className={cn("px-4 py-3", col.className)} style={{ width: col.width }}>
                        {col.renderCell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </div>

      {!loading && total > perPage && (
        <div className="flex items-center justify-between gap-4 border-t border-border px-4 py-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Per page:</span>
            {perPageOptions.map((n) => (
              <button
                key={n}
                onClick={() => onPerPageChange?.(n)}
                className={cn("rounded px-2 py-0.5", perPage === n ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span>
              Page {page} of {totalPages} · {total} total
            </span>
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPageChange?.(page - 1)}>
              Prev
            </Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => onPageChange?.(page + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function HeaderFilterCell({
  column,
  value,
  onFilterChange,
}: {
  column: AdminTableColumn<any>;
  value: ColumnFilterValue;
  onFilterChange: (key: string, value: ColumnFilterValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = filterActive(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`Filter ${column.header}`}
          className={cn(
            "relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors",
            active ? "text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <Filter className="h-3.5 w-3.5" />
          {active && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <ColumnFilter column={column} value={value} onChange={(next) => onFilterChange(column.key, next)} />
      </PopoverContent>
    </Popover>
  );
}
