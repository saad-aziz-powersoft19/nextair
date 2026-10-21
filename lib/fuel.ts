import { Aircraft, Airport, FlightPhase, FuelPlan } from '../types/flight';
import { AIRPORTS } from './airports';
import { calculateDistanceKm } from './geodesics';

export const CONTINGENCY_FRACTION = 0.05;
export const FINAL_RESERVE_MINUTES = 30;
export const ALTERNATE_PENALTY_FACTOR = 1.2;
export const TIGHT_FUEL_RATIO = 0.92;

export const TAXI_FUEL_BY_TYPE: Record<Aircraft['type'], number> = {
  general: 40,
  business: 120,
  narrowbody: 250,
  widebody: 550,
  supersonic: 1200,
};

const FUEL_FLOW_FACTORS: Record<FlightPhase, number> = {
  PRE_FLIGHT: 0,
  TAXI: 0.08,
  TAXI_TAKEOFF: 0.12,
  CLIMB: 1.9,
  CRUISE: 1,
  EMERGENCY_DESCENT: 0.8,
  APPROACH_READY: 1,
  DESCENT: 0.6,
  FINAL_APPROACH: 0.75,
  TOUCHDOWN_ROLLOUT: 0.1,
  ARRIVED: 0,
};

export function getFuelFlowKgPerHour(aircraft: Aircraft, phase: FlightPhase): number {
  const base = aircraft.fuelBurnKgPerHour ?? 0;
  const factor = FUEL_FLOW_FACTORS[phase] ?? 1;
  return Math.round(base * factor);
}

export function getBurnPerKm(aircraft: Aircraft): number {
  if (aircraft.cruiseSpeedKmh <= 0) return 0;
  return aircraft.fuelBurnKgPerHour / aircraft.cruiseSpeedKmh;
}

export function pickDiversionAirport(
  origin: Airport,
  destination: Airport
): Airport | null {
  let best: Airport | null = null;
  let bestDistanceKm = Infinity;

  for (const airport of AIRPORTS) {
    if (airport.code === origin.code || airport.code === destination.code) continue;
    const distanceKm = calculateDistanceKm(
      destination.lat,
      destination.lng,
      airport.lat,
      airport.lng
    );
    if (distanceKm < bestDistanceKm) {
      bestDistanceKm = distanceKm;
      best = airport;
    }
  }

  return best;
}

export function computeFuelPlan(
  aircraft: Aircraft,
  routeDistanceKm: number,
  origin: Airport,
  destination: Airport,
  diversion?: Airport | null
): FuelPlan {
  const burnPerKm = getBurnPerKm(aircraft);
  const alternateAirport = diversion !== undefined ? diversion : pickDiversionAirport(origin, destination);

  const tripFuelKg = routeDistanceKm * burnPerKm;
  const contingencyFuelKg = tripFuelKg * CONTINGENCY_FRACTION;
  const alternateDistanceKm = alternateAirport
    ? calculateDistanceKm(
        destination.lat,
        destination.lng,
        alternateAirport.lat,
        alternateAirport.lng
      )
    : 0;
  const alternateFuelKg = alternateDistanceKm * burnPerKm * ALTERNATE_PENALTY_FACTOR;
  const finalReserveKg = (aircraft.fuelBurnKgPerHour * FINAL_RESERVE_MINUTES) / 60;
  const taxiFuelKg = TAXI_FUEL_BY_TYPE[aircraft.type] ?? 250;

  return {
    tripFuelKg,
    contingencyFuelKg,
    alternateFuelKg,
    finalReserveKg,
    taxiFuelKg,
    totalRequiredKg: tripFuelKg + contingencyFuelKg + alternateFuelKg + finalReserveKg + taxiFuelKg,
    fuelOnBoardKg: aircraft.fuelCapacityKg,
    alternateAirport,
    alternateDistanceKm,
    routeDistanceKm,
    maxRangeKm: aircraft.maxRangeKm,
  };
}

export function isFuelFeasible(fuelPlan: FuelPlan): boolean {
  const withinRange =
    fuelPlan.routeDistanceKm === undefined ||
    fuelPlan.maxRangeKm === undefined ||
    fuelPlan.routeDistanceKm <= fuelPlan.maxRangeKm;
  return withinRange && fuelPlan.totalRequiredKg <= fuelPlan.fuelOnBoardKg;
}

export interface LayoverOption {
  airport: Airport;
  leg1DistanceKm: number;
  leg2DistanceKm: number;
  detourKm: number;
  leg1FuelPlan: FuelPlan;
  leg2FuelPlan: FuelPlan;
}

