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
}

export type FlightPhase =
  | 'PRE_FLIGHT' // Parked at departure gate
  | 'TAXI_TAKEOFF' // Accelerating on runway and initial liftoff
  | 'CLIMB' // Climbing to cruise altitude
  | 'CRUISE' // Level cruise along Great Circle route
  | 'APPROACH_READY' // Within descent threshold, waiting for user land command
  | 'DESCENT' // Descending to approach altitude
  | 'FINAL_APPROACH' // Final alignment and descent to runway
  | 'TOUCHDOWN_ROLLOUT' // Landing rollout, braking
  | 'ARRIVED'; // Flight finished at gate

export interface FlightWaypoint {
  lat: number;
  lng: number;
  distanceFromOriginKm: number;
  bearing: number;
  targetAltitudeFt: number;
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
}

export type MapTileStyle =
  | 'radar'
  | 'satellite'
  | 'streets'
  | 'mapbox-dark'
  | 'mapbox-satellite'
  | 'maptiler-topo';

