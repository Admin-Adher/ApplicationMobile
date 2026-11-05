export const WEATHER_OPTIONS = ['sunny', 'cloudy', 'partlyCloudy', 'rain', 'storm', 'snow', 'fog', 'wind', 'snowShowers', 'showers'] as const;
const WEATHER_ICON_BY_KEY: Record<(typeof WEATHER_OPTIONS)[number], string> = {
  sunny: '☀️',
  cloudy: '⛅',
  partlyCloudy: '🌤️',
  rain: '🌧️',
  storm: '🌩️',
  snow: '❄️',
  fog: '🌫️',
  wind: '💨',
  snowShowers: '🌨️',
  showers: '🌦️',
};

export function getWeatherLabel(t: (key: string, options?: any) => string, key: (typeof WEATHER_OPTIONS)[number]): string {
  return `${WEATHER_ICON_BY_KEY[key]} ${t(`journal.weather.${key}`)}`;
}

function wmoCodesToLabel(wmo: number, t: (key: string, options?: any) => string): string {
  if (wmo === 0) return getWeatherLabel(t, 'sunny');
  if (wmo <= 2) return getWeatherLabel(t, 'partlyCloudy');
  if (wmo === 3) return getWeatherLabel(t, 'cloudy');
  if (wmo <= 49) return getWeatherLabel(t, 'fog');
  if (wmo <= 59) return getWeatherLabel(t, 'showers');
  if (wmo <= 69) return getWeatherLabel(t, 'rain');
  if (wmo <= 79) return getWeatherLabel(t, 'snow');
  if (wmo <= 84) return getWeatherLabel(t, 'showers');
  if (wmo <= 86) return getWeatherLabel(t, 'snowShowers');
  if (wmo <= 99) return getWeatherLabel(t, 'storm');
  return getWeatherLabel(t, 'cloudy');
}

export async function fetchOpenMeteo(
  latitude: number,
  longitude: number,
  t: (key: string, options?: any) => string,
): Promise<{ label: string; temp: number | null; wind: number | null; code: number } | null> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}&current=weather_code,temperature_2m,wind_speed_10m&timezone=auto&forecast_days=1`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const wmo = data.current?.weather_code;
  if (typeof wmo !== 'number' || !Number.isFinite(wmo)) return null;
  const temp: number | null = data.current?.temperature_2m ?? null;
  const wind: number | null = data.current?.wind_speed_10m ?? null;
  return { label: wmoCodesToLabel(wmo, t), temp, wind, code: wmo };
}

// Branche web : la géolocalisation du navigateur + le même appel open-meteo
// fonctionnent très bien sur navigateur (expo-location, lui, n'y est pas fiable).
export async function fetchAutoWeatherWeb(t: (key: string, options?: any) => string): Promise<{ label: string; temp: number | null; wind: number | null; code: number } | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
    const coords = await new Promise<{ latitude: number; longitude: number }>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        err => reject(err),
        { timeout: 15000, maximumAge: 60000 },
      );
    });
    return await fetchOpenMeteo(coords.latitude, coords.longitude, t);
  } catch {
    return null;
  }
}