/**
 * Finds airports that can serve as a technical refueling stop between origin
 * and destination, where both legs are individually feasible with the given
 * aircraft. Results are sorted by detour distance (closest to the direct track).
 */
export function findLayoverOptions(
  aircraft: Aircraft,
  origin: Airport,
  destination: Airport,
  directDistanceKm?: number
): LayoverOption[] {
  if (origin.code === destination.code) return [];

  const directKm =
    directDistanceKm && directDistanceKm > 0
      ? directDistanceKm
      : calculateDistanceKm(origin.lat, origin.lng, destination.lat, destination.lng);

  const options: LayoverOption[] = [];

  for (const airport of AIRPORTS) {
    if (airport.code === origin.code || airport.code === destination.code) continue;

    const leg1DistanceKm = calculateDistanceKm(
      origin.lat,
      origin.lng,
      airport.lat,
      airport.lng
    );
    const leg2DistanceKm = calculateDistanceKm(
      airport.lat,
      airport.lng,
      destination.lat,
      destination.lng
    );
    if (leg1DistanceKm <= 0 || leg2DistanceKm <= 0) continue;

    const leg1FuelPlan = computeFuelPlan(
      aircraft,
      leg1DistanceKm,
      origin,
      airport,
      pickDiversionAirport(origin, airport)
    );
    if (!isFuelFeasible(leg1FuelPlan)) continue;

    const leg2FuelPlan = computeFuelPlan(
      aircraft,
      leg2DistanceKm,
      airport,
      destination,
      pickDiversionAirport(airport, destination)
    );
    if (!isFuelFeasible(leg2FuelPlan)) continue;

    options.push({
      airport,
      leg1DistanceKm,
      leg2DistanceKm,
      detourKm: Math.max(0, leg1DistanceKm + leg2DistanceKm - directKm),
      leg1FuelPlan,
      leg2FuelPlan,
    });
  }

  return options.sort((a, b) => a.detourKm - b.detourKm);
}

export interface LayoverAttempt {
  airport: Airport;
  leg1DistanceKm: number;
  leg2DistanceKm: number;
  leg1Feasible: boolean;
  leg2Feasible: boolean;
}

/**
 * When no single stop can bridge the route, returns the airport that comes
 * closest (smallest worst-case leg) so the UI can explain why a layover
 * cannot be offered.
 */
export function findBestLayoverAttempt(
  aircraft: Aircraft,
  origin: Airport,
  destination: Airport
): LayoverAttempt | null {
  if (origin.code === destination.code) return null;

  let best: LayoverAttempt | null = null;
  let bestScore = Infinity;

  for (const airport of AIRPORTS) {
    if (airport.code === origin.code || airport.code === destination.code) continue;

    const leg1DistanceKm = calculateDistanceKm(
      origin.lat,
      origin.lng,
      airport.lat,
      airport.lng
    );
    const leg2DistanceKm = calculateDistanceKm(
      airport.lat,
      airport.lng,
      destination.lat,
      destination.lng
    );
    const score = Math.max(leg1DistanceKm, leg2DistanceKm);
    if (score >= bestScore) continue;

    const leg1FuelPlan = computeFuelPlan(
      aircraft,
      leg1DistanceKm,
      origin,
      airport,
      pickDiversionAirport(origin, airport)
    );
    const leg2FuelPlan = computeFuelPlan(
      aircraft,
      leg2DistanceKm,
      airport,
      destination,
      pickDiversionAirport(airport, destination)
    );

    bestScore = score;
    best = {
      airport,
      leg1DistanceKm,
      leg2DistanceKm,
      leg1Feasible: isFuelFeasible(leg1FuelPlan),
      leg2Feasible: isFuelFeasible(leg2FuelPlan),
    };
  }

  return best;
}

export function getTankFillRatio(fuelPlan: FuelPlan): number {
  if (fuelPlan.fuelOnBoardKg <= 0) return 1;
  return fuelPlan.totalRequiredKg / fuelPlan.fuelOnBoardKg;
}

export function calculateFuelLimitedRangeKm(aircraft: Aircraft): number {
  const burnPerKm = getBurnPerKm(aircraft);
  if (burnPerKm <= 0) return 0;
  const taxiFuelKg = TAXI_FUEL_BY_TYPE[aircraft.type] ?? 250;
  const finalReserveKg = (aircraft.fuelBurnKgPerHour * FINAL_RESERVE_MINUTES) / 60;
  const usableFuelKg = aircraft.fuelCapacityKg - taxiFuelKg - finalReserveKg;
  return Math.max(0, usableFuelKg / (burnPerKm * (1 + CONTINGENCY_FRACTION)));
}
