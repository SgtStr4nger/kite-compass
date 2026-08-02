export const EXPLORE_CONTINENTS = [
  "Europe",
  "Africa",
  "Asia",
  "Americas",
  "Oceania",
] as const;

export type ExploreContinent = typeof EXPLORE_CONTINENTS[number];

export const COUNTRY_TO_CONTINENT: Record<string, ExploreContinent> = {
  Australia: "Oceania",
  Brazil: "Americas",
  "Cape Verde": "Africa",
  Colombia: "Americas",
  Cuba: "Americas",
  "Dominican Republic": "Americas",
  Egypt: "Africa",
  France: "Europe",
  Greece: "Europe",
  Israel: "Asia",
  Italy: "Europe",
  Japan: "Asia",
  Kenya: "Africa",
  Madagascar: "Africa",
  Mauritius: "Africa",
  Mexico: "Americas",
  Morocco: "Africa",
  Mozambique: "Africa",
  Namibia: "Africa",
  Netherlands: "Europe",
  "Northern Mariana Islands": "Oceania",
  Peru: "Americas",
  Philippines: "Asia",
  Seychelles: "Africa",
  "South Africa": "Africa",
  Spain: "Europe",
  "Sri Lanka": "Asia",
  Switzerland: "Europe",
  Taiwan: "Asia",
  Tanzania: "Africa",
  Turkey: "Europe",
  "United Arab Emirates": "Asia",
  "United States": "Americas",
  Venezuela: "Americas",
  Vietnam: "Asia",
};

export function getContinentForCountry(country: string | null | undefined): ExploreContinent | null {
  if (!country) return null;
  return COUNTRY_TO_CONTINENT[country] ?? null;
}
