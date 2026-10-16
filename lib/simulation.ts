import {
  FlightPlan,
  FlightPhase,
  LiveTelemetry,
  Airport,
  Aircraft,
} from '@/types/flight';
import {
  calculateBearing,
  calculateDistanceKm,
  interpolateGreatCirclePoint,
  KM_TO_NAUTICAL_MILES,
} from './geodesics';

export interface SimulationState {
  flightPlan: FlightPlan;
  telemetry: LiveTelemetry;
  isPlaying: boolean;
  timeMultiplier: number; // 1x, 5x, 10x, 50x, 100x, 500x
  isApproachCleared: boolean; // Triggered by user when approaching destination
  autoLandEnabled: boolean;
  showLandingPrompt: boolean;
}

export const TIME_MULTIPLIERS = [1, 5, 10, 25, 50, 100, 250, 500];

/**
 * Calculates initial telemetry at departure gate/runway
 */
export function getInitialTelemetry(flightPlan: FlightPlan): LiveTelemetry {
  const { origin, aircraft, totalDistanceKm } = flightPlan;

  return {
    lat: origin.lat,
    lng: origin.lng,
    altitudeFt: origin.elevation,
    groundSpeedKmh: 0,
    groundSpeedKnots: 0,
    mach: 0,
    heading: origin.runwayHeading,
    verticalSpeedFtMin: 0,
    distanceTraveledKm: 0,
    distanceRemainingKm: totalDistanceKm,
    progressPercent: 0,
    elapsedSimSeconds: 0,
    etaSecondsRemaining: (totalDistanceKm / aircraft.cruiseSpeedKmh) * 3600,
    phase: 'PRE_FLIGHT',
  };
}

/**
 * Determines top-of-descent (TOD) distance in km
 * Rule of 3 in aviation: Distance to descend ~ (Altitude in thousands of feet) * 3 NM
 */
export function calculateTopDescentKm(
  cruiseAltFt: number,
  destElevationFt: number
): number {
  const altToLoseFt = Math.max(1000, cruiseAltFt - destElevationFt);
  // ~3 nautical miles per 1,000 ft of altitude descent, plus 15 NM deceleration buffer
  const todNauticalMiles = (altToLoseFt / 1000) * 3.2 + 15;
  return todNauticalMiles / KM_TO_NAUTICAL_MILES; // in km
}

/**
 * Advances the simulation by deltaSimSeconds (scaled real-time delta)
 */
