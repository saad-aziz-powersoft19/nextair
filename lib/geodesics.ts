import { FlightWaypoint } from '../types/flight';

export const EARTH_RADIUS_KM = 6371.0;
export const KM_TO_NAUTICAL_MILES = 0.539957;

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function normalizeLongitude(lng: number): number {
  let normalized = lng;
  while (normalized > 180) normalized -= 360;
  while (normalized < -180) normalized += 360;
  return normalized;
}

/**
 * Calculates Haversine distance in kilometers between two points
 */
export function calculateDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const rLat1 = toRad(lat1);
  const rLat2 = toRad(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(rLat1) * Math.cos(rLat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_KM * c;
}

/**
 * Calculates initial Great Circle bearing from point 1 to point 2 (0 - 359 degrees)
 */
export function calculateBearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaLambda = toRad(lng2 - lng1);

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  const theta = Math.atan2(y, x);
  const bearing = (toDeg(theta) + 360) % 360;
  return Math.round(bearing * 10) / 10;
}

/**
 * Calculates intermediate point along great circle path at fraction f (0.0 to 1.0)
 */
export function interpolateGreatCirclePoint(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  f: number
): { lat: number; lng: number } {
  if (f <= 0) return { lat: lat1, lng: lng1 };
  if (f >= 1) return { lat: lat2, lng: lng2 };

  const phi1 = toRad(lat1);
  const lambda1 = toRad(lng1);
  const phi2 = toRad(lat2);
  const lambda2 = toRad(lng2);

  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.pow(Math.sin((phi1 - phi2) / 2), 2) +
          Math.cos(phi1) * Math.cos(phi2) * Math.pow(Math.sin((lambda1 - lambda2) / 2), 2)
      )
    );

  if (d < 1e-6) {
    return { lat: lat1, lng: lng1 };
  }

  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);

  const x = A * Math.cos(phi1) * Math.cos(lambda1) + B * Math.cos(phi2) * Math.cos(lambda2);
  const y = A * Math.cos(phi1) * Math.sin(lambda1) + B * Math.cos(phi2) * Math.sin(lambda2);
  const z = A * Math.sin(phi1) + B * Math.sin(phi2);

  const phi = Math.atan2(z, Math.sqrt(x * x + y * y));
  const lambda = Math.atan2(y, x);

  return {
    lat: toDeg(phi),
    lng: toDeg(lambda),
  };
}

/**
 * Computes the destination point given a start point, initial bearing, and distance
 */
export function destinationPoint(
  lat: number,
  lng: number,
  bearingDeg: number,
  distanceKm: number
): { lat: number; lng: number } {
  const angularDistance = distanceKm / EARTH_RADIUS_KM;
  const theta = toRad(bearingDeg);
  const phi1 = toRad(lat);
  const lambda1 = toRad(lng);

  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(angularDistance) +
      Math.cos(phi1) * Math.sin(angularDistance) * Math.cos(theta)
  );

  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(angularDistance) * Math.cos(phi1),
      Math.cos(angularDistance) - Math.sin(phi1) * Math.sin(phi2)
    );

  return { lat: toDeg(phi2), lng: normalizeLongitude(toDeg(lambda2)) };
}

/**
 * Interpolates position and heading along a waypoint path by traveled distance.
 * Handles antimeridian crossings and segments matching the drawn polyline geometry.
 */
export function interpolateAlongPath(
  waypoints: FlightWaypoint[],
  distanceKm: number
): { lat: number; lng: number; heading: number } {
  const first = waypoints[0];
  const last = waypoints[waypoints.length - 1];

  if (waypoints.length < 2 || distanceKm <= first.distanceFromOriginKm) {
    return { lat: first.lat, lng: first.lng, heading: first.bearing };
  }
  if (distanceKm >= last.distanceFromOriginKm) {
    return { lat: last.lat, lng: last.lng, heading: last.bearing };
  }

  let segmentStart = first;
  let segmentEnd = last;
  for (let i = 1; i < waypoints.length; i++) {
    if (distanceKm <= waypoints[i].distanceFromOriginKm) {
      segmentStart = waypoints[i - 1];
      segmentEnd = waypoints[i];
      break;
    }
  }

  const spanKm = segmentEnd.distanceFromOriginKm - segmentStart.distanceFromOriginKm;
  const t = spanKm > 1e-6 ? (distanceKm - segmentStart.distanceFromOriginKm) / spanKm : 0;

  let deltaLng = segmentEnd.lng - segmentStart.lng;
  if (deltaLng > 180) deltaLng -= 360;
  else if (deltaLng < -180) deltaLng += 360;

  return {
    lat: segmentStart.lat + (segmentEnd.lat - segmentStart.lat) * t,
    lng: normalizeLongitude(segmentStart.lng + deltaLng * t),
    heading: segmentStart.bearing,
  };
}

/**
 * Handles antimeridian / date line crossing for Leaflet polylines.
 * If longitude jump between consecutive points is > 180 degrees, splits into separate segments.
 */
export function splitPolylineAtAntimeridian(
  points: [number, number][]
): [number, number][][] {
  if (points.length === 0) return [];
  const segments: [number, number][][] = [];
  let currentSegment: [number, number][] = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];

    // If crossing the 180th meridian (e.g. from +179 to -179 or vice versa)
    if (Math.abs(curr[1] - prev[1]) > 180) {
      segments.push(currentSegment);
      currentSegment = [curr];
    } else {
      currentSegment.push(curr);
    }
  }

  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  return segments;
}

