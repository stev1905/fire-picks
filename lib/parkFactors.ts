// Park factors: >1.0 = hitter friendly, <1.0 = pitcher friendly
// Based on 2024 multi-year averages
export const PARK_FACTORS: Record<number, { name: string; factor: number; label: string; lat?: number; lng?: number; indoor?: boolean }> = {
  1:    { name: "Oriole Park at Camden Yards",      factor: 1.03, label: "Neutral",               lat: 39.284,  lng: -76.622 },
  2:    { name: "Fenway Park",                       factor: 1.08, label: "Hitter Friendly",       lat: 42.347,  lng: -71.097 },
  3:    { name: "Yankee Stadium",                    factor: 1.05, label: "Hitter Friendly",       lat: 40.829,  lng: -73.926 },
  4:    { name: "Tropicana Field",                   factor: 0.92, label: "Pitcher Friendly",      indoor: true },
  5:    { name: "Rogers Centre",                     factor: 1.04, label: "Neutral",               lat: 43.641,  lng: -79.389 },
  7:    { name: "Guaranteed Rate Field",             factor: 0.97, label: "Neutral",               lat: 41.830,  lng: -87.634 },
  11:   { name: "Progressive Field",                 factor: 0.96, label: "Pitcher Friendly",      lat: 41.496,  lng: -81.685 },
  12:   { name: "Comerica Park",                     factor: 0.93, label: "Pitcher Friendly",      lat: 42.339,  lng: -83.049 },
  15:   { name: "Kauffman Stadium",                  factor: 0.98, label: "Neutral",               lat: 39.051,  lng: -94.480 },
  16:   { name: "Target Field",                      factor: 1.01, label: "Neutral",               lat: 44.982,  lng: -93.278 },
  17:   { name: "Minute Maid Park",                  factor: 0.99, label: "Neutral",               lat: 29.757,  lng: -95.356 },
  18:   { name: "Globe Life Field",                  factor: 0.96, label: "Pitcher Friendly",      lat: 32.747,  lng: -97.083 },
  19:   { name: "Angel Stadium",                     factor: 0.97, label: "Neutral",               lat: 33.800,  lng: -117.883 },
  20:   { name: "Oakland Coliseum",                  factor: 0.89, label: "Pitcher Friendly",      lat: 37.752,  lng: -122.201 },
  21:   { name: "T-Mobile Park",                     factor: 0.94, label: "Pitcher Friendly",      lat: 47.591,  lng: -122.332 },
  22:   { name: "Citizens Bank Park",                factor: 1.08, label: "Hitter Friendly",       lat: 39.906,  lng: -75.166 },
  29:   { name: "Citi Field",                        factor: 0.95, label: "Pitcher Friendly",      lat: 40.757,  lng: -73.846 },
  31:   { name: "Nationals Park",                    factor: 0.97, label: "Neutral",               lat: 38.873,  lng: -77.008 },
  32:   { name: "Truist Park",                       factor: 1.02, label: "Neutral",               lat: 33.891,  lng: -84.468 },
  34:   { name: "American Family Field",             factor: 1.07, label: "Hitter Friendly",       lat: 43.028,  lng: -87.971 },
  35:   { name: "Wrigley Field",                     factor: 1.04, label: "Neutral",               lat: 41.948,  lng: -87.656 },
  36:   { name: "Busch Stadium",                     factor: 0.96, label: "Pitcher Friendly",      lat: 38.623,  lng: -90.193 },
  37:   { name: "Great American Ball Park",          factor: 1.12, label: "Very Hitter Friendly",  lat: 39.098,  lng: -84.507 },
  38:   { name: "PNC Park",                          factor: 0.95, label: "Pitcher Friendly",      lat: 40.447,  lng: -80.006 },
  40:   { name: "Chase Field",                       factor: 1.06, label: "Hitter Friendly",       lat: 33.446,  lng: -112.067 },
  41:   { name: "Coors Field",                       factor: 1.24, label: "Very Hitter Friendly",  lat: 39.756,  lng: -104.994 },
  42:   { name: "Dodger Stadium",                    factor: 0.95, label: "Pitcher Friendly",      lat: 34.074,  lng: -118.240 },
  43:   { name: "Petco Park",                        factor: 0.91, label: "Pitcher Friendly",      lat: 32.708,  lng: -117.157 },
  44:   { name: "Oracle Park",                       factor: 0.88, label: "Pitcher Friendly",      lat: 37.779,  lng: -122.389 },
  680:  { name: "loanDepot park",                    factor: 0.90, label: "Pitcher Friendly",      lat: 25.778,  lng: -80.220 },
};

// Lookup by venue ID from MLB API
export function getParkFactor(venueId: number): { factor: number; label: string } {
  return PARK_FACTORS[venueId] ?? { factor: 1.0, label: "Neutral" };
}

// Lookup weather coords by venue ID
export function getVenueCoords(venueId: number): { lat: number; lng: number } | null {
  const park = PARK_FACTORS[venueId];
  if (!park || park.indoor || !park.lat || !park.lng) return null;
  return { lat: park.lat, lng: park.lng };
}

export function isIndoorVenue(venueId: number): boolean {
  return PARK_FACTORS[venueId]?.indoor === true;
}
