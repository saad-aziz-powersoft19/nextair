import { Airport, FlightWaypoint, FlightWaypointType } from '../types/flight';
import {
  EARTH_RADIUS_KM,
  calculateBearing,
  calculateDistanceKm,
  destinationPoint,
  interpolateGreatCirclePoint,
  normalizeLongitude,
  toRad,
} from './geodesics';
import type { NavAid } from './data/navaids';

const CORRIDOR_KM = 110;
const TERMINAL_MARGIN_KM = 100;
const MIN_FIX_SPACING_KM = 300;
const MAX_ENROUTE_FIXES = 14;
const DEPARTURE_FIX_DISTANCE_KM = 25;
const FINAL_FIX_DISTANCE_KM = 28;
const MIN_WAYPOINT_GAP_KM = 15;
const OCEANIC_FILL_TRIGGER_KM = 800;
const OCEANIC_FILL_SPACING_KM = 555;

export interface BuiltRoute {
  waypoints: FlightWaypoint[];
  totalDistanceKm: number;
  airline: { code: string; name: string } | null;
  flightNumber: string | null;
  isRealWorldRoute: boolean;
  enrouteFixCount: number;
  oceanicFixCount: number;
}

export interface CustomBuiltRoute {
  route: BuiltRoute;
  unresolved: string[];
  airways: string[];
  resolvedFixCount: number;
}

interface FinalizedRoute {
  waypoints: FlightWaypoint[];
  totalDistanceKm: number;
  enrouteFixCount: number;
  oceanicFixCount: number;
}

interface RouteVertex {
  lat: number;
  lng: number;
  name: string;
  type: FlightWaypointType;
}

function crossTrackDistanceKm(
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const pointAngle = calculateDistanceKm(aLat, aLng, pLat, pLng) / EARTH_RADIUS_KM;
  const pointBearing = toRad(calculateBearing(aLat, aLng, pLat, pLng));
  const legBearing = toRad(calculateBearing(aLat, aLng, bLat, bLng));
  return Math.asin(Math.sin(pointAngle) * Math.sin(pointBearing - legBearing)) * EARTH_RADIUS_KM;
}

function alongTrackDistanceKm(
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const pointAngle = calculateDistanceKm(aLat, aLng, pLat, pLng) / EARTH_RADIUS_KM;
  const crossTrackAngle =
    crossTrackDistanceKm(pLat, pLng, aLat, aLng, bLat, bLng) / EARTH_RADIUS_KM;
  const ratio = Math.min(1, Math.max(-1, Math.cos(pointAngle) / Math.cos(crossTrackAngle)));
  const pointBearing = calculateBearing(aLat, aLng, pLat, pLng);
  const legBearing = calculateBearing(aLat, aLng, bLat, bLng);
  const bearingDiff = ((pointBearing - legBearing + 540) % 360) - 180;
  const sign = Math.abs(bearingDiff) > 90 ? -1 : 1;
  return sign * Math.acos(ratio) * EARTH_RADIUS_KM;
}

function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

const OCEANIC_LAT_NAMES = ['N', 'S'];
const OCEANIC_LNG_NAMES = ['E', 'W'];

function oceanicWaypointName(lat: number, lng: number): string {
  const latLabel = `${String(Math.abs(Math.round(lat))).padStart(2, '0')}${
    OCEANIC_LAT_NAMES[lat >= 0 ? 0 : 1]
  }`;
  const lngLabel = `${String(Math.abs(Math.round(normalizeLongitude(lng)))).padStart(3, '0')}${
    OCEANIC_LNG_NAMES[lng >= 0 ? 0 : 1]
  }`;
  return `${latLabel}${lngLabel}`;
}

const PSEUDO_ROUTE_TOKENS = new Set(['DCT', 'SID', 'STAR', 'IFR', 'VFR']);
const ROUTE_SPEED_LEVEL_PATTERN = /^(?:N|M|K)\d{3,4}F\d{2,3}$/;
const FLIGHT_LEVEL_PATTERN = /^FL\d{2,3}$/;
const AIRWAY_PATTERN = /^(?:[A-Z]{1,2}\d{1,4}|NAT[A-Z]?|PACOTS|NOPAC)$/;

