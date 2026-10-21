export interface TrafficBounds {
  lamin: number;
  lomin: number;
  lamax: number;
  lomax: number;
}

export interface TrafficAircraft {
  icao24: string;
  callsign: string;
  country: string;
  lat: number;
  lng: number;
  altitudeFt: number;
  groundSpeedKts: number;
  heading: number;
  verticalRateFpm: number;
  onGround: boolean;
  squawk: string;
}

export interface TrafficSnapshot {
  aircraft: TrafficAircraft[];
  remainingCredits: number | null;
}

export class TrafficFetchError extends Error {
  readonly status: number;
  readonly remainingCredits: number | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    status: number,
    remainingCredits: number | null,
    retryAfterSeconds: number | null
  ) {
    super(`Traffic request failed with status ${status}`);
    this.name = 'TrafficFetchError';
    this.status = status;
    this.remainingCredits = remainingCredits;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseHeaderNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseTrafficStates(states: unknown): TrafficAircraft[] {
  if (!Array.isArray(states)) return [];

  const aircraft: TrafficAircraft[] = [];

  for (const entry of states) {
    if (!Array.isArray(entry)) continue;

    const icao24 = typeof entry[0] === 'string' ? entry[0].trim() : '';
    const lat = toFiniteNumber(entry[6]);
    const lng = toFiniteNumber(entry[5]);

    if (!icao24 || lat === null || lng === null) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;

    const callsign = typeof entry[1] === 'string' ? entry[1].trim() : '';
    const onGround = entry[8] === true;
    const baroAltitudeM = toFiniteNumber(entry[7]);
    const geoAltitudeM = toFiniteNumber(entry[13]);
    const altitudeM = baroAltitudeM ?? geoAltitudeM ?? 0;
    const velocityMs = toFiniteNumber(entry[9]) ?? 0;
    const trueTrack = toFiniteNumber(entry[10]) ?? 0;
    const verticalRateMs = toFiniteNumber(entry[11]) ?? 0;

    aircraft.push({
      icao24,
      callsign: callsign || icao24.toUpperCase(),
      country: typeof entry[2] === 'string' ? entry[2] : '',
      lat,
      lng,
      altitudeFt: onGround ? 0 : Math.max(0, Math.round(altitudeM * 3.28084)),
      groundSpeedKts: Math.max(0, Math.round(velocityMs * 1.94384)),
      heading: ((trueTrack % 360) + 360) % 360,
      verticalRateFpm: Math.round(verticalRateMs * 196.8504),
      onGround,
      squawk: typeof entry[14] === 'string' ? entry[14].trim() : '',
    });
  }

  return aircraft;
}

export async function fetchLiveTraffic(
  bounds: TrafficBounds,
  signal?: AbortSignal
): Promise<TrafficSnapshot> {
  const params = new URLSearchParams({
    lamin: bounds.lamin.toFixed(4),
    lomin: bounds.lomin.toFixed(4),
    lamax: bounds.lamax.toFixed(4),
    lomax: bounds.lomax.toFixed(4),
  });

  const response = await fetch(`/api/traffic?${params.toString()}`, {
    signal,
    cache: 'no-store',
  });

  const remainingCredits = parseHeaderNumber(
    response.headers.get('x-rate-limit-remaining')
  );
  const retryAfterSeconds = parseHeaderNumber(
    response.headers.get('x-rate-limit-retry-after-seconds')
  );

  if (!response.ok) {
    throw new TrafficFetchError(response.status, remainingCredits, retryAfterSeconds);
  }

  const payload = (await response.json()) as { states?: unknown };
  return {
    aircraft: parseTrafficStates(payload.states),
    remainingCredits,
  };
}
