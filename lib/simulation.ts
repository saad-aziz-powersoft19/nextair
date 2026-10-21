import {
  FlightPlan,
  FlightPhase,
  LiveTelemetry,
} from '../types/flight';
import { ScenarioSimulationContext } from '../types/scenario';
import {
  calculateBearing,
  interpolateAlongPath,
  interpolateGreatCirclePoint,
  KM_TO_NAUTICAL_MILES,
} from './geodesics';
import { getFuelFlowKgPerHour } from './fuel';
import {
  TAXI_DISTANCE_KM,
  TAXI_SPEED_KMH,
  areEnginesRunning,
  createEngineStatuses,
  getConfigurationDragFactor,
} from './ground';

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
  const fuelOnBoardKg = flightPlan.fuel?.fuelOnBoardKg ?? aircraft.fuelCapacityKg ?? 0;

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
    legIndex: 1,
    fuelRemainingKg: fuelOnBoardKg,
    fuelUsedKg: 0,
    fuelFlowKgPerHour: 0,
    engines: createEngineStatuses(aircraft.engineCount ?? 2),
    batteryOn: false,
    beaconOn: false,
    fuelPumpsOn: false,
    parkingBrake: true,
    flaps: 0,
    gearDown: true,
    speedbrake: 0,
    cabinAltitudeFt: 8000,
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
  isApproachCleared: boolean,
  scenario: ScenarioSimulationContext | null = null
): { telemetry: LiveTelemetry; showLandingPrompt: boolean } {
  if (current.phase === 'ARRIVED') {
    return { telemetry: current, showLandingPrompt: false };
  }

  const { origin, destination, aircraft, totalDistanceKm } = flightPlan;
  const layover = flightPlan.layover ?? null;
  let legIndex = current.legIndex ?? 1;
  const onLayoverLeg = Boolean(layover && legIndex === 1);
  const depressurization = scenario?.scenarioId === 'DEPRESSURIZATION';
  const emergencyDescentStarted = Boolean(scenario?.emergencyDescentStarted);
  const emergencyLevelOffFt = 10000;

  // While flying the first leg, the active target is the refueling stop
  const targetAirport = onLayoverLeg && layover ? layover.airport : destination;
  const targetDistanceKm =
    onLayoverLeg && layover ? layover.distanceFromOriginKm : totalDistanceKm;

  const todDistanceKm = calculateTopDescentKm(
    emergencyDescentStarted
      ? Math.min(aircraft.cruiseAltitudeFt, emergencyLevelOffFt)
      : aircraft.cruiseAltitudeFt,
    targetAirport.elevation
  );

  let newPhase: FlightPhase = current.phase;
  let newDistTraveled = current.distanceTraveledKm;
  let showLandingPrompt = false;
  let completedLayover = false;

  // 1. Phase Determination & Speed / Altitude dynamics
  let currentSpeedKmh = current.groundSpeedKmh;
  let currentAltFt = current.altitudeFt;
  let vsiFtMin = 0;

  const cruiseSpeedKmh = aircraft.cruiseSpeedKmh;
  const cruiseAltFt = aircraft.cruiseAltitudeFt;
  const destElevFt = targetAirport.elevation;
  const origElevFt = origin.elevation;

  // Check if we are near the active target airport and need landing clearance
  const distRemaining = Math.max(0, targetDistanceKm - newDistTraveled);

  const engines = (current.engines ?? createEngineStatuses(aircraft.engineCount ?? 2)).map(
    (engine) => {
      if (engine.state !== 'STARTING') return engine;
      const remaining = engine.startRemainingSeconds - deltaSimSeconds;
      if (remaining <= 0) return { state: 'RUNNING' as const, startRemainingSeconds: 0 };
      return { ...engine, startRemainingSeconds: remaining };
    }
  );
  const allEnginesRunning = areEnginesRunning(engines);
  const totalEngines = Math.max(1, engines.length || aircraft.engineCount || 1);
  const runningEngineCount = engines.filter(
    (engine) => engine.state === 'RUNNING'
  ).length;
  const runningEngineRatio = runningEngineCount / totalEngines;
  const enginePerformance =
    runningEngineCount === totalEngines
      ? 1
      : 0.55 + 0.45 * runningEngineRatio;

  const flaps = Math.max(0, Math.min(4, current.flaps ?? 0));
  const gearDown = current.gearDown ?? false;
  const speedbrake = Math.max(0, Math.min(100, current.speedbrake ?? 0));
  const configDrag = getConfigurationDragFactor(flaps, gearDown, speedbrake);

  if (current.phase === 'PRE_FLIGHT') {
    newPhase = 'PRE_FLIGHT';
    currentSpeedKmh = 0;
    currentAltFt = origElevFt;
    vsiFtMin = 0;
  } else if (current.phase === 'TAXI') {
    currentAltFt = origElevFt;
    vsiFtMin = 0;
    const taxiDone = newDistTraveled >= TAXI_DISTANCE_KM - 0.001;
    currentSpeedKmh =
      !taxiDone && allEnginesRunning && !current.parkingBrake ? TAXI_SPEED_KMH : 0;
  } else if (current.phase === 'TAXI_TAKEOFF') {
    // Accelerate to rotation speed and climb off ground
    const takeoffElevFt = layover && legIndex === 2 ? layover.airport.elevation : origElevFt;
    const vrKmh = aircraft.takeoffSpeedKnots * 1.852;
    currentSpeedKmh = Math.min(vrKmh * 1.2, currentSpeedKmh + 25 * (deltaSimSeconds / 2));
    vsiFtMin = aircraft.climbRateFtMin * 0.6;
    currentAltFt = Math.min(
      takeoffElevFt + 3000,
      currentAltFt + (vsiFtMin / 60) * deltaSimSeconds
    );

    if (currentAltFt >= takeoffElevFt + 2500 && currentSpeedKmh >= vrKmh) {
      newPhase = 'CLIMB';
    }
  } else if (current.phase === 'CLIMB') {
    // Climbing to cruise altitude, accelerating to cruise speed
    const climbTargetKmh = cruiseSpeedKmh * configDrag * enginePerformance;
    currentSpeedKmh = Math.min(
      climbTargetKmh,
      currentSpeedKmh + (climbTargetKmh - currentSpeedKmh) * 0.05 * deltaSimSeconds
    );
    vsiFtMin = aircraft.climbRateFtMin * enginePerformance;
    currentAltFt = Math.min(cruiseAltFt, currentAltFt + (vsiFtMin / 60) * deltaSimSeconds);

    if (currentAltFt >= cruiseAltFt * 0.98) {
      currentAltFt = cruiseAltFt;
      currentSpeedKmh = cruiseSpeedKmh * configDrag * enginePerformance;
      vsiFtMin = 0;
      newPhase = 'CRUISE';
    }
  } else if (current.phase === 'CRUISE') {
    currentSpeedKmh = cruiseSpeedKmh * configDrag * enginePerformance;
    const emergencyHoldAltFt = emergencyDescentStarted
      ? emergencyLevelOffFt
      : cruiseAltFt;

    if (currentAltFt > emergencyHoldAltFt + 50) {
      vsiFtMin = emergencyDescentStarted ? -1800 : -250;
      currentAltFt = Math.max(
        emergencyHoldAltFt,
        currentAltFt + (vsiFtMin / 60) * deltaSimSeconds
      );
    } else if (currentAltFt < cruiseAltFt - 50 && !emergencyDescentStarted) {
      vsiFtMin = aircraft.climbRateFtMin * 0.7;
      currentAltFt = Math.min(
        cruiseAltFt,
        currentAltFt + (vsiFtMin / 60) * deltaSimSeconds
      );
    } else {
      currentAltFt = emergencyHoldAltFt;
      vsiFtMin = 0;
    }

    // Check if entering Top-Of-Descent window
    if (distRemaining <= todDistanceKm) {
      newPhase = 'APPROACH_READY';
      showLandingPrompt = true;
    }
  } else if (current.phase === 'EMERGENCY_DESCENT') {
    const emergencyTargetKmh = cruiseSpeedKmh * 0.8;
    if (currentSpeedKmh > emergencyTargetKmh) {
      currentSpeedKmh = Math.max(
        emergencyTargetKmh,
        currentSpeedKmh - 12 * deltaSimSeconds
      );
    } else {
      currentSpeedKmh = Math.min(
        emergencyTargetKmh,
        currentSpeedKmh + 8 * deltaSimSeconds
      );
    }

    vsiFtMin = -Math.max(2500, aircraft.descentRateFtMin * 2);
    currentAltFt = Math.max(
      emergencyLevelOffFt,
      currentAltFt + (vsiFtMin / 60) * deltaSimSeconds
    );

    if (currentAltFt <= emergencyLevelOffFt + 50) {
      currentAltFt = emergencyLevelOffFt;
      currentSpeedKmh = Math.min(currentSpeedKmh, cruiseSpeedKmh * 0.72);
      vsiFtMin = 0;
      newPhase = 'CRUISE';
    }
  } else if (current.phase === 'APPROACH_READY') {
    if (isApproachCleared) {
      newPhase = 'DESCENT';
      showLandingPrompt = false;
    } else {
      // Hold level or gentle preliminary descent while waiting for clearance
      showLandingPrompt = true;
      currentSpeedKmh = cruiseSpeedKmh * 0.95 * configDrag * enginePerformance;
    }
  } else if (current.phase === 'DESCENT') {
    // Descend towards 3,000 ft AGL and decelerate to approach speed
    const approachSpeedKmh = aircraft.landingSpeedKnots * 1.852 * 1.25;
    currentSpeedKmh = Math.max(
      approachSpeedKmh,
      currentSpeedKmh - (currentSpeedKmh - approachSpeedKmh) * 0.04 * deltaSimSeconds
    );

    vsiFtMin = -aircraft.descentRateFtMin * (1 + (speedbrake / 100) * 0.5);
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
    const vrefKmh = aircraft.landingSpeedKnots * 1.852 * (1 - 0.015 * flaps);
    currentSpeedKmh = Math.max(
      vrefKmh,
      currentSpeedKmh - (currentSpeedKmh - vrefKmh) * 0.08 * deltaSimSeconds
    );

    // Glideslope descent rate ~ 700 ft/min, increased with speedbrake
    vsiFtMin = -750 * (1 + (speedbrake / 100) * 0.3);
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
    currentSpeedKmh = Math.max(
      25,
      currentSpeedKmh - 45 * (1 + speedbrake / 100) * deltaSimSeconds
    );

    if (distRemaining <= 0.2 || currentSpeedKmh <= 30) {
      currentSpeedKmh = 0;
      if (onLayoverLeg && layover) {
        // Technical stop: refuel and roll straight into the departure for leg 2
        newDistTraveled = layover.distanceFromOriginKm;
        currentAltFt = layover.airport.elevation;
        newPhase = 'TAXI_TAKEOFF';
        legIndex = 2;
        completedLayover = true;
      } else {
        newPhase = 'ARRIVED';
        newDistTraveled = totalDistanceKm;
      }
    }
  }

  // 2. Fuel burn based on active-phase flow rate (idle burn once engines spin at the gate)
  const engineIdle =
    newPhase === 'PRE_FLIGHT' && engines.some((engine) => engine.state !== 'OFF');
  const fuelBurnFactor = allEnginesRunning
    ? 1
    : Math.max(0.6, enginePerformance);
  const fuelFlowKgPerHour =
    getFuelFlowKgPerHour(aircraft, engineIdle ? 'TAXI' : newPhase) *
    fuelBurnFactor;
  const fuelBurnKg = (fuelFlowKgPerHour / 3600) * deltaSimSeconds;
  const startFuelKg = Number.isFinite(current.fuelRemainingKg)
    ? current.fuelRemainingKg
    : flightPlan.fuel?.fuelOnBoardKg ?? 0;
  const remainingAfterBurnKg = Math.max(0, startFuelKg - fuelBurnKg);
  const burnedKg = startFuelKg - remainingAfterBurnKg;
  // Refuel to full tanks during the layover turnaround
  const fuelRemainingKg = completedLayover
    ? aircraft.fuelCapacityKg ?? flightPlan.fuel?.fuelOnBoardKg ?? remainingAfterBurnKg
    : remainingAfterBurnKg;
  const fuelUsedKg = (current.fuelUsedKg ?? 0) + burnedKg;

  // 3. Advance distance traveled along the filed navigation route using current speed
  const kmPerSecond = currentSpeedKmh / 3600;
  newDistTraveled = Math.min(
    totalDistanceKm,
    newDistTraveled + kmPerSecond * deltaSimSeconds
  );
  if (newPhase === 'TAXI') {
    newDistTraveled = Math.min(newDistTraveled, TAXI_DISTANCE_KM);
  }

  const updatedDistRemaining = Math.max(0, totalDistanceKm - newDistTraveled);
  const fraction = Math.min(1, newDistTraveled / Math.max(1, totalDistanceKm));

  // 4. Current position along the waypoint path (falls back to great circle if plan has no route)
  const routeWaypoints = flightPlan.waypoints;
  let currentPos = { lat: origin.lat, lng: origin.lng };
  let newHeading = current.heading;
  if (routeWaypoints.length >= 2) {
    const pathPos = interpolateAlongPath(routeWaypoints, newDistTraveled);
    currentPos = { lat: pathPos.lat, lng: pathPos.lng };
    newHeading = fraction >= 0.999 ? destination.runwayHeading : pathPos.heading;
  } else {
    currentPos = interpolateGreatCirclePoint(
      origin.lat,
      origin.lng,
      destination.lat,
      destination.lng,
      fraction
    );
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
  }

  // 5. Compute Mach number (speed of sound at altitude ~ 1060 km/h)
  const speedOfSoundKmh = 1062 - (currentAltFt / 30000) * 45;
  const mach = Math.round((currentSpeedKmh / speedOfSoundKmh) * 100) / 100;
  const previousCabinAltitudeFt = current.cabinAltitudeFt ?? 8000;
  const cabinAltitudeFt = depressurization
    ? emergencyDescentStarted
      ? Math.max(8000, previousCabinAltitudeFt - (1500 / 60) * deltaSimSeconds)
      : Math.min(14000, previousCabinAltitudeFt + (1200 / 60) * deltaSimSeconds)
    : 8000;

  const groundSpeedKnots = Math.round(currentSpeedKmh * 0.539957);
  const etaSpeedKmh =
    newPhase === 'PRE_FLIGHT' || newPhase === 'TAXI' ? cruiseSpeedKmh : currentSpeedKmh;
  const etaRemainingKm = Math.max(
    0,
    (completedLayover ? totalDistanceKm : targetDistanceKm) - newDistTraveled
  );
  const etaSeconds = etaSpeedKmh > 10 ? (etaRemainingKm / etaSpeedKmh) * 3600 : 0;

  const nextTelemetry: LiveTelemetry = {
    lat: currentPos.lat,
    lng: currentPos.lng,
    altitudeFt: Math.round(currentAltFt),
    groundSpeedKmh: Math.round(currentSpeedKmh),
    groundSpeedKnots,
    mach,
    heading: Math.round(newHeading),
    verticalSpeedFtMin: Math.round(vsiFtMin),
    distanceTraveledKm: newDistTraveled,
    distanceRemainingKm: updatedDistRemaining,
    progressPercent: Math.round(fraction * 1000) / 10,
    elapsedSimSeconds: current.elapsedSimSeconds + deltaSimSeconds,
    etaSecondsRemaining: Math.round(etaSeconds),
    phase: newPhase,
    legIndex,
    fuelRemainingKg: Math.round(fuelRemainingKg * 10) / 10,
    fuelUsedKg: Math.round(fuelUsedKg * 10) / 10,
    fuelFlowKgPerHour,
    engines,
    batteryOn: current.batteryOn ?? false,
    beaconOn: current.beaconOn ?? false,
    fuelPumpsOn: current.fuelPumpsOn ?? false,
    parkingBrake: current.parkingBrake ?? false,
    flaps,
    gearDown,
    speedbrake,
    cabinAltitudeFt: Math.round(cabinAltitudeFt),
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
        label: 'Cold & Dark',
        badgeClass: 'bg-zinc-700 text-zinc-300 border-zinc-600',
        description: 'Parked at departure gate. Complete checklists and start engines.',
      };
    case 'TAXI':
      return {
        label: 'Taxiing',
        badgeClass: 'bg-sky-950/80 text-sky-300 border-sky-600',
        description: 'Taxiing to the active runway under own power.',
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
        description: 'Level flight tracking the filed navigation route.',
      };
    case 'EMERGENCY_DESCENT':
      return {
        label: 'Emergency Descent',
        badgeClass: 'bg-rose-950/90 text-rose-300 border-rose-500 animate-pulse',
        description: 'Descending immediately to 10,000 ft for a depressurization.',
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