function coordinateFromParts(
  latDegrees: string,
  latMinutes: string,
  latHemisphere: string,
  lngDegrees: string,
  lngMinutes: string,
  lngHemisphere: string
): { lat: number; lng: number } | null {
  const latDeg = Number(latDegrees);
  const latMin = Number(latMinutes);
  const lngDeg = Number(lngDegrees);
  const lngMin = Number(lngMinutes);
  if (![latDeg, latMin, lngDeg, lngMin].every(Number.isFinite)) return null;
  if (latDeg > 90 || lngDeg > 180 || latMin >= 60 || lngMin >= 60) return null;
  if (latDeg === 90 && latMin !== 0) return null;
  if (lngDeg === 180 && lngMin !== 0) return null;

  const lat = (latDeg + latMin / 60) * (latHemisphere === 'S' ? -1 : 1);
  const lng = (lngDeg + lngMin / 60) * (lngHemisphere === 'W' ? -1 : 1);
  return { lat, lng: normalizeLongitude(lng) };
}

function parseCoordinateToken(token: string): { lat: number; lng: number } | null {
  const compact = token.toUpperCase().replace(/[^A-Z0-9]/g, '');
  let match = /^(\d{2})(\d{2})([NS])(\d{3})(\d{2})([EW])$/.exec(compact);
  if (match) {
    return coordinateFromParts(match[1], match[2], match[3], match[4], match[5], match[6]);
  }
  match = /^([NS])(\d{2})(\d{2})([EW])(\d{3})(\d{2})$/.exec(compact);
  if (match) {
    return coordinateFromParts(match[2], match[3], match[1], match[5], match[6], match[4]);
  }
  match = /^(\d{1,2})(\d{2})([NS])(\d{1,3})([EW])$/.exec(compact);
  if (match) {
    return coordinateFromParts(match[1], match[2], match[3], match[4], '0', match[5]);
  }
  match = /^([NS])(\d{1,2})(\d{2})([EW])(\d{1,3})$/.exec(compact);
  if (match) {
    return coordinateFromParts(match[2], match[3], match[1], match[5], '0', match[4]);
  }
  match = /^(\d{1,2})([NS])(\d{1,3})([EW])$/.exec(compact);
  if (match) {
    return coordinateFromParts(match[1], '0', match[2], match[3], '0', match[4]);
  }
  match = /^([NS])(\d{1,2})([EW])(\d{1,3})$/.exec(compact);
  if (match) {
    return coordinateFromParts(match[2], '0', match[1], match[4], '0', match[3]);
  }
  return null;
}

function chooseNavaid(
  candidates: NavAid[],
  origin: Airport,
  destination: Airport
): NavAid {
  if (candidates.length === 1) return candidates[0];
  let selected = candidates[0];
  let selectedCrossTrack = Math.abs(
    crossTrackDistanceKm(
      selected.lat,
      selected.lng,
      origin.lat,
      origin.lng,
      destination.lat,
      destination.lng
    )
  );
  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i];
    const crossTrack = Math.abs(
      crossTrackDistanceKm(
        candidate.lat,
        candidate.lng,
        origin.lat,
        origin.lng,
        destination.lat,
        destination.lng
      )
    );
    if (crossTrack < selectedCrossTrack) {
      selected = candidate;
      selectedCrossTrack = crossTrack;
    }
  }
  return selected;
}

