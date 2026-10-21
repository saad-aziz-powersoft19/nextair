'use client';

import { LiveTelemetry, SystemsPatch } from '@/types/flight';

interface FlightControlsProps {
  telemetry: LiveTelemetry;
  originElevationFt: number;
  gearJammed?: boolean;
  onUpdateSystems: (patch: SystemsPatch) => void;
}

export default function FlightControls({
  telemetry,
  originElevationFt,
  gearJammed = false,
  onUpdateSystems,
}: FlightControlsProps) {
  const flaps = telemetry.flaps ?? 0;
  const speedbrake = telemetry.speedbrake ?? 0;
  const gearDown = Boolean(telemetry.gearDown);
  const gearLocked = telemetry.altitudeFt <= originElevationFt + 100;
  const configDrag =
    flaps > 0 ||
    (gearDown && (telemetry.phase === 'CLIMB' || telemetry.phase === 'CRUISE') && !gearLocked) ||
    speedbrake > 0;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-2.5 bg-zinc-900/70 border border-zinc-800 rounded-xl">
      <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
        Flight Controls
      </span>

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
        <div className="flex bg-zinc-950/60 border border-zinc-700 rounded-lg overflow-hidden">
          <button
            onClick={() => onUpdateSystems({ gearDown: false })}
            disabled={!gearDown || gearLocked || gearJammed}
            title={
              gearJammed
                ? 'Gear jammed — use the emergency checklist'
                : gearLocked
                ? 'Locked down below 100 ft AGL'
                : 'Retract gear'
            }
            className={`px-2 py-1 text-[10px] font-bold font-mono transition-colors disabled:opacity-40 ${
              !gearDown ? 'bg-emerald-500/20 text-emerald-300' : 'text-zinc-400 hover:text-white'
            }`}
          >
            UP
          </button>
          <button
            onClick={() => onUpdateSystems({ gearDown: true })}
            disabled={gearDown || gearJammed}
            className={`px-2 py-1 text-[10px] font-bold font-mono border-l border-zinc-800 transition-colors disabled:opacity-60 ${
              gearDown ? 'bg-emerald-500/20 text-emerald-300' : 'text-zinc-400 hover:text-white'
            }`}
          >
            DOWN
          </button>
        </div>
        {gearJammed && (
          <span className="text-[9px] font-mono text-rose-300/90 animate-pulse">
            {gearDown ? 'ALT EXT' : 'JAMMED'}
          </span>
        )}
        {gearLocked && !gearJammed && (
          <span className="text-[9px] font-mono text-amber-300/90">LOCKED</span>
        )}
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

      {configDrag && (
        <span className="text-[9px] font-mono font-bold text-amber-300/90 uppercase">
          Config drag active
        </span>
      )}
    </div>
  );
}
