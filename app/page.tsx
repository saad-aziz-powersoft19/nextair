'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FlightPlan, LiveTelemetry } from '@/types/flight';
import {
  getInitialTelemetry,
  stepSimulation,
} from '@/lib/simulation';
import FlightPlanner from '@/components/FlightPlanner';
import FlightMap from '@/components/FlightMapDynamic';
import CockpitHUD from '@/components/CockpitHUD';
import LandingAlert from '@/components/LandingAlert';
import FlightSummaryModal from '@/components/FlightSummaryModal';
import { Plane, Compass, Radio, ChevronLeft, Maximize, Minimize } from 'lucide-react';
import { APP_CONFIG } from '@/lib/config';

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

  // Main Simulation Loop
  const simulationTick = useCallback((now: number) => {
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

      const { telemetry: nextTelemetry, showLandingPrompt } = stepSimulation(
        telemetryRef.current,
        flightPlanRef.current,
        deltaSimSec,
        isApproachClearedRef.current
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
  }, []);

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
    setFlightPlan(plan);
    const initialTelem = getInitialTelemetry(plan);
    setTelemetry(initialTelem);
    setIsPlaying(true);
    setIsApproachCleared(false);
    setShowLandingAlert(false);
    setShowSummaryModal(false);
  };

  // Handler: Play / Pause
  const handleTogglePlay = () => {
    setIsPlaying((prev) => !prev);
  };

  // Handler: Reset to origin gate
  const handleResetFlight = () => {
    if (!flightPlan) return;
    const initialTelem = getInitialTelemetry(flightPlan);
    setTelemetry(initialTelem);
    telemetryRef.current = initialTelem;
    setIsPlaying(false);
    setIsApproachCleared(false);
    setShowLandingAlert(false);
    setShowSummaryModal(false);
  };

  // Handler: User approves landing clearance
  const handleConfirmLanding = () => {
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
    setIsPlaying(false);
    setFlightPlan(null);
    setTelemetry(null);
    setShowLandingAlert(false);
    setShowSummaryModal(false);
  };

  return (
    <main className="flex-1 flex flex-col h-screen w-screen overflow-hidden bg-zinc-950 select-none">
      {/* Top Application Nav Bar */}
      <header className="h-14 border-b border-zinc-800 bg-zinc-900/95 backdrop-blur-md px-4 flex items-center justify-between z-20 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Plane className="w-5 h-5 -rotate-45" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-black text-sm tracking-tight text-white">
                  NextAir
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30">
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
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-750 text-zinc-300 text-xs font-semibold rounded-lg border border-zinc-700 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Flight Dispatch</span>
            </button>
          )}

          {/* Fullscreen Button */}
          <button
            onClick={toggleFullscreen}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold rounded-lg border border-zinc-700 transition-colors"
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

          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-950/40 border border-emerald-500/30 rounded-lg text-emerald-300 text-xs font-mono">
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
        <div className="flex-1 relative w-full h-[calc(100vh-3.5rem)] overflow-hidden">
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
          <div className="absolute bottom-3 left-3 right-3 z-[500] pointer-events-none">
            <div className="pointer-events-auto max-w-7xl mx-auto">
              <CockpitHUD
                flightPlan={flightPlan}
                telemetry={telemetry}
                isPlaying={isPlaying}
                timeMultiplier={timeMultiplier}
                autoLandEnabled={autoLandEnabled}
                onTogglePlay={handleTogglePlay}
                onSetTimeMultiplier={(m) => setTimeMultiplier(m)}
                onReset={handleResetFlight}
                onToggleAutoLand={() => setAutoLandEnabled((prev) => !prev)}
                onInitiateLanding={handleConfirmLanding}
                onNewFlight={handleNewFlight}
              />
            </div>
          </div>

          {/* Modal: Landing Alert */}
          {showLandingAlert && (
            <LandingAlert
              destination={flightPlan.destination}
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
              onPlanNewFlight={handleNewFlight}
              onReplayFlight={handleResetFlight}
            />
          )}
        </div>
      )}
    </main>
  );
}