export function stepSimulation(
  current: LiveTelemetry,
  flightPlan: FlightPlan,
  deltaSimSeconds: number,
  isApproachCleared: boolean
): { telemetry: LiveTelemetry; showLandingPrompt: boolean } {
  if (current.phase === 'ARRIVED') {
    return { telemetry: current, showLandingPrompt: false };
  }

  const { origin, destination, aircraft, totalDistanceKm } = flightPlan;
  const todDistanceKm = calculateTopDescentKm(
    aircraft.cruiseAltitudeFt,
    destination.elevation
  );

  let newPhase: FlightPhase = current.phase;
  let newDistTraveled = current.distanceTraveledKm;
  let showLandingPrompt = false;

  // 1. Phase Determination & Speed / Altitude dynamics
  let currentSpeedKmh = current.groundSpeedKmh;
  let currentAltFt = current.altitudeFt;
  let vsiFtMin = 0;

  const cruiseSpeedKmh = aircraft.cruiseSpeedKmh;
  const cruiseAltFt = aircraft.cruiseAltitudeFt;
  const destElevFt = destination.elevation;
  const origElevFt = origin.elevation;

  // Check if we are near destination and need landing clearance
  const distRemaining = Math.max(0, totalDistanceKm - newDistTraveled);

  if (current.phase === 'PRE_FLIGHT') {
    // Initiate takeoff roll
    newPhase = 'TAXI_TAKEOFF';
    currentSpeedKmh = 50; // Initial roll
    vsiFtMin = 0;
  } else if (current.phase === 'TAXI_TAKEOFF') {
    // Accelerate to rotation speed and climb off ground
    const vrKmh = aircraft.takeoffSpeedKnots * 1.852;
    currentSpeedKmh = Math.min(vrKmh * 1.2, currentSpeedKmh + 25 * (deltaSimSeconds / 2));
    vsiFtMin = aircraft.climbRateFtMin * 0.6;
    currentAltFt = Math.min(origElevFt + 3000, currentAltFt + (vsiFtMin / 60) * deltaSimSeconds);

    if (currentAltFt >= origElevFt + 2500 && currentSpeedKmh >= vrKmh) {
      newPhase = 'CLIMB';
    }
  } else if (current.phase === 'CLIMB') {
    // Climbing to cruise altitude, accelerating to cruise speed
    currentSpeedKmh = Math.min(
      cruiseSpeedKmh,
      currentSpeedKmh + (cruiseSpeedKmh - currentSpeedKmh) * 0.05 * deltaSimSeconds
    );
    vsiFtMin = aircraft.climbRateFtMin;
    currentAltFt = Math.min(cruiseAltFt, currentAltFt + (vsiFtMin / 60) * deltaSimSeconds);

    if (currentAltFt >= cruiseAltFt * 0.98) {
      currentAltFt = cruiseAltFt;
      currentSpeedKmh = cruiseSpeedKmh;
      vsiFtMin = 0;
      newPhase = 'CRUISE';
    }
  } else if (current.phase === 'CRUISE') {
    currentSpeedKmh = cruiseSpeedKmh;
    currentAltFt = cruiseAltFt;
    vsiFtMin = 0;

    // Check if entering Top-Of-Descent window
    if (distRemaining <= todDistanceKm) {
      newPhase = 'APPROACH_READY';
      showLandingPrompt = true;
    }
  } else if (current.phase === 'APPROACH_READY') {
    if (isApproachCleared) {
      newPhase = 'DESCENT';
      showLandingPrompt = false;
    } else {
      // Hold level or gentle preliminary descent while waiting for clearance
      showLandingPrompt = true;
      currentSpeedKmh = cruiseSpeedKmh * 0.95;
    }
  } else if (current.phase === 'DESCENT') {
    // Descend towards 3,000 ft AGL and decelerate to approach speed
    const approachSpeedKmh = aircraft.landingSpeedKnots * 1.852 * 1.25;
    currentSpeedKmh = Math.max(
      approachSpeedKmh,
      currentSpeedKmh - (currentSpeedKmh - approachSpeedKmh) * 0.04 * deltaSimSeconds
    );

    vsiFtMin = -aircraft.descentRateFtMin;
    const targetApproachAlt = destElevFt + 2500;
    currentAltFt = Math.max(
      targetApproachAlt,
      currentAltFt + (vsiFtMin / 60) * deltaSimSeconds
    );

    if (distRemaining <= 25 || currentAltFt <= targetApproachAlt + 200) {
      newPhase = 'FINAL_APPROACH';
    }
  } else if (current.phase === 'FINAL_APPROACH') {
    // Final glideslope alignment down to destination elevation
    const vrefKmh = aircraft.landingSpeedKnots * 1.852;
    currentSpeedKmh = Math.max(
      vrefKmh,
      currentSpeedKmh - (currentSpeedKmh - vrefKmh) * 0.08 * deltaSimSeconds
    );

    // Glideslope descent rate ~ 700 ft/min
    vsiFtMin = -750;
    currentAltFt = Math.max(
      destElevFt,
      currentAltFt + (vsiFtMin / 60) * deltaSimSeconds
    );

    if (distRemaining <= 2 || currentAltFt <= destElevFt + 20) {
      currentAltFt = destElevFt;
      newPhase = 'TOUCHDOWN_ROLLOUT';
    }
  } else if (current.phase === 'TOUCHDOWN_ROLLOUT') {
    // Reverse thrust and wheel brakes
    currentAltFt = destElevFt;
    vsiFtMin = 0;
    currentSpeedKmh = Math.max(25, currentSpeedKmh - 45 * deltaSimSeconds);

    if (distRemaining <= 0.2 || currentSpeedKmh <= 30) {
      currentSpeedKmh = 0;
      newPhase = 'ARRIVED';
      newDistTraveled = totalDistanceKm;
    }
  }

  // 2. Advance distance traveled along great circle route based on current speed
  const kmPerSecond = currentSpeedKmh / 3600;
  newDistTraveled = Math.min(
    totalDistanceKm,
    newDistTraveled + kmPerSecond * deltaSimSeconds
  );

  const updatedDistRemaining = Math.max(0, totalDistanceKm - newDistTraveled);
  const fraction = Math.min(1, newDistTraveled / Math.max(1, totalDistanceKm));

  // 3. Current Geographical Coordinates on Great Circle
  const currentPos = interpolateGreatCirclePoint(
    origin.lat,
    origin.lng,
    destination.lat,
    destination.lng,
    fraction
  );

  // 4. Current Heading: bearing towards a forward waypoint along Great Circle
  let newHeading = current.heading;
  if (fraction < 0.999) {
    const forwardPos = interpolateGreatCirclePoint(
      origin.lat,
      origin.lng,
      destination.lat,
      destination.lng,
      Math.min(1, fraction + 0.005)
    );
    newHeading = calculateBearing(
      currentPos.lat,
      currentPos.lng,
      forwardPos.lat,
      forwardPos.lng
    );
  } else {
    newHeading = destination.runwayHeading;
  }

  // 5. Compute Mach number (speed of sound at altitude ~ 1060 km/h)
  const speedOfSoundKmh = 1062 - (currentAltFt / 30000) * 45;
  const mach = Math.round((currentSpeedKmh / speedOfSoundKmh) * 100) / 100;

  const groundSpeedKnots = Math.round(currentSpeedKmh * 0.539957);
  const etaSeconds =
    currentSpeedKmh > 10
      ? (updatedDistRemaining / currentSpeedKmh) * 3600
      : 0;

  const nextTelemetry: LiveTelemetry = {
    lat: currentPos.lat,
    lng: currentPos.lng,
    altitudeFt: Math.round(currentAltFt),
    groundSpeedKmh: Math.round(currentSpeedKmh),
    groundSpeedKnots,
    mach,
    heading: Math.round(newHeading),
    verticalSpeedFtMin: Math.round(vsiFtMin),
    distanceTraveledKm: Math.round(newDistTraveled * 10) / 10,
    distanceRemainingKm: Math.round(updatedDistRemaining * 10) / 10,
    progressPercent: Math.round(fraction * 1000) / 10,
    elapsedSimSeconds: current.elapsedSimSeconds + deltaSimSeconds,
    etaSecondsRemaining: Math.round(etaSeconds),
    phase: newPhase,
  };

  return { telemetry: nextTelemetry, showLandingPrompt };
}