function finalizeRoute(
  origin: Airport,
  destination: Airport,
  cruiseAltFt: number,
  vertices: RouteVertex[],
  enrouteFixCount: number
): FinalizedRoute {
  const pathVertices: RouteVertex[] = [vertices[0]];
  let oceanicFixCount = 0;
  for (let i = 1; i < vertices.length; i++) {
    const previous = pathVertices[pathVertices.length - 1];
    const current = vertices[i];
    const isFinalVertex = i === vertices.length - 1;
    const gapKm = calculateDistanceKm(previous.lat, previous.lng, current.lat, current.lng);

    if (!isFinalVertex && gapKm < MIN_WAYPOINT_GAP_KM) continue;

    if (gapKm > OCEANIC_FILL_TRIGGER_KM) {
      const fillCount = Math.max(1, Math.round(gapKm / OCEANIC_FILL_SPACING_KM) - 1);
      for (let j = 1; j <= fillCount; j++) {
        const point = interpolateGreatCirclePoint(
          previous.lat,
          previous.lng,
          current.lat,
          current.lng,
          j / (fillCount + 1)
        );
        pathVertices.push({
          ...point,
          name: oceanicWaypointName(point.lat, point.lng),
          type: 'oceanic',
        });
        oceanicFixCount += 1;
      }
    }
    pathVertices.push(current);
  }

  const segmentLengthsKm: number[] = [];
  let totalDistanceKm = 0;
  for (let i = 1; i < pathVertices.length; i++) {
    const segmentKm = calculateDistanceKm(
      pathVertices[i - 1].lat,
      pathVertices[i - 1].lng,
      pathVertices[i].lat,
      pathVertices[i].lng
    );
    segmentLengthsKm.push(segmentKm);
    totalDistanceKm += segmentKm;
  }

  const waypoints: FlightWaypoint[] = [];
  let cumulativeKm = 0;
  for (let i = 0; i < pathVertices.length; i++) {
    const vertex = pathVertices[i];
    if (i > 0) cumulativeKm += segmentLengthsKm[i - 1];
    const fraction = totalDistanceKm > 0 ? cumulativeKm / totalDistanceKm : 0;
    const bearing =
      i < pathVertices.length - 1
        ? calculateBearing(
            vertex.lat,
            vertex.lng,
            pathVertices[i + 1].lat,
            pathVertices[i + 1].lng
          )
        : destination.runwayHeading;

    let targetAlt = cruiseAltFt;
    if (fraction < 0.15) {
      targetAlt = origin.elevation + (cruiseAltFt - origin.elevation) * (fraction / 0.15);
    } else if (fraction > 0.85) {
      targetAlt =
        destination.elevation +
        (cruiseAltFt - destination.elevation) * ((1 - fraction) / 0.15);
    }

    waypoints.push({
      lat: vertex.lat,
      lng: vertex.lng,
      distanceFromOriginKm: cumulativeKm,
      bearing,
      targetAltitudeFt: Math.round(targetAlt),
      name: vertex.name,
      type: vertex.type,
    });
  }

  return {
    waypoints,
    totalDistanceKm,
    enrouteFixCount,
    oceanicFixCount,
  };
}

export async function buildRoute(
  origin: Airport,
  destination: Airport,
  cruiseAltFt: number
): Promise<BuiltRoute> {
  const { NAVAIDS } = await import('./data/navaids');
  const { REAL_ROUTES } = await import('./data/realRoutes');

  const gcDistanceKm = calculateDistanceKm(
    origin.lat,
    origin.lng,
    destination.lat,
    destination.lng
  );

  const departureFix = destinationPoint(
    origin.lat,
    origin.lng,
    origin.runwayHeading,
    DEPARTURE_FIX_DISTANCE_KM
  );
  const finalFix = destinationPoint(
    destination.lat,
    destination.lng,
    destination.runwayHeading + 180,
    FINAL_FIX_DISTANCE_KM
  );

  const spacingKm = Math.max(MIN_FIX_SPACING_KM, gcDistanceKm / MAX_ENROUTE_FIXES);
  const candidates: { nav: NavAid; alongTrackKm: number }[] = [];
  for (const nav of NAVAIDS) {
    const crossTrack = crossTrackDistanceKm(
      nav.lat,
      nav.lng,
      origin.lat,
      origin.lng,
      destination.lat,
      destination.lng
    );
    if (Math.abs(crossTrack) > CORRIDOR_KM) continue;
    const alongTrack = alongTrackDistanceKm(
      nav.lat,
      nav.lng,
      origin.lat,
      origin.lng,
      destination.lat,
      destination.lng
    );
    if (alongTrack < TERMINAL_MARGIN_KM || alongTrack > gcDistanceKm - TERMINAL_MARGIN_KM) {
      continue;
    }
    candidates.push({ nav, alongTrackKm: alongTrack });
  }
  candidates.sort((a, b) => a.alongTrackKm - b.alongTrackKm);

  const enrouteNavaids: NavAid[] = [];
  let lastAlongTrackKm = -Infinity;
  for (const candidate of candidates) {
    if (enrouteNavaids.length >= MAX_ENROUTE_FIXES) break;
    if (candidate.alongTrackKm - lastAlongTrackKm < spacingKm) continue;
    enrouteNavaids.push(candidate.nav);
    lastAlongTrackKm = candidate.alongTrackKm;
  }

  const vertices: RouteVertex[] = [
    { lat: origin.lat, lng: origin.lng, name: origin.code, type: 'airport' },
    { ...departureFix, name: `${origin.code}DEP`, type: 'sid' },
  ];
  for (const nav of enrouteNavaids) {
    vertices.push({ lat: nav.lat, lng: nav.lng, name: nav.ident, type: 'navaid' });
  }
  vertices.push({ ...finalFix, name: `${destination.code}FAF`, type: 'star' });
  vertices.push({
    lat: destination.lat,
    lng: destination.lng,
    name: destination.code,
    type: 'airport',
  });

  const finalized = finalizeRoute(
    origin,
    destination,
    cruiseAltFt,
    vertices,
    enrouteNavaids.length
  );

  const pairKey = [origin.code, destination.code].sort().join('-');
  const airlines = REAL_ROUTES[pairKey] ?? [];
  let airline: { code: string; name: string } | null = null;
  let flightNumber: string | null = null;
  if (airlines.length > 0) {
    const selected = airlines[hashString(pairKey) % airlines.length];
    airline = { code: selected.code, name: selected.name };
    const directionalKey = `${origin.code}-${destination.code}:${selected.code}`;
    const number = 100 + (hashString(directionalKey) % 8900);
    flightNumber = `${selected.code}${number}`;
  }

  return {
    ...finalized,
    airline,
    flightNumber,
    isRealWorldRoute: airline !== null,
  };
}

