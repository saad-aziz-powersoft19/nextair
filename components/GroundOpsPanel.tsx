'use client';

import React from 'react';
import {
  BatteryCharging,
  Fuel,
  Lightbulb,
  Lock,
  LockOpen,
  PlaneTakeoff,
} from 'lucide-react';
import { LiveTelemetry, SystemsPatch } from '@/types/flight';
import {
  TAXI_DISTANCE_KM,
  buildChecklists,
  isTaxiComplete,
} from '@/lib/ground';

interface GroundOpsPanelProps {
  telemetry: LiveTelemetry;
  onUpdateSystems: (patch: SystemsPatch) => void;
  onToggleEngine: (index: number) => void;
  onStartTaxi: () => void;
  onBeginTakeoff: () => void;
}

interface SystemToggleProps {
  label: string;
  active: boolean;
  icon: React.ReactNode;
  onClick: () => void;
}

function SystemToggle({ label, active, icon, onClick }: SystemToggleProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10px] font-bold uppercase tracking-wide transition-colors ${
        active
          ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
          : 'bg-zinc-950/60 border-zinc-700 text-zinc-400 hover:text-zinc-200'
      }`}
    >
      {icon}
      <span>{label}</span>
      <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
    </button>
  );
}

export default function GroundOpsPanel({
  telemetry,
  onUpdateSystems,
  onToggleEngine,
  onStartTaxi,
  onBeginTakeoff,
}: GroundOpsPanelProps) {
  const engines = telemetry.engines ?? [];
  const checklists = buildChecklists(telemetry);
  const beforeStart = checklists[0];
  const afterStart = checklists[1];
  const beforeTakeoff = checklists[2];

  const isTaxiing = telemetry.phase === 'TAXI';
  const atRunway = isTaxiComplete(telemetry);
  const taxiPercent = Math.min(
    100,
    Math.round((telemetry.distanceTraveledKm / TAXI_DISTANCE_KM) * 100)
  );
  const canStartEngines = Boolean(
    telemetry.batteryOn && telemetry.fuelPumpsOn && telemetry.parkingBrake
  );
  const canStartTaxi = beforeStart.isComplete && afterStart.isComplete;
  const canTakeOff = afterStart.isComplete && beforeTakeoff.isComplete;
  const flaps = telemetry.flaps ?? 0;
  const speedbrake = telemetry.speedbrake ?? 0;
  const gearDown = Boolean(telemetry.gearDown);

  return (
    <div className="p-3 bg-zinc-900/80 border border-zinc-800 rounded-xl flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-white uppercase tracking-wider">
          Ground Operations
        </span>
        <span
          className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold border uppercase ${
            isTaxiing
              ? 'bg-sky-950/60 border-sky-700/60 text-sky-300'
              : 'bg-zinc-950/60 border-zinc-700 text-zinc-400'
          }`}
        >
          {isTaxiing ? 'Taxiing' : 'Cold & Dark'}
        </span>
        {!canStartEngines && !isTaxiing && (
          <span className="ml-auto text-[9px] font-mono text-amber-300/90">
            Battery + fuel pumps + parking brake required for engine start
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <SystemToggle
          label="Battery"
          active={Boolean(telemetry.batteryOn)}
          icon={<BatteryCharging className="w-3.5 h-3.5" />}
          onClick={() => onUpdateSystems({ batteryOn: !telemetry.batteryOn })}
        />
        <SystemToggle
          label="Beacon"
          active={Boolean(telemetry.beaconOn)}
          icon={<Lightbulb className="w-3.5 h-3.5" />}
          onClick={() => onUpdateSystems({ beaconOn: !telemetry.beaconOn })}
        />
        <SystemToggle
          label="Fuel Pumps"
          active={Boolean(telemetry.fuelPumpsOn)}
          icon={<Fuel className="w-3.5 h-3.5" />}
          onClick={() => onUpdateSystems({ fuelPumpsOn: !telemetry.fuelPumpsOn })}
        />
        <SystemToggle
          label={telemetry.parkingBrake ? 'Brake Set' : 'Brake Off'}
          active={Boolean(telemetry.parkingBrake)}
          icon={
            telemetry.parkingBrake ? (
              <Lock className="w-3.5 h-3.5" />
            ) : (
              <LockOpen className="w-3.5 h-3.5" />
            )
          }
          onClick={() => onUpdateSystems({ parkingBrake: !telemetry.parkingBrake })}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {engines.map((engine, index) => {
          const stateLabel =
            engine.state === 'RUNNING'
              ? 'RUN'
              : engine.state === 'STARTING'
              ? `${Math.max(1, Math.ceil(engine.startRemainingSeconds))}s`
              : engine.state === 'FAILED'
              ? 'FAIL'
              : 'OFF';
          const disabled =
            engine.state === 'RUNNING' ||
            engine.state === 'FAILED' ||
            (engine.state === 'OFF' && !canStartEngines);
          return (
            <button
              key={`engine-${index}`}
              onClick={() => onToggleEngine(index)}
              disabled={disabled}
              title={
                engine.state === 'FAILED'
                  ? 'Engine failed — secure before landing'
                  : engine.state === 'OFF' && !canStartEngines
                  ? 'Set parking brake, battery and fuel pumps first'
                  : undefined
              }
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-bold font-mono uppercase transition-colors disabled:cursor-not-allowed ${
                engine.state === 'RUNNING'
                  ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                  : engine.state === 'STARTING'
                  ? 'bg-amber-500/15 border-amber-500/50 text-amber-300 animate-pulse'
                  : engine.state === 'FAILED'
                  ? 'bg-rose-500/15 border-rose-500/50 text-rose-300 animate-pulse'
                  : 'bg-zinc-950/60 border-zinc-700 text-zinc-400 hover:text-zinc-200 disabled:opacity-40'
              }`}
            >
              <span>ENG {index + 1}</span>
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  engine.state === 'RUNNING'
                    ? 'bg-emerald-400'
                    : engine.state === 'STARTING'
                    ? 'bg-amber-400'
                    : engine.state === 'FAILED'
                    ? 'bg-rose-400'
                    : 'bg-zinc-600'
                }`}
              />
              <span>{stateLabel}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold text-zinc-400 uppercase">Flaps</span>
          <div className="flex items-center bg-zinc-950/60 border border-zinc-700 rounded-lg overflow-hidden">
            <button
              onClick={() => onUpdateSystems({ flaps: Math.max(0, flaps - 1) })}
              disabled={flaps <= 0}
              className="px-2 py-1 text-sm font-bold text-zinc-300 hover:text-white disabled:text-zinc-600"
            >
              −
            </button>
            <span className="px-2 border-x border-zinc-800 font-mono font-bold text-xs text-white">
              {flaps}
            </span>
            <button
              onClick={() => onUpdateSystems({ flaps: Math.min(4, flaps + 1) })}
              disabled={flaps >= 4}
              className="px-2 py-1 text-sm font-bold text-zinc-300 hover:text-white disabled:text-zinc-600"
            >
              +
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold text-zinc-400 uppercase">Gear</span>
          <span className="px-2 py-1 rounded-lg border border-zinc-700 bg-zinc-950/60 text-[10px] font-bold font-mono text-emerald-300">
            {gearDown ? 'DOWN' : 'UP'}
          </span>
          <span className="text-[9px] font-mono text-zinc-500">LOCKED</span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold text-zinc-400 uppercase">Spd Brk</span>
          <div className="flex bg-zinc-950/60 border border-zinc-700 rounded-lg overflow-hidden">
            {[
              { value: 0, label: 'STOW' },
              { value: 50, label: 'HALF' },
              { value: 100, label: 'FULL' },
            ].map((option) => (
              <button
                key={option.value}
                onClick={() => onUpdateSystems({ speedbrake: option.value })}
                className={`px-2 py-1 text-[10px] font-bold font-mono transition-colors ${
                  speedbrake === option.value
                    ? 'bg-cyan-500/20 text-cyan-300'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {!isTaxiing ? (
          <>
            <button
              onClick={onStartTaxi}
              disabled={!canStartTaxi}
              className={`w-full py-2.5 rounded-lg font-black text-xs flex items-center justify-center gap-2 transition-all ${
                canStartTaxi
                  ? 'bg-gradient-to-r from-cyan-400 to-emerald-400 text-black hover:from-cyan-300 hover:to-emerald-300'
                  : 'bg-zinc-800 text-zinc-500 border border-zinc-700 cursor-not-allowed'
              }`}
            >
              <PlaneTakeoff className="w-4 h-4" />
              <span>TAXI TO RUNWAY</span>
            </button>
            {!canStartTaxi && (
              <span className="text-[10px] text-zinc-500 text-center">
                Complete Before Start and After Start checklists to request taxi
              </span>
            )}
          </>
        ) : !atRunway ? (
          <div className="flex flex-col gap-1 p-2 rounded-lg bg-zinc-950/50 border border-zinc-800">
            <div className="flex justify-between text-[10px] font-mono text-zinc-400">
              <span>TAXIING TO ACTIVE RUNWAY</span>
              <span className="text-cyan-300 font-bold">{taxiPercent}%</span>
            </div>
            <div className="w-full h-1.5 bg-zinc-900 rounded-full overflow-hidden border border-zinc-800">
              <div
                className="h-full bg-gradient-to-r from-sky-500 to-cyan-400 transition-all"
                style={{ width: `${taxiPercent}%` }}
              />
            </div>
          </div>
        ) : (
          <>
            <button
              onClick={onBeginTakeoff}
              disabled={!canTakeOff}
              className={`w-full py-2.5 rounded-lg font-black text-xs flex items-center justify-center gap-2 transition-all ${
                canTakeOff
                  ? 'bg-gradient-to-r from-orange-500 to-amber-400 text-black hover:from-orange-400 hover:to-amber-300 shadow-[0_0_15px_rgba(249,115,22,0.5)]'
                  : 'bg-zinc-800 text-zinc-500 border border-zinc-700 cursor-not-allowed'
              }`}
            >
              <PlaneTakeoff className="w-4 h-4" />
              <span>LINE UP & TAKEOFF</span>
            </button>
            {!canTakeOff && (
              <span className="text-[10px] text-zinc-500 text-center">
                Complete the Before Takeoff checklist to roll
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
