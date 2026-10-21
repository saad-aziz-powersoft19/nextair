export interface SolarPosition {
  declinationDeg: number;
  subsolarLngDeg: number;
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

function normalizeLongitude(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

export function getSolarPosition(date: Date): SolarPosition {
  const julianDay = date.getTime() / 86400000 + 2440587.5;
  const daysSinceJ2000 = julianDay - 2451545.0;

  const meanAnomaly = (357.529 + 0.98560028 * daysSinceJ2000) * DEG_TO_RAD;
  const meanLongitude = 280.459 + 0.98564736 * daysSinceJ2000;
  const eclipticLongitude =
    (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) *
    DEG_TO_RAD;
  const obliquity = (23.439 - 0.00000036 * daysSinceJ2000) * DEG_TO_RAD;

  const declinationDeg =
    Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude)) * RAD_TO_DEG;

  const rightAscensionDeg =
    Math.atan2(
      Math.cos(obliquity) * Math.sin(eclipticLongitude),
      Math.cos(eclipticLongitude)
    ) * RAD_TO_DEG;
  const siderealTimeDeg = 280.46061837 + 360.98564736629 * daysSinceJ2000;

  return {
    declinationDeg,
    subsolarLngDeg: normalizeLongitude(rightAscensionDeg - siderealTimeDeg),
  };
}

function terminatorLatitude(lng: number, sun: SolarPosition): number {
  const hourAngle = normalizeLongitude(lng - sun.subsolarLngDeg) * DEG_TO_RAD;
  const declination = sun.declinationDeg * DEG_TO_RAD;
  const lat = Math.atan(-Math.cos(hourAngle) / Math.tan(declination)) * RAD_TO_DEG;
  return Number.isNaN(lat) ? 0 : lat;
}

export function isNightAt(
  lat: number,
  lng: number,
  date: Date
): boolean {
  const sun = getSolarPosition(date);
  const hourAngle = normalizeLongitude(lng - sun.subsolarLngDeg) * DEG_TO_RAD;
  const declination = sun.declinationDeg * DEG_TO_RAD;
  const latitude = lat * DEG_TO_RAD;
  const solarElevation =
    Math.sin(latitude) * Math.sin(declination) +
    Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle);
  return solarElevation < 0;
}

export function buildNightPolygons(
  date: Date,
  stepDeg = 2
): [number, number][][] {
  const sun = getSolarPosition(date);
  const darkPoleLat = sun.declinationDeg >= 0 ? -90 : 90;
  const startLng = sun.subsolarLngDeg + 90;
  const endLng = sun.subsolarLngDeg + 270;

  const ring: [number, number][] = [];
  for (let lng = startLng; lng < endLng; lng += stepDeg) {
    ring.push([terminatorLatitude(lng, sun), lng]);
  }
  ring.push([terminatorLatitude(endLng, sun), endLng]);
  ring.push([darkPoleLat, endLng]);
  ring.push([darkPoleLat, startLng]);

  return [-360, 0, 360].map((lngOffset) =>
    ring.map(([lat, lng]) => [lat, lng + lngOffset] as [number, number])
  );
}
