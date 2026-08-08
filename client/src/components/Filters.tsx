import { useMemo, useState } from "react";
import { FilterDef, MONTHS, tagLabel } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { LocationPicker } from "@/components/LocationPicker";
import type { ExploreContinent } from "@shared/locations";

const WIND_SLIDER_MIN = 15;
const WIND_SLIDER_MAX = 40;

export interface FilterState {
  query: string;
  months: string[];
  continents: ExploreContinent[];
  countries: string[];
  spotType: string[];
  riderLevel: string[];
  vibe: string[];
  windMin: number | null;
  windMax: number | null;
}

export const emptyFilters: FilterState = {
  query: "",
  months: [],
  continents: [],
  countries: [],
  spotType: [],
  riderLevel: [],
  vibe: [],
  windMin: null,
  windMax: null,
};

const KEY_MAP = {
  riderLevels: "riderLevel",
  spotTypes: "spotType",
  vibeTags: "vibe",
} satisfies Record<string, "riderLevel" | "spotType" | "vibe">;

const FILTER_ORDER = ["riderLevels", "spotTypes", "vibeTags"] as const;

const FILTER_LABELS: Partial<Record<(typeof FILTER_ORDER)[number], string>> = {
  spotTypes: "Spot type",
  vibeTags: "Travel vibe",
};

const PUBLIC_FILTER_FALLBACKS: FilterDef[] = [
  { id: -2, key: "riderLevels", label: "Rider level", field: "rider_levels", type: "multiselect", options: ["beginner", "intermediate", "advanced"], isPublic: true, sortOrder: 2 },
  { id: -4, key: "spotTypes", label: "Spot type", field: "spot_types", type: "multiselect", options: ["flat-water", "chop", "waves", "lagoon", "foil", "freestyle"], isPublic: true, sortOrder: 1 },
  { id: -5, key: "vibeTags", label: "Travel vibe", field: "vibe_tags", type: "multiselect", options: ["city", "town", "village", "remote", "touristy", "local-scene", "family-friendly", "nightlife"], isPublic: true, sortOrder: 3 },
];

export function normalizeFilterState(value: Partial<FilterState> | null | undefined): FilterState {
  return {
    ...emptyFilters,
    ...value,
    query: value?.query ?? "",
    months: value?.months ?? [],
    continents: value?.continents ?? [],
    countries: value?.countries ?? [],
    spotType: value?.spotType ?? [],
    riderLevel: value?.riderLevel ?? [],
    vibe: value?.vibe ?? [],
    windMin: value?.windMin ?? null,
    windMax: value?.windMax ?? null,
  };
}

function toggleArrayValue<T extends string>(values: T[], next: T): T[] {
  return values.includes(next) ? values.filter((value) => value !== next) : [...values, next];
}

export function MonthPicker({
  value, onChange, id = "months", label = "Months",
}: { value: string[]; onChange: (v: string[]) => void; id?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const order = new Map(MONTHS.map((m, index) => [m, index]));
  const sortMonths = (months: string[]) => [...months].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
  const toggle = (month: string) => onChange(sortMonths(toggleArrayValue(value, month)));
  const ordered = sortMonths(value);
  const summary = ordered.length === 0 ? "All months" : ordered.length <= 2 ? ordered.join(", ") : `${ordered[0]}, ${ordered[1]} +${ordered.length - 2}`;

  return (
    <div>
      <div className="mb-2 text-sm font-medium text-foreground">{label}</div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="w-full justify-between gap-3" data-testid={`month-picker-${id}`}>
            <span className="truncate text-left">{summary}</span>
            <span className="text-muted-foreground">{value.length === 0 ? "12" : value.length}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(92vw,28rem)] p-3" align="start">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-sm font-medium text-foreground">Select months</div>
            <div className="flex items-center gap-3 text-xs">
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => onChange(MONTHS.slice())}>
                Select all
              </button>
              {value.length > 0 && (
                <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => onChange([])}>
                  Clear
                </button>
              )}
              <button type="button" className="font-medium text-foreground hover:text-primary" onClick={() => setOpen(false)}>
                Done
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {MONTHS.map((month) => {
              const selected = value.includes(month);
              return (
                <button
                  key={month}
                  type="button"
                  onClick={() => toggle(month)}
                  data-testid={`month-toggle-${month}`}
                  aria-pressed={selected}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground/80 hover-elevate"}`}
                >
                  <span className={`h-2.5 w-2.5 rounded-full ${selected ? "bg-current" : "bg-muted-foreground/30"}`} />
                  <span>{month}</span>
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
        {options.map((option) => {
          const on = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => onToggle(option)}
              data-testid={`filter-${testid}-${option}`}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                on ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-foreground/80 hover-elevate"
              }`}
            >
              {tagLabel(option)}
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
  const defsByKey = useMemo(() => {
    const merged = new Map(PUBLIC_FILTER_FALLBACKS.map((def) => [def.key, def]));
    defs.forEach((def) => merged.set(def.key, def));
    return merged;
  }, [defs]);

  const sliderValue = [
    state.windMin ?? WIND_SLIDER_MIN,
    state.windMax ?? WIND_SLIDER_MAX,
  ];
  const windRangeActive = state.windMin != null || state.windMax != null;

  return (
    <div className="space-y-6">
      <MonthPicker value={state.months} onChange={(months) => onChange({ ...state, months })} />

      <LocationPicker
        countries={countries}
        value={{ continents: state.continents, countries: state.countries }}
        onChange={(location) => onChange({ ...state, ...location })}
      />

      <div>
        <div className="mb-2 flex items-center justify-between text-sm font-medium text-foreground">
          <span>Average wind</span>
          {windRangeActive && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onChange({ ...state, windMin: null, windMax: null })}
            >
              Clear
            </button>
          )}
        </div>
        <Slider
          min={WIND_SLIDER_MIN}
          max={WIND_SLIDER_MAX}
          step={1}
          value={sliderValue}
          onValueChange={([lo, hi]) => {
            onChange({
              ...state,
              windMin: lo === WIND_SLIDER_MIN ? null : lo,
              windMax: hi === WIND_SLIDER_MAX ? null : hi,
            });
          }}
          data-testid="slider-wind-range"
        />
        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
          <span>{windRangeActive ? `${sliderValue[0]} kn` : `${WIND_SLIDER_MIN} kn`}</span>
          <span>{windRangeActive ? `${sliderValue[1]} kn` : `${WIND_SLIDER_MAX} kn`}</span>
        </div>
      </div>

      {FILTER_ORDER.map((key) => {
        const def = defsByKey.get(key);
        if (!def) return null;

        const stateKey = KEY_MAP[key];
        return (
          <MultiGroup
            key={def.key}
            label={FILTER_LABELS[key] ?? def.label}
            options={def.options}
            selected={state[stateKey]}
            onToggle={(value) => onChange({ ...state, [stateKey]: toggleArrayValue(state[stateKey], value) })}
            testid={def.key}
          />
        );
      })}
    </div>
  );
}
