import { FilterDef, MONTHS, tagLabel } from "@/lib/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Search } from "lucide-react";

export interface FilterState {
  query: string;
  months: string[];
  spotType: string[];
  riderLevel: string[];
  vibe: string[];
  country: string | null;
}

export const emptyFilters: FilterState = {
  query: "",
  months: [], spotType: [], riderLevel: [], vibe: [], country: null,
};

// maps filterDef.key -> FilterState key
const KEY_MAP: Record<string, keyof FilterState> = {
  spotTypes: "spotType",
  riderLevels: "riderLevel",
  vibeTags: "vibe",
};

export function MonthPicker({
  value, onChange, id = "months", label = "Months",
}: { value: string[]; onChange: (v: string[]) => void; id?: string; label?: string }) {
  const order = new Map(MONTHS.map((m, index) => [m, index]));
  const sortMonths = (months: string[]) => [...months].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
  const toggle = (month: string) => onChange(sortMonths(value.includes(month) ? value.filter(m => m !== month) : [...value, month]));
  const ordered = sortMonths(value);
  const summary = ordered.length === 0 ? "Any month" : ordered.length <= 2 ? ordered.join(", ") : `${ordered[0]}, ${ordered[1]} +${ordered.length - 2}`;
  return (
    <div>
      <div className="mb-2 text-sm font-medium text-foreground">{label}</div>
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="w-full justify-between gap-3" data-testid={`month-picker-${id}`}>
            <span className="truncate text-left">{summary}</span>
            <span className="text-muted-foreground">{value.length === 0 ? "12" : value.length}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(92vw,28rem)] p-3" align="start">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-sm font-medium text-foreground">Select months</div>
            {value.length > 0 && (
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => onChange([])}>Clear</button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {MONTHS.map(m => {
              const on = value.includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggle(m)}
                  data-testid={`month-toggle-${m}`}
                  aria-pressed={on}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground/80 hover-elevate"}`}
                >
                  <span className={`h-2.5 w-2.5 rounded-full ${on ? "bg-current" : "bg-muted-foreground/30"}`} />
                  <span>{m}</span>
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function MultiGroup({
  label, options, selected, onToggle, testid,
}: { label: string; options: string[]; selected: string[]; onToggle: (v: string) => void; testid: string }) {
  return (
    <div>
      <div className="mb-2 text-sm font-medium text-foreground">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map(o => {
          const on = selected.includes(o);
          return (
            <button
              key={o}
              type="button"
              onClick={() => onToggle(o)}
              data-testid={`filter-${testid}-${o}`}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                on ? "border-primary bg-primary text-primary-foreground"
                   : "border-border bg-background text-foreground/80 hover-elevate"
              }`}
            >
              {tagLabel(o)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function FilterPanel({
  defs, countries, state, onChange,
}: {
  defs: FilterDef[];
  countries: string[];
  state: FilterState;
  onChange: (s: FilterState) => void;
}) {
  const toggle = (key: keyof FilterState, v: string) => {
    const arr = state[key] as string[];
    onChange({ ...state, [key]: arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v] });
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 text-sm font-medium text-foreground">Where do you want to go?</div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={state.query}
            onChange={(e) => onChange({ ...state, query: e.target.value })}
            placeholder="Search a spot, region or country"
            className="pl-9"
            data-testid="input-search-spots-public"
          />
        </div>
      </div>

      <MonthPicker value={state.months} onChange={(months) => onChange({ ...state, months })} />

      {defs.map(def => {
        const sk = KEY_MAP[def.key];
        if (def.type === "multiselect" && sk) {
          return (
            <MultiGroup
              key={def.key}
              label={def.label}
              options={def.options}
              selected={state[sk] as string[]}
              onToggle={(v) => toggle(sk, v)}
              testid={def.key}
            />
          );
        }
        return null;
      })}

      {countries.length > 0 && (
        <div>
          <div className="mb-2 text-sm font-medium text-foreground">Country / region</div>
          <Select
            value={state.country ?? "all"}
            onValueChange={(v) => onChange({ ...state, country: v === "all" ? null : v })}
          >
            <SelectTrigger data-testid="select-country"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All countries</SelectItem>
              {countries.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