/**
 * Human readable phase labels and badges
 */
export function getPhaseDisplay(phase: FlightPhase): {
  label: string;
  badgeClass: string;
  description: string;
} {
  switch (phase) {
    case 'PRE_FLIGHT':
      return {
        label: 'Pre-Flight',
        badgeClass: 'bg-zinc-700 text-zinc-300 border-zinc-600',
        description: 'Parked at departure gate. Systems initialized.',
      };
    case 'TAXI_TAKEOFF':
      return {
        label: 'Takeoff & Initial Climb',
        badgeClass: 'bg-amber-950/80 text-amber-300 border-amber-600 animate-pulse',
        description: 'Runway roll, rotation, liftoff, and initial climb out.',
      };
    case 'CLIMB':
      return {
        label: 'Climbing',
        badgeClass: 'bg-blue-950/80 text-blue-300 border-blue-600',
        description: 'Ascending to assigned cruise flight level.',
      };
    case 'CRUISE':
      return {
        label: 'Cruising',
        badgeClass: 'bg-emerald-950/80 text-emerald-300 border-emerald-600',
        description: 'Level flight following Great Circle airway.',
      };
    case 'APPROACH_READY':
      return {
        label: 'Approach Clearance Ready',
        badgeClass: 'bg-orange-950/90 text-orange-300 border-orange-500 animate-pulse',
        description: 'Near destination! Ready to initiate descent & landing.',
      };
    case 'DESCENT':
      return {
        label: 'Descent',
        badgeClass: 'bg-purple-950/80 text-purple-300 border-purple-600',
        description: 'Descending through flight levels toward approach altitude.',
      };
    case 'FINAL_APPROACH':
      return {
        label: 'Final Approach',
        badgeClass: 'bg-yellow-950/80 text-yellow-300 border-yellow-600 animate-pulse',
        description: 'Gear down, flaps full, aligned with runway glideslope.',
      };
    case 'TOUCHDOWN_ROLLOUT':
      return {
        label: 'Touchdown & Rollout',
        badgeClass: 'bg-emerald-900 text-emerald-200 border-emerald-500',
        description: 'Touchdown on runway, reverse thrust and wheel braking.',
      };
    case 'ARRIVED':
      return {
        label: 'Flight Arrived',
        badgeClass: 'bg-cyan-950 text-cyan-300 border-cyan-500',
        description: 'Flight completed safely at destination gate.',
      };
  }
}

