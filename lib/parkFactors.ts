// Park factors: >1.0 = hitter friendly, <1.0 = pitcher friendly
// Based on 2024 multi-year averages
export const PARK_FACTORS: Record<number, { name: string; factor: number; label: string }> = {
  1:    { name: "Oriole Park at Camden Yards",      factor: 1.03, label: "Neutral" },
  2:    { name: "Fenway Park",                       factor: 1.08, label: "Hitter Friendly" },
  3:    { name: "Yankee Stadium",                    factor: 1.05, label: "Hitter Friendly" },
  4:    { name: "Tropicana Field",                   factor: 0.92, label: "Pitcher Friendly" },
  5:    { name: "Rogers Centre",                     factor: 1.04, label: "Neutral" },
  7:    { name: "Guaranteed Rate Field",             factor: 0.97, label: "Neutral" },
  11:   { name: "Progressive Field",                 factor: 0.96, label: "Pitcher Friendly" },
  12:   { name: "Comerica Park",                     factor: 0.93, label: "Pitcher Friendly" },
  15:   { name: "Kauffman Stadium",                  factor: 0.98, label: "Neutral" },
  16:   { name: "Target Field",                      factor: 1.01, label: "Neutral" },
  17:   { name: "Minute Maid Park",                  factor: 0.99, label: "Neutral" },
  18:   { name: "Globe Life Field",                  factor: 0.96, label: "Pitcher Friendly" },
  19:   { name: "Angel Stadium",                     factor: 0.97, label: "Neutral" },
  20:   { name: "Oakland Coliseum",                  factor: 0.89, label: "Pitcher Friendly" },
  21:   { name: "T-Mobile Park",                     factor: 0.94, label: "Pitcher Friendly" },
  22:   { name: "Citizens Bank Park",                factor: 1.08, label: "Hitter Friendly" },
  29:   { name: "Citi Field",                        factor: 0.95, label: "Pitcher Friendly" },
  31:   { name: "Nationals Park",                    factor: 0.97, label: "Neutral" },
  32:   { name: "Truist Park",                       factor: 1.02, label: "Neutral" },
  34:   { name: "American Family Field",             factor: 1.07, label: "Hitter Friendly" },
  35:   { name: "Wrigley Field",                     factor: 1.04, label: "Neutral" },
  36:   { name: "Busch Stadium",                     factor: 0.96, label: "Pitcher Friendly" },
  37:   { name: "Great American Ball Park",          factor: 1.12, label: "Very Hitter Friendly" },
  38:   { name: "PNC Park",                          factor: 0.95, label: "Pitcher Friendly" },
  40:   { name: "Chase Field",                       factor: 1.06, label: "Hitter Friendly" },
  41:   { name: "Coors Field",                       factor: 1.24, label: "Very Hitter Friendly" },
  42:   { name: "Dodger Stadium",                    factor: 0.95, label: "Pitcher Friendly" },
  43:   { name: "Petco Park",                        factor: 0.91, label: "Pitcher Friendly" },
  44:   { name: "Oracle Park",                       factor: 0.88, label: "Pitcher Friendly" },
  680:  { name: "loanDepot park",                    factor: 0.90, label: "Pitcher Friendly" },
};

// Lookup by venue ID from MLB API
export function getParkFactor(venueId: number): { factor: number; label: string } {
  return PARK_FACTORS[venueId] ?? { factor: 1.0, label: "Neutral" };
}
