import {
  EngineState,
  EngineStatus,
  FlightPhase,
  LiveTelemetry,
} from '../types/flight';

export const TAXI_DISTANCE_KM = 1.5;
export const TAXI_SPEED_KMH = 30;
export const ENGINE_START_SECONDS = 8;

export function createEngineStatuses(
  engineCount: number,
  initialState: EngineState = 'OFF'
): EngineStatus[] {
  return Array.from({ length: Math.max(1, engineCount) }, () => ({
    state: initialState,
    startRemainingSeconds: 0,
  }));
}

export function isGroundPhase(phase: FlightPhase): boolean {
  return phase === 'PRE_FLIGHT' || phase === 'TAXI';
}

export function areEnginesRunning(engines: EngineStatus[] | undefined): boolean {
  return Boolean(
    engines && engines.length > 0 && engines.every((engine) => engine.state === 'RUNNING')
  );
}

export function isTaxiComplete(
  telemetry: Pick<LiveTelemetry, 'phase' | 'distanceTraveledKm'>
): boolean {
  return telemetry.phase === 'TAXI' && telemetry.distanceTraveledKm >= TAXI_DISTANCE_KM - 0.01;
}

export function getConfigurationDragFactor(
  flaps: number,
  gearDown: boolean,
  speedbrake: number
): number {
  const flapsDrag = 1 - 0.03 * Math.max(0, Math.min(4, flaps));
  const gearDrag = gearDown ? 0.85 : 1;
  const speedbrakeDrag = 1 - (Math.max(0, Math.min(100, speedbrake)) / 100) * 0.15;
  return flapsDrag * gearDrag * speedbrakeDrag;
}

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export interface Checklist {
  id: 'beforeStart' | 'afterStart' | 'beforeTakeoff';
  title: string;
  items: ChecklistItem[];
  isComplete: boolean;
}

export function buildChecklists(telemetry: LiveTelemetry): Checklist[] {
  const engines = telemetry.engines ?? [];
  const engineCount = engines.length;
  const runningCount = engines.filter((engine) => engine.state === 'RUNNING').length;
  const enginesRunning = areEnginesRunning(engines);
  const enginesStarted = engines.some((engine) => engine.state !== 'OFF');

  const beforeStart: Checklist = {
    id: 'beforeStart',
    title: 'Before Start',
    items: [
      { id: 'battery', label: 'Battery — ON', done: Boolean(telemetry.batteryOn) },
      { id: 'beacon', label: 'Beacon — ON', done: Boolean(telemetry.beaconOn) },
      { id: 'pumps', label: 'Fuel pumps — ON', done: Boolean(telemetry.fuelPumpsOn) },
      {
        id: 'brakeSet',
        label: 'Parking brake — SET',
        done: Boolean(telemetry.parkingBrake) || enginesStarted,
      },
    ],
    isComplete: false,
  };
  beforeStart.isComplete = beforeStart.items.every((item) => item.done);

  const afterStart: Checklist = {
    id: 'afterStart',
    title: 'After Start',
    items: [
      {
        id: 'engines',
        label: `Engines running — ${runningCount}/${engineCount}`,
        done: enginesRunning,
      },
      {
        id: 'brakeReleased',
        label: 'Parking brake — RELEASED',
        done: !telemetry.parkingBrake,
      },
    ],
    isComplete: false,
  };
  afterStart.isComplete = afterStart.items.every((item) => item.done);

  const beforeTakeoff: Checklist = {
    id: 'beforeTakeoff',
    title: 'Before Takeoff',
    items: [
      { id: 'flaps', label: 'Flaps — SET (1 or more)', done: (telemetry.flaps ?? 0) >= 1 },
      {
        id: 'speedbrake',
        label: 'Speedbrake — STOWED',
        done: (telemetry.speedbrake ?? 0) === 0,
      },
      { id: 'gear', label: 'Gear — DOWN & LOCKED', done: Boolean(telemetry.gearDown) },
    ],
    isComplete: false,
  };
  beforeTakeoff.isComplete = beforeTakeoff.items.every((item) => item.done);

  return [beforeStart, afterStart, beforeTakeoff];
}
