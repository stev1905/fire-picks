// Park factors: >1.0 = hitter friendly, <1.0 = pitcher friendly
// Based on 2024 multi-year averages
// cfBearing: compass degrees from home plate to CF (0=N, 90=E, 180=S, 270=W)
// lf/rf: field dimensions in feet (left field, right field)
export const PARK_FACTORS: Record<number, {
  name: string;
  factor: number;
  label: string;
  lat?: number;
  lng?: number;
  indoor?: boolean;
  lf?: number;
  rf?: number;
  cfBearing?: number;
}> = {
  1:    { name: "Oriole Park at Camden Yards",      factor: 1.03, label: "Neutral",               lat: 39.284,  lng: -76.622,   lf: 333, rf: 318, cfBearing: 340 },
  2:    { name: "Fenway Park",                       factor: 1.08, label: "Hitter Friendly",       lat: 42.347,  lng: -71.097,   lf: 310, rf: 302, cfBearing:  95 },
  3:    { name: "Yankee Stadium",                    factor: 1.05, label: "Hitter Friendly",       lat: 40.829,  lng: -73.926,   lf: 318, rf: 314, cfBearing: 230 },
  4:    { name: "Tropicana Field",                   factor: 0.92, label: "Pitcher Friendly",      indoor: true, lf: 315, rf: 322, cfBearing:   0 },
  5:    { name: "Rogers Centre",                     factor: 1.04, label: "Neutral",               lat: 43.641,  lng: -79.389,   lf: 328, rf: 328, cfBearing:  25 },
  7:    { name: "Guaranteed Rate Field",             factor: 0.97, label: "Neutral",               lat: 41.830,  lng: -87.634,   lf: 330, rf: 335, cfBearing:  45 },
  11:   { name: "Progressive Field",                 factor: 0.96, label: "Pitcher Friendly",      lat: 41.496,  lng: -81.685,   lf: 325, rf: 325, cfBearing: 190 },
  12:   { name: "Comerica Park",                     factor: 0.93, label: "Pitcher Friendly",      lat: 42.339,  lng: -83.049,   lf: 345, rf: 330, cfBearing:  10 },
  15:   { name: "Kauffman Stadium",                  factor: 0.98, label: "Neutral",               lat: 39.051,  lng: -94.480,   lf: 330, rf: 330, cfBearing:  10 },
  16:   { name: "Target Field",                      factor: 1.01, label: "Neutral",               lat: 44.982,  lng: -93.278,   lf: 339, rf: 328, cfBearing: 330 },
  17:   { name: "Minute Maid Park",                  factor: 0.99, label: "Neutral",               lat: 29.757,  lng: -95.356,   lf: 315, rf: 326, cfBearing: 245 },
  18:   { name: "Globe Life Field",                  factor: 0.96, label: "Pitcher Friendly",      lat: 32.747,  lng: -97.083,   lf: 334, rf: 326, cfBearing: 325 },
  19:   { name: "Angel Stadium",                     factor: 0.97, label: "Neutral",               lat: 33.800,  lng: -117.883,  lf: 330, rf: 330, cfBearing:  75 },
  20:   { name: "Oakland Coliseum",                  factor: 0.89, label: "Pitcher Friendly",      lat: 37.752,  lng: -122.201,  lf: 330, rf: 330, cfBearing: 330 },
  21:   { name: "T-Mobile Park",                     factor: 0.94, label: "Pitcher Friendly",      lat: 47.591,  lng: -122.332,  lf: 331, rf: 326, cfBearing: 335 },
  22:   { name: "Citizens Bank Park",                factor: 1.08, label: "Hitter Friendly",       lat: 39.906,  lng: -75.166,   lf: 329, rf: 330, cfBearing:  10 },
  29:   { name: "Citi Field",                        factor: 0.95, label: "Pitcher Friendly",      lat: 40.757,  lng: -73.846,   lf: 335, rf: 330, cfBearing:  35 },
  31:   { name: "Nationals Park",                    factor: 0.97, label: "Neutral",               lat: 38.873,  lng: -77.008,   lf: 336, rf: 335, cfBearing: 270 },
  32:   { name: "Truist Park",                       factor: 1.02, label: "Neutral",               lat: 33.891,  lng: -84.468,   lf: 335, rf: 325, cfBearing:  45 },
  34:   { name: "American Family Field",             factor: 1.07, label: "Hitter Friendly",       lat: 43.028,  lng: -87.971,   lf: 344, rf: 345, cfBearing:   5 },
  35:   { name: "Wrigley Field",                     factor: 1.04, label: "Neutral",               lat: 41.948,  lng: -87.656,   lf: 355, rf: 353, cfBearing:  30 },
  36:   { name: "Busch Stadium",                     factor: 0.96, label: "Pitcher Friendly",      lat: 38.623,  lng: -90.193,   lf: 336, rf: 335, cfBearing: 220 },
  37:   { name: "Great American Ball Park",          factor: 1.12, label: "Very Hitter Friendly",  lat: 39.098,  lng: -84.507,   lf: 328, rf: 325, cfBearing:  30 },
  38:   { name: "PNC Park",                          factor: 0.95, label: "Pitcher Friendly",      lat: 40.447,  lng: -80.006,   lf: 325, rf: 320, cfBearing: 100 },
  40:   { name: "Chase Field",                       factor: 1.06, label: "Hitter Friendly",       lat: 33.446,  lng: -112.067,  lf: 330, rf: 334, cfBearing: 220 },
  41:   { name: "Coors Field",                       factor: 1.24, label: "Very Hitter Friendly",  lat: 39.756,  lng: -104.994,  lf: 347, rf: 350, cfBearing: 165 },
  42:   { name: "Dodger Stadium",                    factor: 0.95, label: "Pitcher Friendly",      lat: 34.074,  lng: -118.240,  lf: 330, rf: 330, cfBearing: 290 },
  43:   { name: "Petco Park",                        factor: 0.91, label: "Pitcher Friendly",      lat: 32.708,  lng: -117.157,  lf: 336, rf: 322, cfBearing: 310 },
  44:   { name: "Oracle Park",                       factor: 0.88, label: "Pitcher Friendly",      lat: 37.779,  lng: -122.389,  lf: 339, rf: 309, cfBearing: 120 },
  680:  { name: "loanDepot park",                    factor: 0.90, label: "Pitcher Friendly",      lat: 25.778,  lng: -80.220,   lf: 344, rf: 335, cfBearing: 340 },
};

// Lookup by venue ID from MLB API
export function getParkFactor(venueId: number): { factor: number; label: string } {
  return PARK_FACTORS[venueId] ?? { factor: 1.0, label: "Neutral" };
}

// Full park data for score calculations
export function getParkData(venueId: number) {
  const p = PARK_FACTORS[venueId];
  return {
    factor:     p?.factor     ?? 1.0,
    label:      p?.label      ?? "Neutral",
    lf:         p?.lf         ?? 330,
    rf:         p?.rf         ?? 330,
    cfBearing:  p?.cfBearing  ?? 0,
    indoor:     p?.indoor     ?? false,
  };
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
