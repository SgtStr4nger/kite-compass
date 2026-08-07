export const EXPLORE_CONTINENTS = [
  "Europe",
  "Africa",
  "Asia",
  "Americas",
  "Oceania",
] as const;

export type ExploreContinent = typeof EXPLORE_CONTINENTS[number];

// ── Country codes (ISO 3166-1 alpha-2) are the canonical storage form ──
// `spots.country` holds an uppercase ISO-2 code; English display names are
// derived through ISO2_TO_COUNTRY so the UI stays human-readable.

/**
 * Uppercase ISO-2 → English country name.
 * Covers every seeded country plus common kitesurf destinations. Codes missing
 * from this map still display (countryNameForCode falls back to the raw code).
 */
export const ISO2_TO_COUNTRY: Record<string, string> = {
  // Seeded countries (seed_data.json)
  AU: "Australia",
  BR: "Brazil",
  CV: "Cape Verde",
  CO: "Colombia",
  CU: "Cuba",
  DO: "Dominican Republic",
  EG: "Egypt",
  FR: "France",
  GR: "Greece",
  IL: "Israel",
  IT: "Italy",
  JP: "Japan",
  KE: "Kenya",
  MG: "Madagascar",
  MU: "Mauritius",
  MX: "Mexico",
  MA: "Morocco",
  MZ: "Mozambique",
  NA: "Namibia",
  NL: "Netherlands",
  MP: "Northern Mariana Islands",
  PE: "Peru",
  PH: "Philippines",
  SC: "Seychelles",
  ZA: "South Africa",
  ES: "Spain",
  LK: "Sri Lanka",
  CH: "Switzerland",
  TW: "Taiwan",
  TZ: "Tanzania",
  TR: "Turkey",
  AE: "United Arab Emirates",
  US: "United States",
  VE: "Venezuela",
  VN: "Vietnam",
  // Common kitesurf destinations / wider coverage
  AF: "Afghanistan",
  AL: "Albania",
  DZ: "Algeria",
  AO: "Angola",
  AG: "Antigua and Barbuda",
  AR: "Argentina",
  AM: "Armenia",
  AW: "Aruba",
  AT: "Austria",
  AZ: "Azerbaijan",
  BS: "Bahamas",
  BH: "Bahrain",
  BD: "Bangladesh",
  BB: "Barbados",
  BY: "Belarus",
  BE: "Belgium",
  BZ: "Belize",
  BJ: "Benin",
  BM: "Bermuda",
  BO: "Bolivia",
  BA: "Bosnia and Herzegovina",
  BW: "Botswana",
  BN: "Brunei",
  BG: "Bulgaria",
  BF: "Burkina Faso",
  BI: "Burundi",
  KH: "Cambodia",
  CM: "Cameroon",
  CA: "Canada",
  KY: "Cayman Islands",
  CF: "Central African Republic",
  TD: "Chad",
  CL: "Chile",
  CN: "China",
  CR: "Costa Rica",
  HR: "Croatia",
  CW: "Curaçao",
  CY: "Cyprus",
  CZ: "Czechia",
  CD: "Democratic Republic of the Congo",
  DK: "Denmark",
  DJ: "Djibouti",
  DM: "Dominica",
  EC: "Ecuador",
  SV: "El Salvador",
  GQ: "Equatorial Guinea",
  EE: "Estonia",
  SZ: "Eswatini",
  ET: "Ethiopia",
  FJ: "Fiji",
  FI: "Finland",
  PF: "French Polynesia",
  GA: "Gabon",
  GM: "Gambia",
  GE: "Georgia",
  DE: "Germany",
  GH: "Ghana",
  GD: "Grenada",
  GP: "Guadeloupe",
  GT: "Guatemala",
  GN: "Guinea",
  GW: "Guinea-Bissau",
  GY: "Guyana",
  HT: "Haiti",
  HN: "Honduras",
  HK: "Hong Kong",
  HU: "Hungary",
  IS: "Iceland",
  IN: "India",
  ID: "Indonesia",
  IR: "Iran",
  IQ: "Iraq",
  IE: "Ireland",
  CI: "Ivory Coast",
  JM: "Jamaica",
  JO: "Jordan",
  KZ: "Kazakhstan",
  KR: "South Korea",
  KP: "North Korea",
  KW: "Kuwait",
  KG: "Kyrgyzstan",
  LA: "Laos",
  LV: "Latvia",
  LB: "Lebanon",
  LS: "Lesotho",
  LR: "Liberia",
  LY: "Libya",
  LT: "Lithuania",
  LU: "Luxembourg",
  MW: "Malawi",
  MY: "Malaysia",
  MV: "Maldives",
  ML: "Mali",
  MT: "Malta",
  MQ: "Martinique",
  MR: "Mauritania",
  YT: "Mayotte",
  MD: "Moldova",
  MN: "Mongolia",
  ME: "Montenegro",
  MM: "Myanmar",
  NP: "Nepal",
  NC: "New Caledonia",
  NZ: "New Zealand",
  NI: "Nicaragua",
  NE: "Niger",
  NG: "Nigeria",
  MK: "North Macedonia",
  NO: "Norway",
  OM: "Oman",
  PK: "Pakistan",
  PA: "Panama",
  PG: "Papua New Guinea",
  PY: "Paraguay",
  PL: "Poland",
  PT: "Portugal",
  PR: "Puerto Rico",
  QA: "Qatar",
  CG: "Republic of the Congo",
  RE: "Réunion",
  RO: "Romania",
  RU: "Russia",
  RW: "Rwanda",
  KN: "Saint Kitts and Nevis",
  LC: "Saint Lucia",
  VC: "Saint Vincent and the Grenadines",
  WS: "Samoa",
  ST: "São Tomé and Príncipe",
  SA: "Saudi Arabia",
  SN: "Senegal",
  RS: "Serbia",
  SL: "Sierra Leone",
  SG: "Singapore",
  SK: "Slovakia",
  SI: "Slovenia",
  SB: "Solomon Islands",
  SO: "Somalia",
  SS: "South Sudan",
  SD: "Sudan",
  SR: "Suriname",
  SE: "Sweden",
  SY: "Syria",
  TJ: "Tajikistan",
  TH: "Thailand",
  TG: "Togo",
  TO: "Tonga",
  TT: "Trinidad and Tobago",
  TN: "Tunisia",
  TM: "Turkmenistan",
  TC: "Turks and Caicos Islands",
  UG: "Uganda",
  UA: "Ukraine",
  GB: "United Kingdom",
  UY: "Uruguay",
  UZ: "Uzbekistan",
  VU: "Vanuatu",
  VI: "U.S. Virgin Islands",
  VG: "British Virgin Islands",
  YE: "Yemen",
  ZM: "Zambia",
  ZW: "Zimbabwe",
};

