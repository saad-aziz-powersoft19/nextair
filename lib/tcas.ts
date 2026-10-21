import type { FlightPhase, LiveTelemetry } from '../types/flight';
import type { TrafficAircraft } from './traffic';

export type TcasLevel = 'traffic' | 'resolution';

export interface TcasAdvisory {
  aircraft: TrafficAircraft;
  level: TcasLevel;
  rangeNm: number;
  bearingDeg: number;
  relativeAltitudeFt: number;
  timeToCpaSeconds: number | null;
  cpaNm: number;
  closureKts: number;
  command: 'CLIMB' | 'DESCEND' | 'MONITOR';
}

export interface TrafficRelativePosition {
  rangeNm: number;
  bearingDeg: number;
  relativeAltitudeFt: number;
}

const RAD = Math.PI / 180;
const AIRBORNE_PHASES = new Set<FlightPhase>([
  'CLIMB',
  'CRUISE',
  'APPROACH_READY',
  'DESCENT',
  'FINAL_APPROACH',
]);
const TCAS_RANGE_NM = 8;
const TA_LOOKAHEAD_SECONDS = 60;
const RA_LOOKAHEAD_SECONDS = 30;
const TA_CPA_NM = 3;
const RA_CPA_NM = 1.5;
const TA_VERTICAL_FT = 1200;
const RA_VERTICAL_FT = 800;

function normalizeLongitudeDelta(delta: number): number {
  let value = delta;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}

function relativeVector(ownship: LiveTelemetry, aircraft: TrafficAircraft) {
  const meanLat = ((ownship.lat + aircraft.lat) / 2) * RAD;
  const dx = normalizeLongitudeDelta(aircraft.lng - ownship.lng) * 60 * Math.cos(meanLat);
  const dy = (aircraft.lat - ownship.lat) * 60;
  return { dx, dy };
}

export function getTrafficRelativePosition(
  ownship: LiveTelemetry,
  aircraft: TrafficAircraft
): TrafficRelativePosition {
  const { dx, dy } = relativeVector(ownship, aircraft);
  return {
    rangeNm: Math.hypot(dx, dy),
    bearingDeg: (Math.atan2(dx, dy) / RAD + 360) % 360,
    relativeAltitudeFt: aircraft.altitudeFt - ownship.altitudeFt,
  };
}

export function isTcasActive(ownship: LiveTelemetry): boolean {
  return AIRBORNE_PHASES.has(ownship.phase) && ownship.altitudeFt >= 400;
}

export function computeTcasAdvisories(
  ownship: LiveTelemetry,
  traffic: TrafficAircraft[],
  limit = 3
): TcasAdvisory[] {
  if (!isTcasActive(ownship)) return [];

  const ownVx = ownship.groundSpeedKnots * Math.sin(ownship.heading * RAD);
  const ownVy = ownship.groundSpeedKnots * Math.cos(ownship.heading * RAD);
  const advisories: TcasAdvisory[] = [];

  for (const aircraft of traffic) {
    if (aircraft.onGround) continue;

    const { dx, dy } = relativeVector(ownship, aircraft);
    const rangeNm = Math.hypot(dx, dy);
    if (rangeNm > TCAS_RANGE_NM) continue;

    const relativeAltitudeFt = aircraft.altitudeFt - ownship.altitudeFt;
    if (Math.abs(relativeAltitudeFt) > TA_VERTICAL_FT) continue;

    const otherVx = aircraft.groundSpeedKts * Math.sin(aircraft.heading * RAD);
    const otherVy = aircraft.groundSpeedKts * Math.cos(aircraft.heading * RAD);
    const relativeVx = otherVx - ownVx;
    const relativeVy = otherVy - ownVy;
    const relativeSpeedSquared = relativeVx * relativeVx + relativeVy * relativeVy;

    let timeToCpaSeconds: number | null = null;
    let cpaNm = rangeNm;

    if (relativeSpeedSquared > 1) {
      const timeToCpaHours = -(dx * relativeVx + dy * relativeVy) / relativeSpeedSquared;
      if (timeToCpaHours > 0) {
        timeToCpaSeconds = timeToCpaHours * 3600;
        cpaNm = Math.hypot(
          dx + relativeVx * timeToCpaHours,
          dy + relativeVy * timeToCpaHours
        );
      }
    }

    if (timeToCpaSeconds === null || timeToCpaSeconds > TA_LOOKAHEAD_SECONDS) continue;

    const isResolution =
      timeToCpaSeconds <= RA_LOOKAHEAD_SECONDS &&
      cpaNm <= RA_CPA_NM &&
      rangeNm <= 3.5 &&
      Math.abs(relativeAltitudeFt) <= RA_VERTICAL_FT;
    const isTraffic =
      !isResolution &&
      cpaNm <= TA_CPA_NM &&
      Math.abs(relativeAltitudeFt) <= TA_VERTICAL_FT;

    if (!isResolution && !isTraffic) continue;

    const closureKts =
      rangeNm > 0.01 ? Math.max(0, -(dx * relativeVx + dy * relativeVy) / rangeNm) : 0;

    advisories.push({
      aircraft,
      level: isResolution ? 'resolution' : 'traffic',
      rangeNm,
      bearingDeg: (Math.atan2(dx, dy) / RAD + 360) % 360,
      relativeAltitudeFt,
      timeToCpaSeconds,
      cpaNm,
      closureKts,
      command: isResolution
        ? relativeAltitudeFt >= 0
          ? 'DESCEND'
          : 'CLIMB'
        : 'MONITOR',
    });
  }

  return advisories
    .sort((a, b) => {
      const levelRank = Number(b.level === 'resolution') - Number(a.level === 'resolution');
      if (levelRank !== 0) return levelRank;
      return a.rangeNm - b.rangeNm;
    })
    .slice(0, limit);
}
