import { useMemo, useState } from "react";
import { ChevronsUpDown, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EXPLORE_CONTINENTS, getContinentForCountry, countryNameForCode, type ExploreContinent } from "@shared/locations";

export interface LocationValue {
  continents: ExploreContinent[];
  countries: string[];
}

const MAX_VISIBLE_CHIPS = 3;

function toggleArrayValue<T extends string>(values: T[], next: T): T[] {
  return values.includes(next) ? values.filter((value) => value !== next) : [...values, next];
}

export function LocationPicker({
  countries,
  value,
  onChange,
}: {
  countries: string[];
  value: LocationValue;
  onChange: (next: LocationValue) => void;
}) {
  const [open, setOpen] = useState(false);

  const countriesByContinent = useMemo(() => {
    const map = new Map<ExploreContinent, string[]>();
    const other: string[] = [];
    countries.forEach((country) => {
      const continent = getContinentForCountry(country);
      if (continent) {
        const list = map.get(continent) ?? [];
        list.push(country);
        map.set(continent, list);
      } else {
        other.push(country);
      }
    });
    return { map, other };
  }, [countries]);

  const countriesForContinent = (continent: ExploreContinent): string[] =>
    countriesByContinent.map.get(continent) ?? [];

  const toggleContinent = (continent: ExploreContinent) => {
    const wasSelected = value.continents.includes(continent);
    const underlying = countriesForContinent(continent);
    if (wasSelected) {
      onChange({
        continents: value.continents.filter((c) => c !== continent),
        countries: value.countries.filter((country) => !underlying.includes(country)),
      });
    } else {
      onChange({
        continents: [...value.continents, continent],
        countries: Array.from(new Set([...value.countries, ...underlying])),
      });
    }
  };

  const toggleCountry = (country: string) => {
    onChange({
      continents: value.continents,
      countries: toggleArrayValue(value.countries, country),
    });
  };

  const removeLocation = (label: string) => {
    if (EXPLORE_CONTINENTS.includes(label as ExploreContinent)) {
      toggleContinent(label as ExploreContinent);
    } else {
      toggleCountry(label);
    }
  };

  const selectedLocations = [...value.continents, ...value.countries];
  // Chips/values hold ISO codes for countries; render their English names.
  const displayLabel = (loc: string) =>
    EXPLORE_CONTINENTS.includes(loc as ExploreContinent) ? loc : countryNameForCode(loc);
  const totalSelected = selectedLocations.length;
  const visibleChips = selectedLocations.slice(0, MAX_VISIBLE_CHIPS);
  const hiddenChips = totalSelected - visibleChips.length;
  const anyActive = value.continents.length > 0 || value.countries.length > 0;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-foreground">Where do you want to go?</div>
        {anyActive && (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onChange({ continents: [], countries: [] })}
          >
            Clear
          </button>
        )}
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-auto min-h-10 w-full justify-between gap-3 py-2"
            data-testid="location-picker-trigger"
          >
            {totalSelected === 0 ? (
              <span className="truncate text-left text-muted-foreground">All locations</span>
            ) : (
              <span className="flex flex-wrap items-center gap-1.5">
                {visibleChips.map((location) => (
                  <Badge key={location} variant="secondary" className="gap-1">
                    {displayLabel(location)}
                    <span
                      role="button"
                      tabIndex={-1}
                      aria-label={`Remove ${location}`}
                      className="rounded-full p-0.5 hover:bg-foreground/10"
                      onClick={(event) => {
                        event.stopPropagation();
                        removeLocation(location);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </span>
                  </Badge>
                ))}
                {hiddenChips > 0 && <Badge variant="secondary">+{hiddenChips}</Badge>}
              </span>
            )}
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-[min(92vw,26rem)] p-0" align="start">
          <Command
            filter={(searchValue, search) => {
              const q = search.trim().toLowerCase();
              if (!q) return 1;
              return searchValue.toLowerCase().includes(q) ? 1 : 0;
            }}
          >
            <CommandInput placeholder="Search continents or countries…" autoFocus />
            <CommandList className="max-h-[320px]">
              <CommandEmpty>No locations match that search.</CommandEmpty>

              <CommandGroup heading="Continents">
                {EXPLORE_CONTINENTS.map((continent) => {
                  const selected = value.continents.includes(continent);
                  return (
                    <CommandItem
                      key={continent}
                      value={continent}
                      onSelect={() => toggleContinent(continent)}
                      data-testid={`location-continent-${continent}`}
                    >
                      <span className="pointer-events-none">
                        <Checkbox checked={selected} />
                      </span>
                      <span>{continent}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>

              <CommandSeparator />

              {EXPLORE_CONTINENTS.map((continent) => {
                const continentCountries = countriesByContinent.map.get(continent) ?? [];
                if (continentCountries.length === 0) return null;
                return (
                  <CommandGroup key={continent} heading={continent}>
                    {continentCountries.map((country) => {
                      const selected = value.countries.includes(country);
                      return (
                        <CommandItem
                          key={country}
                          value={`${countryNameForCode(country)} ${country}`}
                          onSelect={() => toggleCountry(country)}
                          data-testid={`location-country-${country}`}
                        >
                          <span className="pointer-events-none">
                            <Checkbox checked={selected} />
                          </span>
                          <span>{country}</span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                );
              })}

              {countriesByContinent.other.length > 0 && (
                <CommandGroup heading="Other">
                  {countriesByContinent.other.map((country) => {
                    const selected = value.countries.includes(country);
                    return (
                      <CommandItem
                        key={country}
                        value={country}
                        onSelect={() => toggleCountry(country)}
                        data-testid={`location-country-${country}`}
                      >
                        <span className="pointer-events-none">
                          <Checkbox checked={selected} />
                        </span>
                        <span>{country}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>

            <CommandSeparator />
            <div className="flex items-center justify-between p-2">
              <button
                type="button"
                className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                disabled={!anyActive}
                onClick={() => onChange({ continents: [], countries: [] })}
              >
                Clear
              </button>
              <button
                type="button"
                className="px-2 py-1 text-sm font-medium text-foreground hover:text-primary"
                onClick={() => setOpen(false)}
              >
                Done
              </button>
            </div>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