/** Lowercased English name → uppercase ISO-2 code (admin manual entry, seed conversion, backfill). */
export const COUNTRY_NAME_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(ISO2_TO_COUNTRY).map(([code, name]) => [name.toLowerCase(), code]),
);

/** Uppercase ISO-2 code → Explore continent (spec explore filter). */
export const COUNTRY_CODE_TO_CONTINENT: Record<string, ExploreContinent> = {
  // Europe
  AL: "Europe", AT: "Europe", BY: "Europe", BE: "Europe", BA: "Europe",
  BG: "Europe", HR: "Europe", CY: "Europe", CZ: "Europe", DK: "Europe",
  EE: "Europe", FI: "Europe", FR: "Europe", DE: "Europe", GR: "Europe",
  HU: "Europe", IS: "Europe", IE: "Europe", IT: "Europe", XK: "Europe",
  LV: "Europe", LT: "Europe", LU: "Europe", MT: "Europe", MD: "Europe",
  ME: "Europe", NL: "Europe", MK: "Europe", NO: "Europe", PL: "Europe",
  PT: "Europe", RO: "Europe", RU: "Europe", RS: "Europe", SK: "Europe",
  SI: "Europe", ES: "Europe", SE: "Europe", CH: "Europe", TR: "Europe",
  UA: "Europe", GB: "Europe",
  // Africa
  DZ: "Africa", AO: "Africa", BJ: "Africa", BW: "Africa", BF: "Africa",
  BI: "Africa", CV: "Africa", CM: "Africa", CF: "Africa", TD: "Africa",
  KM: "Africa", CG: "Africa", CD: "Africa", DJ: "Africa", EG: "Africa",
  GQ: "Africa", ER: "Africa", SZ: "Africa", ET: "Africa", GA: "Africa",
  GM: "Africa", GH: "Africa", GN: "Africa", GW: "Africa", CI: "Africa",
  KE: "Africa", LS: "Africa", LR: "Africa", LY: "Africa", MG: "Africa",
  MW: "Africa", ML: "Africa", MR: "Africa", MU: "Africa", YT: "Africa",
  MA: "Africa", MZ: "Africa", NA: "Africa", NE: "Africa", NG: "Africa",
  RW: "Africa", ST: "Africa", SN: "Africa", SC: "Africa", SL: "Africa",
  SO: "Africa", ZA: "Africa", SS: "Africa", SD: "Africa", TZ: "Africa",
  TG: "Africa", TN: "Africa", UG: "Africa", ZM: "Africa", ZW: "Africa",
  RE: "Africa",
  // Asia
  AF: "Asia", AM: "Asia", AZ: "Asia", BH: "Asia", BD: "Asia",
  BN: "Asia", KH: "Asia", CN: "Asia", GE: "Asia", HK: "Asia",
  IN: "Asia", ID: "Asia", IR: "Asia", IQ: "Asia", IL: "Asia",
  JP: "Asia", JO: "Asia", KZ: "Asia", KW: "Asia", KG: "Asia",
  LA: "Asia", LB: "Asia", MY: "Asia", MV: "Asia", MN: "Asia",
  MM: "Asia", NP: "Asia", KP: "Asia", OM: "Asia", PK: "Asia",
  PH: "Asia", QA: "Asia", SA: "Asia", SG: "Asia", KR: "Asia",
  LK: "Asia", SY: "Asia", TW: "Asia", TJ: "Asia", TH: "Asia",
  TM: "Asia", AE: "Asia", UZ: "Asia", VN: "Asia", YE: "Asia",
  // Americas
  AG: "Americas", AR: "Americas", AW: "Americas", BS: "Americas", BB: "Americas",
  BZ: "Americas", BM: "Americas", BO: "Americas", BR: "Americas", CA: "Americas",
  KY: "Americas", CL: "Americas", CO: "Americas", CR: "Americas", CU: "Americas",
  CW: "Americas", DM: "Americas", DO: "Americas", EC: "Americas", SV: "Americas",
  GD: "Americas", GP: "Americas", GT: "Americas", GY: "Americas", HT: "Americas",
  HN: "Americas", JM: "Americas", MQ: "Americas", MX: "Americas", NI: "Americas",
  PA: "Americas", PY: "Americas", PE: "Americas", PR: "Americas", KN: "Americas",
  LC: "Americas", VC: "Americas", SR: "Americas", TT: "Americas", TC: "Americas",
  US: "Americas", UY: "Americas", VE: "Americas", VI: "Americas", VG: "Americas",
  // Oceania
  AU: "Oceania", FJ: "Oceania", PF: "Oceania", MP: "Oceania", NC: "Oceania",
  NZ: "Oceania", PG: "Oceania", WS: "Oceania", SB: "Oceania", TO: "Oceania",
  VU: "Oceania",
};

/**
 * Continent for a country CODE (uppercase ISO-2). Signature kept for callers
 * that previously passed English names — those now pass codes.
 */
export function getContinentForCountry(country: string | null | undefined): ExploreContinent | null {
  if (!country) return null;
  return COUNTRY_CODE_TO_CONTINENT[country] ?? null;
}

/** English display name for a country code, or the raw code when unknown. */
export function countryNameForCode(code: string | null | undefined): string {
  if (!code) return "";
  return ISO2_TO_COUNTRY[code] ?? code;
}

/**
 * Normalize a user-supplied country value into an uppercase ISO-2 code.
 * Accepts a known 2-letter code or a known English country name; returns
 * `null` when the value is unrecognized (callers then store it as-is).
 */
export function normalizeCountryCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper) && ISO2_TO_COUNTRY[upper]) return upper;
  return countryCodeForName(trimmed);
}

/** English country name → uppercase ISO-2 code, or null when unknown. */
export function countryCodeForName(name: string | null | undefined): string | null {
  if (!name) return null;
  const key = String(name).trim().toLowerCase();
  if (!key) return null;
  return COUNTRY_NAME_TO_CODE[key] ?? null;
}
