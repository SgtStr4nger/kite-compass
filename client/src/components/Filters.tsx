import { useMemo, useState } from "react";
import { FilterDef, MONTHS, tagLabel } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { EXPLORE_CONTINENTS, type ExploreContinent } from "@shared/locations";

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
  windType: string[];
  waterState: string[];
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
  windType: [],
  waterState: [],
  windMin: null,
  windMax: null,
};

const KEY_MAP = {
  windTypes: "windType",
  riderLevels: "riderLevel",
  waterStates: "waterState",
  spotTypes: "spotType",
  vibeTags: "vibe",
} satisfies Record<string, "windType" | "riderLevel" | "waterState" | "spotType" | "vibe">;

const FILTER_ORDER = ["windTypes", "riderLevels", "waterStates", "spotTypes", "vibeTags"] as const;

const FILTER_LABELS: Partial<Record<(typeof FILTER_ORDER)[number], string>> = {
  spotTypes: "Destination type",
  vibeTags: "Destination vibe",
};

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

function LocationGroup({
  countries,
  state,
  onChange,
}: {
  countries: string[];
  state: FilterState;
  onChange: (s: FilterState) => void;
}) {
  const [countrySearch, setCountrySearch] = useState("");

  const matchingCountries = useMemo(() => {
    const query = countrySearch.trim().toLowerCase();
    if (!query) return countries;
    return countries.filter((country) => country.toLowerCase().includes(query));
  }, [countries, countrySearch]);

  const locationActive = state.continents.length > 0 || state.countries.length > 0;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-foreground">Where do you want to go?</div>
        {locationActive && (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onChange({ ...state, continents: [], countries: [] })}
          >
            Clear
          </button>
        )}
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-background/60 p-3">
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Continent</div>
          <div className="flex flex-wrap gap-2">
            {EXPLORE_CONTINENTS.map((continent) => {
              const selected = state.continents.includes(continent);
              return (
                <button
                  key={continent}
                  type="button"
                  onClick={() => onChange({ ...state, continents: toggleArrayValue(state.continents, continent) })}
                  className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                    selected ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-foreground/80 hover-elevate"
                  }`}
                >
                  {continent}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Country</div>
          <Input
            value={countrySearch}
            onChange={(event) => setCountrySearch(event.target.value)}
            placeholder="Search countries"
            data-testid="input-search-countries-public"
          />
          <ScrollArea className="mt-2 h-52 rounded-lg border border-border bg-card">
            <div className="space-y-1 p-2">
              {matchingCountries.map((country) => {
                const selected = state.countries.includes(country);
                return (
                  <label
                    key={country}
                    className={`flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors ${
                      selected ? "bg-primary/10 text-foreground" : "hover:bg-muted/60"
                    }`}
                  >
                    <Checkbox
                      checked={selected}
                      onCheckedChange={() => onChange({ ...state, countries: toggleArrayValue(state.countries, country) })}
                    />
                    <span>{country}</span>
                  </label>
                );
              })}
              {matchingCountries.length === 0 && (
                <div className="px-2 py-6 text-center text-sm text-muted-foreground">No countries match that search.</div>
              )}
            </div>
          </ScrollArea>
        </div>
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
  const defsByKey = useMemo(() => new Map(defs.map((def) => [def.key, def])), [defs]);

  const sliderValue = [
    state.windMin ?? WIND_SLIDER_MIN,
    state.windMax ?? WIND_SLIDER_MAX,
  ];
  const windRangeActive = state.windMin != null || state.windMax != null;

  return (
    <div className="space-y-6">
      <MonthPicker value={state.months} onChange={(months) => onChange({ ...state, months })} />

      <LocationGroup countries={countries} state={state} onChange={onChange} />

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
