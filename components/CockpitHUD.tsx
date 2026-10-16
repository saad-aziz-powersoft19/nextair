'use client';

import React, { useState } from 'react';
import {
  FlightPlan,
  LiveTelemetry,
  FlightPhase,
} from '@/types/flight';
import {
  getPhaseDisplay,
  TIME_MULTIPLIERS,
} from '@/lib/simulation';
import {
  Play,
  Pause,
  RotateCcw,
  Gauge,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Plane,
  Clock,
  Navigation,
  Compass,
  AlertCircle,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface CockpitHUDProps {
  flightPlan: FlightPlan;
  telemetry: LiveTelemetry;
  isPlaying: boolean;
  timeMultiplier: number;
  autoLandEnabled: boolean;
  onTogglePlay: () => void;
  onSetTimeMultiplier: (multiplier: number) => void;
  onReset: () => void;
  onToggleAutoLand: () => void;
  onInitiateLanding: () => void;
  onNewFlight: () => void;
}

export default function CockpitHUD({
  flightPlan,
  telemetry,
  isPlaying,
  timeMultiplier,
  autoLandEnabled,
  onTogglePlay,
  onSetTimeMultiplier,
  onReset,
  onToggleAutoLand,
  onInitiateLanding,
  onNewFlight,
}: CockpitHUDProps) {
  const [isMinimized, setIsMinimized] = useState(false);
  const { origin, destination, aircraft, totalDistanceKm } = flightPlan;
  const phaseInfo = getPhaseDisplay(telemetry.phase);

  // Format seconds to HH:MM:SS
  const formatTime = (totalSeconds: number) => {
    const s = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  // Vertical speed trend icon
  const renderVsiIcon = () => {
    if (telemetry.verticalSpeedFtMin > 100) {
      return <ArrowUpRight className="w-4 h-4 text-emerald-400 animate-pulse" />;
    }
    if (telemetry.verticalSpeedFtMin < -100) {
      return <ArrowDownRight className="w-4 h-4 text-purple-400 animate-pulse" />;
    }
    return <Minus className="w-4 h-4 text-zinc-400" />;
  };

  const canInitiateLanding =
    telemetry.phase === 'APPROACH_READY' ||
    (telemetry.phase === 'CRUISE' && telemetry.distanceRemainingKm < 350);

  // Minimized Sleek Floating Pill Bar
  if (isMinimized) {
    return (
      <div className="w-full bg-zinc-950/90 backdrop-blur-xl border border-zinc-800/90 rounded-2xl p-2.5 shadow-[0_10px_35px_rgba(0,0,0,0.8)] text-zinc-100 flex flex-wrap items-center justify-between gap-3 animate-in fade-in duration-200">
        <div className="flex items-center gap-3">
          <button
            onClick={onTogglePlay}
            disabled={telemetry.phase === 'ARRIVED'}
            className={`p-2 rounded-xl font-bold shadow-md transition-all ${
              telemetry.phase === 'ARRIVED'
                ? 'bg-zinc-800 text-zinc-600'
                : isPlaying
                ? 'bg-amber-500 hover:bg-amber-400 text-black'
                : 'bg-emerald-500 hover:bg-emerald-400 text-black'
            }`}
            title={isPlaying ? 'Pause Simulation' : 'Resume Simulation'}
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current" />
            )}
          </button>

          <div className="flex items-center gap-2">
            <span className="text-base font-black text-emerald-400 font-mono">
              {origin.code}
            </span>
            <Plane className="w-3.5 h-3.5 text-cyan-400 rotate-90" />
            <span className="text-base font-black text-rose-400 font-mono">
              {destination.code}
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-3 border-l border-zinc-800 pl-3 text-xs font-mono">
            <div>
              <span className="text-zinc-500 text-[10px] block">ALT</span>
              <span className="font-bold text-white">{telemetry.altitudeFt.toLocaleString()} FT</span>
            </div>
            <div>
              <span className="text-zinc-500 text-[10px] block">SPD</span>
              <span className="font-bold text-white">{telemetry.groundSpeedKnots} KTS</span>
            </div>
            <div>
              <span className="text-zinc-500 text-[10px] block">HDG</span>
              <span className="font-bold text-white">{String(telemetry.heading).padStart(3, '0')}°</span>
            </div>
            <div>
              <span className="text-zinc-500 text-[10px] block">DIST</span>
              <span className="font-bold text-white">{Math.round(telemetry.distanceRemainingKm)} KM</span>
            </div>
          </div>
        </div>

        {/* Action button if near destination */}
        {canInitiateLanding && (
          <button
            onClick={onInitiateLanding}
            className="px-3 py-1 bg-gradient-to-r from-orange-500 to-amber-500 text-black font-extrabold text-xs rounded-lg shadow-md animate-bounce flex items-center gap-1"
          >
            <AlertCircle className="w-3.5 h-3.5" />
            <span>LAND NOW</span>
          </button>
        )}

        {/* Warp Controls & Maximize Button */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-zinc-900/80 p-1 rounded-lg border border-zinc-800 text-[11px] font-mono">
            {[1, 10, 25, 50, 100].map((m) => (
              <button
                key={m}
                onClick={() => onSetTimeMultiplier(m)}
                className={`px-1.5 py-0.5 rounded font-bold transition-all ${
                  timeMultiplier === m
                    ? 'bg-cyan-500 text-black'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {m}x
              </button>
            ))}
          </div>

          <button
            onClick={() => setIsMinimized(false)}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-zinc-800/90 hover:bg-zinc-700 text-cyan-300 text-xs font-semibold rounded-lg border border-zinc-700 transition-colors"
            title="Expand Full Avionics Cockpit"
          >
            <span>Avionics</span>
            <ChevronUp className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // Full Avionics Glass Cockpit Dock
  return (
    <div className="w-full bg-zinc-950/90 backdrop-blur-xl border border-zinc-800/90 rounded-2xl p-4 shadow-[0_15px_45px_rgba(0,0,0,0.85)] text-zinc-100 flex flex-col gap-3.5 animate-in fade-in duration-200">
      {/* Upper Cockpit Ribbon: Route, Aircraft, Phase Badge & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2.5 border-b border-zinc-800/80">
        {/* Origin to Destination Summary */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xl font-black text-emerald-400 font-mono tracking-wider">
              {origin.code}
            </span>
            <span className="text-xs text-zinc-400 font-medium">({origin.city})</span>
            <Plane className="w-4 h-4 text-cyan-400 rotate-90" />
            <span className="text-xl font-black text-rose-400 font-mono tracking-wider">
              {destination.code}
            </span>
            <span className="text-xs text-zinc-400 font-medium">({destination.city})</span>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-zinc-900/80 rounded-md border border-zinc-800 text-xs">
            <span className="text-zinc-400 font-medium">Aircraft:</span>
            <span className="text-cyan-300 font-bold">{aircraft.name}</span>
          </div>
        </div>

        {/* Phase Badge & Actions */}
        <div className="flex items-center gap-2">
          {/* Landing Action Button */}
          {canInitiateLanding && (
            <button
              onClick={onInitiateLanding}
              className="px-3.5 py-1.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-black font-extrabold text-xs rounded-lg shadow-[0_0_15px_rgba(249,115,22,0.6)] animate-bounce flex items-center gap-1.5 transition-all"
            >
              <AlertCircle className="w-4 h-4" />
              <span>CLEAR FOR LANDING</span>
            </button>
          )}

          <div
            className={`px-3 py-1 rounded-full text-xs font-bold border flex items-center gap-1.5 shadow-sm ${phaseInfo.badgeClass}`}
          >
            <span className="w-2 h-2 rounded-full bg-current animate-ping"></span>
            <span>{phaseInfo.label}</span>
          </div>

          <button
            onClick={onNewFlight}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold rounded-lg border border-zinc-700 transition-colors"
          >
            New Flight
          </button>

          {/* Minimize / Collapse Cockpit */}
          <button
            onClick={() => setIsMinimized(true)}
            className="p-1.5 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-white rounded-lg border border-zinc-700 transition-colors"
            title="Minimize Cockpit (Full Map View)"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Flight Progress Bar */}
      <div className="flex flex-col gap-1">
        <div className="flex justify-between items-center text-xs font-mono text-zinc-400">
          <span>{Math.round(telemetry.distanceTraveledKm)} km flown</span>
          <span className="font-bold text-cyan-400">
            {telemetry.progressPercent.toFixed(1)}% Completed
          </span>
          <span>{Math.round(telemetry.distanceRemainingKm)} km remaining</span>
        </div>
        <div className="w-full h-2 bg-zinc-900 rounded-full overflow-hidden border border-zinc-800 relative">
          <div
            className="h-full bg-gradient-to-r from-cyan-500 via-emerald-400 to-teal-300 transition-all duration-300 ease-out shadow-[0_0_10px_rgba(34,211,238,0.5)]"
            style={{ width: `${Math.min(100, telemetry.progressPercent)}%` }}
          />
        </div>
      </div>

      {/* Primary Flight Display (PFD) Avionics Instrument Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {/* 1. Altitude */}
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-2.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-medium">
            <span>ALTITUDE</span>
            <span className="text-[10px] text-cyan-400">
              FL{Math.round(telemetry.altitudeFt / 100)}
            </span>
          </div>
          <div className="mt-0.5 flex items-baseline justify-between">
            <span className="text-xl sm:text-2xl font-black font-mono text-white">
              {telemetry.altitudeFt.toLocaleString()}
            </span>
            <span className="text-xs text-zinc-400 font-mono">FT</span>
          </div>
          <div className="text-[11px] text-zinc-400 flex items-center gap-1">
            {renderVsiIcon()}
            <span>{telemetry.verticalSpeedFtMin} ft/m</span>
          </div>
        </div>

        {/* 2. Ground Speed */}
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-2.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-medium">
            <span>AIRSPEED</span>
            <Gauge className="w-3.5 h-3.5 text-zinc-500" />
          </div>
          <div className="mt-0.5 flex items-baseline justify-between">
            <span className="text-xl sm:text-2xl font-black font-mono text-white">
              {telemetry.groundSpeedKnots}
            </span>
            <span className="text-xs text-zinc-400 font-mono">KTS</span>
          </div>
          <div className="text-[11px] text-zinc-400 flex items-center justify-between">
            <span>{telemetry.groundSpeedKmh} km/h</span>
            <span className="text-amber-400 font-bold">M {telemetry.mach}</span>
          </div>
        </div>

        {/* 3. Heading */}
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-2.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-medium">
            <span>HEADING</span>
            <Compass className="w-3.5 h-3.5 text-zinc-500" />
          </div>
          <div className="mt-0.5 flex items-baseline justify-between">
            <span className="text-xl sm:text-2xl font-black font-mono text-white">
              {String(telemetry.heading).padStart(3, '0')}°
            </span>
            <span className="text-xs text-zinc-400 font-mono">DEG</span>
          </div>
          <div className="text-[11px] text-zinc-400">
            <span>Magnetic Track</span>
          </div>
        </div>

        {/* 4. Distance Remaining */}
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-2.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-medium">
            <span>DISTANCE</span>
            <Navigation className="w-3.5 h-3.5 text-zinc-500" />
          </div>
          <div className="mt-0.5 flex items-baseline justify-between">
            <span className="text-xl sm:text-2xl font-black font-mono text-white">
              {Math.round(telemetry.distanceRemainingKm).toLocaleString()}
            </span>
            <span className="text-xs text-zinc-400 font-mono">KM</span>
          </div>
          <div className="text-[11px] text-zinc-400">
            <span>{Math.round(telemetry.distanceRemainingKm * 0.539957)} NM to go</span>
          </div>
        </div>

        {/* 5. Elapsed Flight Time */}
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-2.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-medium">
            <span>TIME EN ROUTE</span>
            <Clock className="w-3.5 h-3.5 text-zinc-500" />
          </div>
          <div className="mt-0.5 flex items-baseline justify-between">
            <span className="text-lg sm:text-xl font-bold font-mono text-white">
              {formatTime(telemetry.elapsedSimSeconds)}
            </span>
          </div>
          <div className="text-[11px] text-zinc-400">
            <span>Elapsed Sim Time</span>
          </div>
        </div>

        {/* 6. Estimated Time Remaining (ETA) */}
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-2.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-medium">
            <span>ESTIMATED TIME</span>
            <span className="text-[10px] text-emerald-400 font-bold">ETA</span>
          </div>
          <div className="mt-0.5 flex items-baseline justify-between">
            <span className="text-lg sm:text-xl font-bold font-mono text-emerald-300">
              {formatTime(telemetry.etaSecondsRemaining)}
            </span>
          </div>
          <div className="text-[11px] text-zinc-400">
            <span>Until Touchdown</span>
          </div>
        </div>
      </div>

      {/* Simulation Controls: Play/Pause, Speed Warp, Auto-Land */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        {/* Play/Pause & Reset */}
        <div className="flex items-center gap-2">
          <button
            onClick={onTogglePlay}
            disabled={telemetry.phase === 'ARRIVED'}
            className={`flex items-center gap-2 px-5 py-2 rounded-xl font-bold text-sm shadow-lg transition-all ${
              telemetry.phase === 'ARRIVED'
                ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                : isPlaying
                ? 'bg-amber-500 hover:bg-amber-400 text-black shadow-amber-500/20'
                : 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-emerald-500/20'
            }`}
          >
            {isPlaying ? (
              <>
                <Pause className="w-4 h-4 fill-current" />
                <span>PAUSE</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>{telemetry.phase === 'PRE_FLIGHT' ? 'TAKEOFF & FLY' : 'RESUME'}</span>
              </>
            )}
          </button>

          <button
            onClick={onReset}
            className="flex items-center gap-1.5 px-3 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-semibold rounded-xl border border-zinc-800 transition-colors"
            title="Reset flight to origin gate"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
        </div>

        {/* Time Multiplier (Warp Speed) */}
        <div className="flex items-center gap-1.5 bg-zinc-900/80 p-1.5 rounded-xl border border-zinc-800">
          <span className="text-xs font-semibold text-zinc-400 px-2">Time Warp:</span>
          {TIME_MULTIPLIERS.map((multiplier) => (
            <button
              key={multiplier}
              onClick={() => onSetTimeMultiplier(multiplier)}
              className={`px-2.5 py-1 text-xs font-mono font-bold rounded-lg transition-all ${
                timeMultiplier === multiplier
                  ? 'bg-cyan-500 text-black shadow-[0_0_8px_rgba(34,211,238,0.5)]'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
              }`}
            >
              {multiplier}x
            </button>
          ))}
        </div>

        {/* Auto Land Switch */}
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleAutoLand}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
              autoLandEnabled
                ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
            title="Automatically initiate descent & landing when approaching destination"
          >
            <ShieldCheck className={`w-4 h-4 ${autoLandEnabled ? 'text-emerald-400' : 'text-zinc-500'}`} />
            <span>Auto-Land: {autoLandEnabled ? 'ENABLED' : 'MANUAL'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
