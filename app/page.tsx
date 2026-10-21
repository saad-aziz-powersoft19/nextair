'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FlightPlan, LiveTelemetry, FlightPhase, EngineState, SystemsPatch } from '@/types/flight';
import {
  ScenarioId,
  ScenarioMode,
  ScenarioSession,
  ScenarioSimulationContext,
} from '@/types/scenario';
import {
  getInitialTelemetry,
  stepSimulation,
} from '@/lib/simulation';
import { ENGINE_START_SECONDS, createEngineStatuses } from '@/lib/ground';
import {
  canStartScenario,
  completeScenarioStep,
  createScenarioSession,
  evaluateScenario,
  getScenarioStep,
} from '@/lib/scenarios';
import FlightPlanner from '@/components/FlightPlanner';
import FlightMap from '@/components/FlightMapDynamic';
import CockpitHUD from '@/components/CockpitHUD';
import LandingAlert from '@/components/LandingAlert';
import FlightSummaryModal from '@/components/FlightSummaryModal';
import AircraftCard from '@/components/AircraftCard';
import { Plane, Compass, Radio, ChevronLeft, Maximize, Minimize, Volume2, VolumeX } from 'lucide-react';
import { APP_CONFIG } from '@/lib/config';
import { flightAudio } from '@/lib/audio';

const FLIGHT_STORAGE_KEY = 'nextair.activeFlight.v1';

const AIRBORNE_PHASES: FlightPhase[] = [
  'CLIMB',
  'CRUISE',
  'EMERGENCY_DESCENT',
  'APPROACH_READY',
  'DESCENT',
  'FINAL_APPROACH',
];

interface SavedFlightSession {
  flightPlan: FlightPlan;
  telemetry: LiveTelemetry;
  isPlaying: boolean;
  timeMultiplier: number;
  isApproachCleared: boolean;
  autoLandEnabled: boolean;
  scenario?: ScenarioSession | null;
  savedAt: number;
}