export async function buildRouteFromTokens(
  tokens: string[],
  origin: Airport,
  destination: Airport,
  cruiseAltFt: number,
  meta?: { airline?: { code: string; name: string } | null; flightNumber?: string | null }
): Promise<CustomBuiltRoute> {
  const { NAVAIDS } = await import('./data/navaids');
  const navByIdent = new Map<string, NavAid[]>();
  for (const nav of NAVAIDS) {
    const existing = navByIdent.get(nav.ident);
    if (existing) {
      existing.push(nav);
    } else {
      navByIdent.set(nav.ident, [nav]);
    }
  }

  const vertices: RouteVertex[] = [
    { lat: origin.lat, lng: origin.lng, name: origin.code, type: 'airport' },
  ];
  const unresolved = new Set<string>();
  const airways = new Set<string>();
  let enrouteFixCount = 0;
  let resolvedFixCount = 0;

  for (const rawToken of tokens) {
    const token = rawToken.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!token) continue;
    if (
      PSEUDO_ROUTE_TOKENS.has(token) ||
      ROUTE_SPEED_LEVEL_PATTERN.test(token) ||
      FLIGHT_LEVEL_PATTERN.test(token)
    ) {
      continue;
    }
    if (
      token === origin.code ||
      token === origin.icao ||
      token === destination.code ||
      token === destination.icao
    ) {
      continue;
    }

    const coordinate = parseCoordinateToken(token);
    if (coordinate) {
      vertices.push({ ...coordinate, name: token, type: 'oceanic' });
      resolvedFixCount += 1;
      continue;
    }

    const navaidCandidates = navByIdent.get(token);
    if (navaidCandidates && navaidCandidates.length > 0) {
      const nav = chooseNavaid(navaidCandidates, origin, destination);
      vertices.push({ lat: nav.lat, lng: nav.lng, name: nav.ident, type: 'navaid' });
      enrouteFixCount += 1;
      resolvedFixCount += 1;
      continue;
    }

    if (AIRWAY_PATTERN.test(token)) {
      airways.add(token);
      continue;
    }

    unresolved.add(token);
  }

  vertices.push({
    lat: destination.lat,
    lng: destination.lng,
    name: destination.code,
    type: 'airport',
  });

  const finalized = finalizeRoute(
    origin,
    destination,
    cruiseAltFt,
    vertices,
    enrouteFixCount
  );

  return {
    route: {
      ...finalized,
      airline: meta?.airline ?? null,
      flightNumber: meta?.flightNumber ?? null,
      isRealWorldRoute: false,
    },
    unresolved: Array.from(unresolved),
    airways: Array.from(airways),
    resolvedFixCount,
  };
}
