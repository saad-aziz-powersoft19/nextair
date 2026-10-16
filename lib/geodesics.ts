import { Airport, FlightWaypoint } from '@/types/flight';

export const EARTH_RADIUS_KM = 6371.0;
export const KM_TO_NAUTICAL_MILES = 0.539957;

export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
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
 * Generates an array of waypoints along the Great Circle route
 */
export function generateGreatCircleRoute(
  origin: Airport,
  destination: Airport,
  cruiseAltFt: number,
  numSegments = 120
): FlightWaypoint[] {
  const totalDistKm = calculateDistanceKm(
    origin.lat,
    origin.lng,
    destination.lat,
    destination.lng
  );

  const waypoints: FlightWaypoint[] = [];

  for (let i = 0; i <= numSegments; i++) {
    const fraction = i / numSegments;
    const pt = interpolateGreatCirclePoint(
      origin.lat,
      origin.lng,
      destination.lat,
      destination.lng,
      fraction
    );

    const distFromOrigin = totalDistKm * fraction;

    // Calculate heading towards the next point (or arrival runway heading at last point)
    let heading = 0;
    if (i < numSegments) {
      const nextPt = interpolateGreatCirclePoint(
        origin.lat,
        origin.lng,
        destination.lat,
        destination.lng,
        (i + 1) / numSegments
      );
      heading = calculateBearing(pt.lat, pt.lng, nextPt.lat, nextPt.lng);
    } else {
      heading = destination.runwayHeading;
    }

    // Altitude profile target
    let targetAlt = cruiseAltFt;
    if (fraction < 0.15) {
      targetAlt = origin.elevation + (cruiseAltFt - origin.elevation) * (fraction / 0.15);
    } else if (fraction > 0.85) {
      targetAlt =
        destination.elevation +
        (cruiseAltFt - destination.elevation) * ((1 - fraction) / 0.15);
    }

    waypoints.push({
      lat: pt.lat,
      lng: pt.lng,
      distanceFromOriginKm: distFromOrigin,
      bearing: heading,
      targetAltitudeFt: Math.round(targetAlt),
    });
  }

  return waypoints;
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