export default function Home() {
  const [flightPlan, setFlightPlan] = useState<FlightPlan | null>(null);
  const [telemetry, setTelemetry] = useState<LiveTelemetry | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [timeMultiplier, setTimeMultiplier] = useState<number>(APP_CONFIG.defaultTimeWarp);
  const [isApproachCleared, setIsApproachCleared] = useState<boolean>(false);
  const [autoLandEnabled, setAutoLandEnabled] = useState<boolean>(APP_CONFIG.defaultAutoLand);
  const [showLandingAlert, setShowLandingAlert] = useState<boolean>(false);
  const [showSummaryModal, setShowSummaryModal] = useState<boolean>(false);
  const [autoCenter, setAutoCenter] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [hudHeight, setHudHeight] = useState<number>(0);
  const [scenario, setScenario] = useState<ScenarioSession | null>(null);

  // Fullscreen toggle handler
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  // References for animation ticker loop
  const animFrameRef = useRef<number | null>(null);
  const lastTimestampRef = useRef<number | null>(null);
  const isPlayingRef = useRef<boolean>(isPlaying);
  const timeMultiplierRef = useRef<number>(timeMultiplier);
  const isApproachClearedRef = useRef<boolean>(isApproachCleared);
  const autoLandEnabledRef = useRef<boolean>(autoLandEnabled);
  const telemetryRef = useRef<LiveTelemetry | null>(telemetry);
  const flightPlanRef = useRef<FlightPlan | null>(flightPlan);
  const scenarioRef = useRef<ScenarioSession | null>(scenario);
  const hasRestoredSessionRef = useRef<boolean>(false);
  const prevAudioPhaseRef = useRef<FlightPhase | null>(null);
  const hudRef = useRef<HTMLDivElement | null>(null);

  // Keep mutable refs in sync with state for zero-lag requestAnimationFrame loop
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    timeMultiplierRef.current = timeMultiplier;
  }, [timeMultiplier]);

  useEffect(() => {
    isApproachClearedRef.current = isApproachCleared;
  }, [isApproachCleared]);

  useEffect(() => {
    autoLandEnabledRef.current = autoLandEnabled;
  }, [autoLandEnabled]);

  useEffect(() => {
    telemetryRef.current = telemetry;
  }, [telemetry]);

  useEffect(() => {
    flightPlanRef.current = flightPlan;
  }, [flightPlan]);

  useEffect(() => {
    scenarioRef.current = scenario;
  }, [scenario]);

  // Track the cockpit dock height so the aircraft card floats just above it
  useEffect(() => {
    const element = hudRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setHudHeight(entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [flightPlan]);

  // Restore an in-progress flight saved when the tab was hidden or the browser was closed
  const restoreFlightSession = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(FLIGHT_STORAGE_KEY);
      if (!raw) return;

      const saved = JSON.parse(raw) as Partial<SavedFlightSession>;
      if (!saved?.flightPlan?.origin || !saved?.telemetry) return;

      const restoredPlan: FlightPlan = {
        ...saved.flightPlan,
        departureTime: new Date(saved.flightPlan.departureTime),
      };
      const partialTelemetry = saved.telemetry as Partial<LiveTelemetry>;
      const restoredPhase = partialTelemetry.phase ?? 'PRE_FLIGHT';
      const defaultEngineState: EngineState =
        restoredPhase === 'PRE_FLIGHT' ? 'OFF' : 'RUNNING';
      const restoredGearDown =
        restoredPhase === 'PRE_FLIGHT' ||
        restoredPhase === 'TAXI' ||
        restoredPhase === 'TAXI_TAKEOFF' ||
        restoredPhase === 'DESCENT' ||
        restoredPhase === 'FINAL_APPROACH' ||
        restoredPhase === 'TOUCHDOWN_ROLLOUT';
      const restoredTelemetry: LiveTelemetry = {
        ...(saved.telemetry as LiveTelemetry),
        legIndex: partialTelemetry.legIndex ?? 1,
        fuelRemainingKg:
          partialTelemetry.fuelRemainingKg ?? saved.flightPlan.fuel?.fuelOnBoardKg ?? 0,
        fuelUsedKg: partialTelemetry.fuelUsedKg ?? 0,
        fuelFlowKgPerHour: partialTelemetry.fuelFlowKgPerHour ?? 0,
        engines:
          partialTelemetry.engines ??
          createEngineStatuses(
            saved.flightPlan.aircraft.engineCount ?? 2,
            defaultEngineState
          ),
        batteryOn: partialTelemetry.batteryOn ?? defaultEngineState === 'RUNNING',
        beaconOn: partialTelemetry.beaconOn ?? defaultEngineState === 'RUNNING',
        fuelPumpsOn: partialTelemetry.fuelPumpsOn ?? defaultEngineState === 'RUNNING',
        parkingBrake: partialTelemetry.parkingBrake ?? restoredPhase === 'PRE_FLIGHT',
        flaps: partialTelemetry.flaps ?? 0,
        gearDown: partialTelemetry.gearDown ?? restoredGearDown,
        speedbrake: partialTelemetry.speedbrake ?? 0,
        cabinAltitudeFt: partialTelemetry.cabinAltitudeFt ?? 8000,
      };
      const hasArrived = restoredTelemetry.phase === 'ARRIVED';
      const restoredIsPlaying = hasArrived ? false : Boolean(saved.isPlaying);
      const restoredTimeMultiplier = saved.timeMultiplier ?? APP_CONFIG.defaultTimeWarp;
      const restoredAutoLand = saved.autoLandEnabled ?? APP_CONFIG.defaultAutoLand;
      const restoredScenario = saved.scenario ?? null;

      setFlightPlan(restoredPlan);
      flightPlanRef.current = restoredPlan;
      setTelemetry(restoredTelemetry);
      telemetryRef.current = restoredTelemetry;
      setScenario(restoredScenario);
      scenarioRef.current = restoredScenario;
      setIsPlaying(restoredIsPlaying);
      isPlayingRef.current = restoredIsPlaying;
      setIsApproachCleared(Boolean(saved.isApproachCleared));
      isApproachClearedRef.current = Boolean(saved.isApproachCleared);
      setTimeMultiplier(restoredTimeMultiplier);
      timeMultiplierRef.current = restoredTimeMultiplier;
      setAutoLandEnabled(restoredAutoLand);
      autoLandEnabledRef.current = restoredAutoLand;
      setShowSummaryModal(hasArrived);
    } catch {
      window.localStorage.removeItem(FLIGHT_STORAGE_KEY);
    }
  }, []);

  // Persist the latest flight state (position, speed, altitude, phase, settings)
  const persistFlightState = useCallback(() => {
    try {
      const plan = flightPlanRef.current;
      const currentTelemetry = telemetryRef.current;

      if (!plan || !currentTelemetry) {
        window.localStorage.removeItem(FLIGHT_STORAGE_KEY);
        return;
      }

      const session: SavedFlightSession = {
        flightPlan: plan,
        telemetry: currentTelemetry,
        isPlaying: isPlayingRef.current,
        timeMultiplier: timeMultiplierRef.current,
        isApproachCleared: isApproachClearedRef.current,
        autoLandEnabled: autoLandEnabledRef.current,
        scenario: scenarioRef.current,
        savedAt: Date.now(),
      };

      window.localStorage.setItem(FLIGHT_STORAGE_KEY, JSON.stringify(session));
    } catch {
      return;
    }
  }, []);

  // Audio only runs while a flight is active, playing, and the tab is visible
  const syncAudioPlaybackState = useCallback(() => {
    flightAudio.setPaused(
      document.hidden || !isPlayingRef.current || !flightPlanRef.current
    );
  }, []);

  useEffect(() => {
    syncAudioPlaybackState();
  }, [isPlaying, flightPlan, syncAudioPlaybackState]);

  useEffect(() => {
    flightAudio.setMuted(isMuted);
  }, [isMuted]);

  // Unlock the AudioContext on the first user gesture (browser autoplay policy)
  useEffect(() => {
    const handleFirstGesture = () => flightAudio.unlock();
    window.addEventListener('pointerdown', handleFirstGesture, { once: true });
    return () => window.removeEventListener('pointerdown', handleFirstGesture);
  }, []);

  // Play takeoff / in-air / landing sounds as the flight phase changes
  useEffect(() => {
    const phase = telemetry?.phase ?? null;
    const prevPhase = prevAudioPhaseRef.current;
    prevAudioPhaseRef.current = phase;

    if (!telemetry || !flightPlan) {
      if (prevPhase !== null) {
        flightAudio.stopAll();
      }
      return;
    }

    if (phase !== prevPhase) {
      switch (phase) {
        case 'PRE_FLIGHT':
          flightAudio.stopAll();
          break;
        case 'TAXI':
          flightAudio.stopAll();
          break;
        case 'TAXI_TAKEOFF':
          flightAudio.playTakeoff();
          break;
        case 'CLIMB':
        case 'CRUISE':
        case 'EMERGENCY_DESCENT':
        case 'APPROACH_READY':
        case 'DESCENT':
        case 'FINAL_APPROACH':
          flightAudio.startAirAmbience();
          break;
        case 'TOUCHDOWN_ROLLOUT':
          flightAudio.playLanding();
          break;
        case 'ARRIVED':
          flightAudio.stopAirAmbience(0.5);
          break;
      }
    }

    if (phase && AIRBORNE_PHASES.includes(phase)) {
      flightAudio.updateAirAmbience(telemetry.groundSpeedKmh, telemetry.altitudeFt);
    }
  }, [telemetry, flightPlan]);

  // Save on tab switch (visibilitychange) and browser/tab close (pagehide)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        persistFlightState();
      }
      syncAudioPlaybackState();
    };
    const handlePageHide = () => persistFlightState();

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [persistFlightState, syncAudioPlaybackState]);

  // Main Simulation Loop
  const simulationTick = useCallback((now: number) => {
    if (!hasRestoredSessionRef.current) {
      hasRestoredSessionRef.current = true;
      restoreFlightSession();
    }

    if (!lastTimestampRef.current) {
      lastTimestampRef.current = now;
    }

    const elapsedRealSec = (now - lastTimestampRef.current) / 1000;
    lastTimestampRef.current = now;

    // Cap delta time to prevent massive jumps when switching tabs (max 0.25s real-time per frame)
    const clampedRealSec = Math.min(elapsedRealSec, 0.25);

    if (
      isPlayingRef.current &&
      telemetryRef.current &&
      flightPlanRef.current &&
      telemetryRef.current.phase !== 'ARRIVED'
    ) {
      const deltaSimSec = clampedRealSec * timeMultiplierRef.current;
      const activeScenario = scenarioRef.current;
      const scenarioContext: ScenarioSimulationContext | null = activeScenario
        ? {
            scenarioId: activeScenario.scenarioId,
            emergencyDescentStarted: activeScenario.emergencyDescentStarted,
            gearExtended: activeScenario.gearExtended,
          }
        : null;

      const { telemetry: nextTelemetry, showLandingPrompt } = stepSimulation(
        telemetryRef.current,
        flightPlanRef.current,
        deltaSimSec,
        isApproachClearedRef.current,
        scenarioContext
      );

      // Handle Approach / Landing Decision
      if (showLandingPrompt) {
        if (autoLandEnabledRef.current) {
          isApproachClearedRef.current = true;
          setIsApproachCleared(true);
        } else {
          // Pause simulation or show modal so user decides
          setShowLandingAlert(true);
        }
      }

      // A new leg after a layover requires a fresh approach clearance
      if ((nextTelemetry.legIndex ?? 1) > (telemetryRef.current.legIndex ?? 1)) {
        isApproachClearedRef.current = false;
        setIsApproachCleared(false);
        setShowLandingAlert(false);
      }

      // Check for Arrival
      if (nextTelemetry.phase === 'ARRIVED') {
        setIsPlaying(false);
        isPlayingRef.current = false;
        setShowSummaryModal(true);
      }

      telemetryRef.current = nextTelemetry;
      setTelemetry(nextTelemetry);
    }

    animFrameRef.current = requestAnimationFrame(simulationTick);
  }, [restoreFlightSession]);

  // Start / Stop animation ticker
  useEffect(() => {
    lastTimestampRef.current = null;
    animFrameRef.current = requestAnimationFrame(simulationTick);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [simulationTick]);

  // Handler: Start a newly filed flight plan
  const handleStartFlight = (plan: FlightPlan) => {
    flightAudio.unlock();
    setFlightPlan(plan);
    const initialTelem = getInitialTelemetry(plan);
    setTelemetry(initialTelem);
    setScenario(null);
    scenarioRef.current = null;
    setIsPlaying(true);
    setIsApproachCleared(false);
    setShowLandingAlert(false);
    setShowSummaryModal(false);
  };

  // Handler: Play / Pause
  const handleTogglePlay = () => {
    flightAudio.unlock();
    setIsPlaying((prev) => !prev);
  };

  // Handler: Reset to origin gate
  const handleResetFlight = () => {
    if (!flightPlan) return;
    flightAudio.stopAll();
    const initialTelem = getInitialTelemetry(flightPlan);
    setTelemetry(initialTelem);
    telemetryRef.current = initialTelem;
    setScenario(null);
    scenarioRef.current = null;
    setIsPlaying(false);
    setIsApproachCleared(false);
    setShowLandingAlert(false);
    setShowSummaryModal(false);
  };

  // Handler: Update aircraft system switches (battery, beacon, flaps, gear, ...)
  const handleUpdateSystems = useCallback((patch: SystemsPatch) => {
    setTelemetry((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      telemetryRef.current = next;
      return next;
    });
  }, []);

  // Handler: Start / cancel an engine spool-up
  const handleToggleEngine = useCallback((index: number) => {
    setTelemetry((prev) => {
      if (!prev) return prev;
      if (prev.phase !== 'PRE_FLIGHT' && prev.phase !== 'TAXI') return prev;
      const engines = [...(prev.engines ?? [])];
      const engine = engines[index];
      if (!engine) return prev;
      if (engine.state === 'OFF') {
        if (!prev.batteryOn || !prev.fuelPumpsOn || !prev.parkingBrake) return prev;
        engines[index] = {
          state: 'STARTING',
          startRemainingSeconds: ENGINE_START_SECONDS,
        };
      } else if (engine.state === 'STARTING') {
        engines[index] = { state: 'OFF', startRemainingSeconds: 0 };
      } else {
        return prev;
      }
      const next = { ...prev, engines };
      telemetryRef.current = next;
      return next;
    });
    setIsPlaying(true);
  }, []);

  // Handler: Begin taxi to the active runway
  const handleStartTaxi = useCallback(() => {
    setTelemetry((prev) => {
      if (!prev || prev.phase !== 'PRE_FLIGHT') return prev;
      const next = { ...prev, phase: 'TAXI' as FlightPhase };
      telemetryRef.current = next;
      return next;
    });
    setIsPlaying(true);
  }, []);

  // Handler: Line up and begin the takeoff roll
  const handleBeginTakeoff = useCallback(() => {
    setTelemetry((prev) => {
      if (!prev || prev.phase !== 'TAXI') return prev;
      const next = { ...prev, phase: 'TAXI_TAKEOFF' as FlightPhase };
      telemetryRef.current = next;
      return next;
    });
    setIsPlaying(true);
  }, []);

  const handleStartScenario = useCallback(
    (scenarioId: ScenarioId, mode: ScenarioMode) => {
      const current = telemetryRef.current;
      const plan = flightPlanRef.current;
      if (
        !current ||
        !plan ||
        scenarioRef.current ||
        !canStartScenario(current.phase)
      ) {
        return;
      }

      const runningIndex = (current.engines ?? []).findIndex(
        (engine) => engine.state === 'RUNNING'
      );
      const engineIndex =
        scenarioId === 'ENGINE_FAILURE'
          ? Math.max(0, runningIndex)
          : null;

      let nextTelemetry = current;
      if (scenarioId === 'ENGINE_FAILURE') {
        const engines = [
          ...(current.engines ??
            createEngineStatuses(
              plan.aircraft.engineCount ?? 2,
              'RUNNING'
            )),
        ];
        const index = engineIndex ?? 0;
        if (engines[index]) {
          engines[index] = { state: 'FAILED', startRemainingSeconds: 0 };
        }
        nextTelemetry = { ...nextTelemetry, engines };
      } else if (scenarioId === 'GEAR_JAM') {
        nextTelemetry = { ...nextTelemetry, gearDown: false };
      } else {
        nextTelemetry = { ...nextTelemetry, cabinAltitudeFt: 8000 };
      }

      const session = createScenarioSession(
        scenarioId,
        mode,
        current.elapsedSimSeconds,
        engineIndex
      );
      telemetryRef.current = nextTelemetry;
      setTelemetry(nextTelemetry);
      scenarioRef.current = session;
      setScenario(session);
      setShowLandingAlert(false);
      setShowSummaryModal(false);
    },
    []
  );

  const handleScenarioStep = useCallback((stepId: string) => {
    const session = scenarioRef.current;
    const current = telemetryRef.current;
    if (
      !session ||
      !current ||
      session.completedAtSimSeconds !== null
    ) {
      return;
    }

    const step = getScenarioStep(session.scenarioId, stepId);
    if (!step) return;
    if (step.id === 'levelOff' && current.altitudeFt > 11000) return;

    let nextTelemetry = current;
    if (step.action === 'ALTERNATE_GEAR_EXTEND') {
      nextTelemetry = { ...nextTelemetry, gearDown: true };
    } else if (step.action === 'START_EMERGENCY_DESCENT') {
      nextTelemetry = {
        ...nextTelemetry,
        phase: 'EMERGENCY_DESCENT',
        speedbrake: 100,
      };
      setIsPlaying(true);
    } else if (step.action === 'GEAR_LEVER_DOWN') {
      nextTelemetry = { ...nextTelemetry, gearDown: false };
    } else if (step.action === 'SECURE_ENGINE') {
      const engines = [...(current.engines ?? [])];
      const index = session.engineIndex ?? 0;
      if (engines[index]) {
        engines[index] = { state: 'FAILED', startRemainingSeconds: 0 };
      }
      nextTelemetry = { ...nextTelemetry, engines };
    }

    const nextSession = completeScenarioStep(
      session,
      stepId,
      nextTelemetry.elapsedSimSeconds
    );
    telemetryRef.current = nextTelemetry;
    if (nextTelemetry !== current) setTelemetry(nextTelemetry);
    scenarioRef.current = nextSession;
    setScenario(nextSession);
  }, []);

  const handleEndScenario = useCallback(() => {
    const session = scenarioRef.current;
    const current = telemetryRef.current;
    if (!session || !current) return;

    const plan = flightPlanRef.current;
    const engines = (current.engines ?? []).map((engine) =>
      engine.state === 'FAILED'
        ? { state: 'RUNNING' as const, startRemainingSeconds: 0 }
        : engine
    );
    let phase = current.phase;
    if (phase === 'EMERGENCY_DESCENT') {
      const cruiseAltitudeFt =
        plan?.aircraft.cruiseAltitudeFt ?? current.altitudeFt;
      phase =
        current.altitudeFt < cruiseAltitudeFt - 200 ? 'CLIMB' : 'CRUISE';
    }

    const nextTelemetry: LiveTelemetry = {
      ...current,
      engines,
      phase,
      speedbrake: session.emergencyDescentStarted ? 0 : current.speedbrake,
      cabinAltitudeFt: 8000,
    };
    telemetryRef.current = nextTelemetry;
    setTelemetry(nextTelemetry);
    scenarioRef.current = null;
    setScenario(null);
  }, []);

  // Handler: User approves landing clearance
  const handleConfirmLanding = () => {
    flightAudio.unlock();
    setIsApproachCleared(true);
    isApproachClearedRef.current = true;
    setShowLandingAlert(false);
    setIsPlaying(true);
  };

  // Handler: Dismiss landing alert (hold)
  const handleDismissLandingAlert = () => {
    setShowLandingAlert(false);
  };

  // Handler: Return to Flight Planner
  const handleNewFlight = () => {
    flightAudio.stopAll();
    setIsPlaying(false);
    isPlayingRef.current = false;
    setFlightPlan(null);
    flightPlanRef.current = null;
    setTelemetry(null);
    telemetryRef.current = null;
    setScenario(null);
    scenarioRef.current = null;
    setShowLandingAlert(false);
    setShowSummaryModal(false);
    persistFlightState();
  };

  return (
    <main className="flex-1 flex flex-col h-dvh w-full overflow-hidden bg-zinc-950 select-none">
      {/* Top Application Nav Bar */}
      <header className="h-14 border-b border-zinc-800 bg-zinc-900/95 backdrop-blur-md px-3 sm:px-4 flex items-center justify-between z-20 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 shrink-0">
            <div className="p-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Plane className="w-5 h-5 -rotate-45" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-black text-sm tracking-tight text-white">
                  NextAir
                </span>
                <span className="hidden sm:inline text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30">
                  2D RADAR
                </span>
              </div>
            </div>
          </div>

          {/* Active Flight Breadcrumb */}
          {flightPlan && (
            <div className="hidden sm:flex items-center gap-2 ml-4 pl-4 border-l border-zinc-800 text-xs">
              <span className="text-zinc-400 font-medium">Route:</span>
              <span className="font-mono font-bold text-emerald-400">
                {flightPlan.origin.code} ({flightPlan.origin.country})
              </span>
              <span className="text-zinc-500">→</span>
              <span className="font-mono font-bold text-rose-400">
                {flightPlan.destination.code} ({flightPlan.destination.country})
              </span>
              <span className="text-zinc-500">•</span>
              <span className="text-zinc-300 font-medium">
                {flightPlan.aircraft.name}
              </span>
            </div>
          )}
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-2.5">
          {flightPlan && (
            <button
              onClick={handleNewFlight}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 bg-zinc-800 hover:bg-zinc-750 text-zinc-300 text-xs font-semibold rounded-lg border border-zinc-700 transition-colors touch-manipulation"
              title="Back to Flight Dispatch"
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Flight Dispatch</span>
            </button>
          )}

          {/* Sound Toggle */}
          <button
            onClick={() => {
              flightAudio.unlock();
              setIsMuted((prev) => !prev);
            }}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold rounded-lg border border-zinc-700 transition-colors touch-manipulation"
            title={isMuted ? 'Unmute sound' : 'Mute sound'}
          >
            {isMuted ? (
              <>
                <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                <span className="hidden sm:inline">Muted</span>
              </>
            ) : (
              <>
                <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
                <span className="hidden sm:inline">Sound</span>
              </>
            )}
          </button>

          {/* Fullscreen Button */}
          <button
            onClick={toggleFullscreen}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 sm:py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold rounded-lg border border-zinc-700 transition-colors touch-manipulation"
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
          >
            {isFullscreen ? (
              <>
                <Minimize className="w-3.5 h-3.5 text-cyan-400" />
                <span className="hidden sm:inline">Exit Fullscreen</span>
              </>
            ) : (
              <>
                <Maximize className="w-3.5 h-3.5 text-cyan-400" />
                <span className="hidden sm:inline">Fullscreen</span>
              </>
            )}
          </button>

          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 bg-emerald-950/40 border border-emerald-500/30 rounded-lg text-emerald-300 text-xs font-mono">
            <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span>RADAR ONLINE</span>
          </div>
        </div>
      </header>

      {/* Main View Area */}
      {!flightPlan || !telemetry ? (
        <div className="flex-1 overflow-y-auto bg-zinc-950 py-6">
          <FlightPlanner onStartFlight={handleStartFlight} />
        </div>
      ) : (
        <div className="flex-1 relative w-full h-[calc(100dvh-3.5rem)] overflow-hidden">
          {/* 100% Edge-to-Edge Full-Screen 2D Leaflet Map */}
          <div className="absolute inset-0 w-full h-full z-0">
            <FlightMap
              flightPlan={flightPlan}
              telemetry={telemetry}
              autoCenter={autoCenter}
              onToggleAutoCenter={() => setAutoCenter((prev) => !prev)}
            />
          </div>

          {/* Floating Glass Cockpit HUD Overlay at the bottom */}
          <div className="absolute bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-2 right-2 sm:left-3 sm:right-3 z-[500] pointer-events-none">
            <div ref={hudRef} className="pointer-events-auto max-w-7xl mx-auto">
              <CockpitHUD
                flightPlan={flightPlan}
                telemetry={telemetry}
                isPlaying={isPlaying}
                timeMultiplier={timeMultiplier}
                autoLandEnabled={autoLandEnabled}
                scenario={scenario}
                onTogglePlay={handleTogglePlay}
                onSetTimeMultiplier={(m) => setTimeMultiplier(m)}
                onReset={handleResetFlight}
                onToggleAutoLand={() => setAutoLandEnabled((prev) => !prev)}
                onInitiateLanding={handleConfirmLanding}
                onNewFlight={handleNewFlight}
                onUpdateSystems={handleUpdateSystems}
                onToggleEngine={handleToggleEngine}
                onStartTaxi={handleStartTaxi}
                onBeginTakeoff={handleBeginTakeoff}
                onStartScenario={handleStartScenario}
                onScenarioStep={handleScenarioStep}
                onEndScenario={handleEndScenario}
              />
            </div>
          </div>

          {/* Aircraft type card anchored to the bottom-left of the map */}
          <div
            className="absolute left-2 sm:left-3 z-[450] pointer-events-none"
            style={{
              bottom: `calc(${hudHeight}px + 1.25rem + env(safe-area-inset-bottom))`,
            }}
          >
            <div className="pointer-events-auto">
              <AircraftCard flightPlan={flightPlan} />
            </div>
          </div>

          {/* Modal: Landing Alert */}
          {showLandingAlert && (
            <LandingAlert
              destination={
                flightPlan.layover && (telemetry.legIndex ?? 1) === 1
                  ? flightPlan.layover.airport
                  : flightPlan.destination
              }
              isLayover={Boolean(flightPlan.layover && (telemetry.legIndex ?? 1) === 1)}
              aircraft={flightPlan.aircraft}
              telemetry={telemetry}
              onConfirmLanding={handleConfirmLanding}
              onDismiss={handleDismissLandingAlert}
            />
          )}

          {/* Modal: Flight Completed Debrief */}
          {showSummaryModal && (
            <FlightSummaryModal
              flightPlan={flightPlan}
              telemetry={telemetry}
              scenario={scenario}
              scenarioEvaluation={
                scenario?.mode === 'CHECKRIDE'
                  ? evaluateScenario(
                      scenario,
                      telemetry,
                      telemetry.phase === 'ARRIVED'
                    )
                  : null
              }
              onPlanNewFlight={handleNewFlight}
              onReplayFlight={handleResetFlight}
            />
          )}
        </div>
      )}
    </main>
  );
}
