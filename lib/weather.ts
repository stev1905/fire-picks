import { getVenueCoords, isIndoorVenue } from "./parkFactors";

export interface WeatherData {
  indoor: false;
  tempF: number;
  windMph: number;
  windDir: string;
  windDeg: number; // meteorological degrees — where wind is coming FROM (0=N, 90=E, 180=S, 270=W)
  precipChance: number;
  condition: string;
  icon: string;
}

export interface IndoorData {
  indoor: true;
}

export type GameWeather = WeatherData | IndoorData;

function windDirLabel(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

function describeCode(code: number): { condition: string; icon: string } {
  if (code === 0) return { condition: "Clear", icon: "☀️" };
  if (code <= 2) return { condition: "Partly Cloudy", icon: "⛅" };
  if (code === 3) return { condition: "Overcast", icon: "☁️" };
  if (code <= 49) return { condition: "Foggy", icon: "🌫️" };
  if (code <= 57) return { condition: "Drizzle", icon: "🌦️" };
  if (code <= 67) return { condition: "Rain", icon: "🌧️" };
  if (code <= 77) return { condition: "Snow", icon: "❄️" };
  if (code <= 82) return { condition: "Showers", icon: "🌦️" };
  if (code <= 86) return { condition: "Snow Showers", icon: "🌨️" };
  if (code <= 99) return { condition: "Thunderstorm", icon: "⛈️" };
  return { condition: "Unknown", icon: "🌡️" };
}

export async function getGameWeather(venueId: number, gameDate: string): Promise<GameWeather> {
  if (isIndoorVenue(venueId)) return { indoor: true };

  const coords = getVenueCoords(venueId);
  if (!coords) return { indoor: true };

  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", coords.lat.toString());
    url.searchParams.set("longitude", coords.lng.toString());
    url.searchParams.set("hourly", "temperature_2m,precipitation_probability,windspeed_10m,winddirection_10m,weathercode");
    url.searchParams.set("temperature_unit", "fahrenheit");
    url.searchParams.set("windspeed_unit", "mph");
    url.searchParams.set("timezone", "UTC");
    url.searchParams.set("forecast_days", "2");

    const res = await fetch(url.toString(), { next: { revalidate: 3600 } });
    if (!res.ok) return { indoor: true };

    const json = await res.json();
    const times: string[] = json.hourly.time;

    // Match UTC hour from game ISO string (e.g. "2026-04-01T23:10:00Z" → "2026-04-01T23")
    const gameUTCHour = gameDate.slice(0, 13);
    let idx = times.findIndex((t) => t.startsWith(gameUTCHour));
    if (idx < 0) {
      // Fall back to closest future time
      idx = times.findIndex((t) => t >= gameUTCHour);
    }
    if (idx < 0) return { indoor: true };

    const windDeg: number = json.hourly.winddirection_10m[idx] ?? 0;
    const { condition, icon } = describeCode(json.hourly.weathercode[idx]);
    return {
      indoor: false,
      tempF: Math.round(json.hourly.temperature_2m[idx]),
      windMph: Math.round(json.hourly.windspeed_10m[idx]),
      windDir: windDirLabel(windDeg),
      windDeg,
      precipChance: json.hourly.precipitation_probability[idx] ?? 0,
      condition,
      icon,
    };
  } catch {
    return { indoor: true };
  }
}
