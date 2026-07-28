import { FilterDef, MONTHS, tagLabel } from "@/lib/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export interface FilterState {
  month: string | null;
  spotType: string[];
  riderLevel: string[];
  vibe: string[];
  beginner: boolean;
  country: string | null;
}

export const emptyFilters: FilterState = {
  month: null, spotType: [], riderLevel: [], vibe: [], beginner: false, country: null,
};

// maps filterDef.key -> FilterState key
const KEY_MAP: Record<string, keyof FilterState> = {
  spotTypes: "spotType",
  riderLevels: "riderLevel",
  vibeTags: "vibe",
  beginnerFriendly: "beginner",
};

export function MonthSelect({
  value, onChange, id = "month", required = false,
}: { value: string | null; onChange: (v: string) => void; id?: string; required?: boolean }) {
  return (
    <Select value={value ?? undefined} onValueChange={onChange}>
      <SelectTrigger id={id} data-testid="select-month" className="w-full">
        <SelectValue placeholder={required ? "Select a month" : "Any month"} />
      </SelectTrigger>
      <SelectContent>
        {MONTHS.map(m => <SelectItem key={m} value={m} data-testid={`option-month-${m}`}>{m}</SelectItem>)}
      </SelectContent>
    </Select>
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
        if (def.type === "boolean") {
          return (
            <div key={def.key} className="flex items-center gap-2">
              <Checkbox
                id={`f-${def.key}`}
                checked={state.beginner}
                onCheckedChange={(c) => onChange({ ...state, beginner: !!c })}
                data-testid="filter-beginner"
              />
              <Label htmlFor={`f-${def.key}`} className="cursor-pointer text-sm">{def.label}</Label>
            </div>
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
