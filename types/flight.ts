export interface Airport {
  code: string; // IATA (e.g. JFK, LHR, HND)
  icao: string; // ICAO (e.g. KJFK, EGLL, RJTT)
  name: string; // Full airport name
  city: string; // City
  country: string; // Country name
  countryCode: string; // ISO 2-letter
  lat: number;
  lng: number;
  elevation: number; // in feet
  runwayHeading: number; // degrees (0-359)
}

export interface Aircraft {
  id: string;
  name: string;
  manufacturer: string;
  model: string;
  type: 'widebody' | 'narrowbody' | 'supersonic' | 'business' | 'general';
  cruiseSpeedKmh: number; // Cruising ground speed in km/h (e.g. 903 for 787)
  cruiseSpeedKnots: number;
  maxRangeKm: number; // Maximum non-stop range in km
  cruiseAltitudeFt: number; // Typical cruise altitude (e.g. 39,000 ft)
  climbRateFtMin: number; // Average climb rate in ft/min
  descentRateFtMin: number; // Average descent rate in ft/min
  takeoffSpeedKnots: number; // Rotation speed Vr
  landingSpeedKnots: number; // Vref
  passengerCapacity: number;
  wingspanMeters: number;
  description: string;
  fuelCapacityKg: number; // Usable fuel capacity in kg
  fuelBurnKgPerHour: number; // Nominal cruise fuel burn in kg/h
  engineCount: number;
}

export type FlightPhase =
  | 'PRE_FLIGHT' // Cold & dark at departure gate
  | 'TAXI' // Taxiing to the active runway
  | 'TAXI_TAKEOFF' // Accelerating on runway and initial liftoff
  | 'CLIMB' // Climbing to cruise altitude
  | 'CRUISE' // Level cruise along filed navigation route
  | 'EMERGENCY_DESCENT' // Emergency descent to a safe cabin altitude
  | 'APPROACH_READY' // Within descent threshold, waiting for user land command
  | 'DESCENT' // Descending to approach altitude
  | 'FINAL_APPROACH' // Final alignment and descent to runway
  | 'TOUCHDOWN_ROLLOUT' // Landing rollout, braking
  | 'ARRIVED'; // Flight finished at gate

export type EngineState = 'OFF' | 'STARTING' | 'RUNNING' | 'FAILED';

export interface EngineStatus {
  state: EngineState;
  startRemainingSeconds: number;
}

export type FlightWaypointType = 'airport' | 'sid' | 'star' | 'navaid' | 'oceanic';

export interface FlightWaypoint {
  lat: number;
  lng: number;
  distanceFromOriginKm: number;
  bearing: number;
  targetAltitudeFt: number;
  name?: string;
  type?: FlightWaypointType;
}

export interface FuelPlan {
  tripFuelKg: number;
  contingencyFuelKg: number;
  alternateFuelKg: number;
  finalReserveKg: number;
  taxiFuelKg: number;
  totalRequiredKg: number;
  fuelOnBoardKg: number;
  alternateAirport: Airport | null;
  alternateDistanceKm: number;
  routeDistanceKm?: number;
  maxRangeKm?: number;
}

export interface LayoverStop {
  airport: Airport;
  distanceFromOriginKm: number;
  leg1FuelPlan: FuelPlan;
  leg2FuelPlan: FuelPlan;
}

export interface FlightPlan {
  id: string;
  origin: Airport;
  destination: Airport;
  aircraft: Aircraft;
  totalDistanceKm: number;
  estimatedFlightTimeHours: number;
  waypoints: FlightWaypoint[];
  departureTime: Date;
  airline?: { code: string; name: string };
  flightNumber?: string;
  isRealWorldRoute?: boolean;
  fuel?: FuelPlan;
  layover?: LayoverStop;
}

export interface LiveTelemetry {
  lat: number;
  lng: number;
  altitudeFt: number;
  groundSpeedKmh: number;
  groundSpeedKnots: number;
  mach: number;
  heading: number; // 0 - 359 degrees
  verticalSpeedFtMin: number; // positive = climb, negative = descent
  distanceTraveledKm: number;
  distanceRemainingKm: number;
  progressPercent: number; // 0 - 100
  elapsedSimSeconds: number;
  etaSecondsRemaining: number;
  phase: FlightPhase;
  legIndex: number; // 1 = first leg, 2 = after a layover/refuel stop
  fuelRemainingKg: number;
  fuelUsedKg: number;
  fuelFlowKgPerHour: number;
  engines: EngineStatus[];
  batteryOn: boolean;
  beaconOn: boolean;
  fuelPumpsOn: boolean;
  parkingBrake: boolean;
  flaps: number; // 0-4 notches
  gearDown: boolean;
  speedbrake: number; // 0-100 percent deployed
  cabinAltitudeFt?: number;
}

export type SystemsPatch = Partial<
  Pick<
    LiveTelemetry,
    | 'batteryOn'
    | 'beaconOn'
    | 'fuelPumpsOn'
    | 'parkingBrake'
    | 'flaps'
    | 'gearDown'
    | 'speedbrake'
  >
>;

export type MapTileStyle =
  | 'radar'
  | 'satellite'
  | 'streets'
  | 'mapbox-dark'
  | 'mapbox-satellite'
  | 'maptiler-topo';

