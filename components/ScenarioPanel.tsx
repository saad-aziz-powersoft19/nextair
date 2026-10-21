'use client';

import React from 'react';
import { LiveTelemetry } from '@/types/flight';
import {
  ScenarioId,
  ScenarioMode,
  ScenarioSession,
} from '@/types/scenario';
import {
  SCENARIO_DEFINITIONS,
  canStartScenario,
  evaluateScenario,
  getScenarioDefinition,
  getScenarioElapsedSeconds,
} from '@/lib/scenarios';
import {
  AlertTriangle,
  CheckCircle2,
  CheckSquare,
  Cloud,
  Gauge,
  Plane,
  Play,
  Square,
  Wrench,
  X,
} from 'lucide-react';

interface ScenarioLauncherProps {
  open: boolean;
  telemetry: LiveTelemetry;
  onClose: () => void;
  onStart: (id: ScenarioId, mode: ScenarioMode) => void;
}

interface ScenarioPanelProps {
  scenario: ScenarioSession;
  telemetry: LiveTelemetry;
  onStep: (stepId: string) => void;
  onEnd: () => void;
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function ScenarioIcon({
  scenarioId,
  className,
}: {
  scenarioId: ScenarioId;
  className: string;
}) {
  if (scenarioId === 'ENGINE_FAILURE') {
    return <Plane className={className} />;
  }
  if (scenarioId === 'GEAR_JAM') {
    return <Wrench className={className} />;
  }
  return <Cloud className={className} />;
}

export function ScenarioLauncher({
  open,
  telemetry,
  onClose,
  onStart,
}: ScenarioLauncherProps) {
  if (!open) return null;

  const airborne = canStartScenario(telemetry.phase);

  return (
    <div className="fixed inset-0 z-[1600] flex items-center justify-center p-3 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-4xl max-h-[90dvh] overflow-y-auto bg-zinc-950 border border-amber-500/40 rounded-2xl shadow-[0_0_60px_rgba(245,158,11,0.2)]">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 p-4 bg-gradient-to-r from-amber-950/95 via-zinc-950/95 to-zinc-950/95 border-b border-zinc-800 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-300">
              <Gauge className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-black text-white uppercase tracking-wider">
                Instructor Station
              </h2>
              <p className="text-[11px] text-zinc-400">
                Inject an airborne emergency or launch a scored checkride.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-700 transition-colors"
            title="Close instructor station"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-4">
          {!airborne && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-amber-950/40 border border-amber-700/60 text-[11px] text-amber-200">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                Scenarios are available in climb, cruise, approach-ready, or descent.
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {SCENARIO_DEFINITIONS.map((definition) => (
              <div
                key={definition.id}
                className="flex flex-col gap-3 p-3.5 rounded-xl bg-zinc-900/80 border border-zinc-800 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-start gap-2.5">
                  <div className="p-2 rounded-lg bg-rose-500/10 text-rose-300 border border-rose-500/30 shrink-0">
                    <ScenarioIcon scenarioId={definition.id} className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-black text-white uppercase tracking-wide">
                      {definition.title}
                    </div>
                    <div className="text-[10px] font-mono text-amber-300">
                      {definition.subtitle}
                    </div>
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-zinc-400 flex-1">
                  {definition.description}
                </p>
                <div className="flex items-center justify-between text-[9px] font-mono text-zinc-500">
                  <span>{definition.steps.length} checklist actions</span>
                  <span>Live response drill</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => onStart(definition.id, 'TRAINING')}
                    disabled={!airborne}
                    className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-300 text-[10px] font-bold uppercase transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Train
                  </button>
                  <button
                    onClick={() => onStart(definition.id, 'CHECKRIDE')}
                    disabled={!airborne}
                    className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-[10px] font-bold uppercase transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Gauge className="w-3.5 h-3.5" />
                    Checkride
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="text-[10px] text-zinc-500 text-center">
            Training drills are unscored. Checkrides score checklist completion, response
            time, aircraft configuration, and landing safety.
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ScenarioPanel({
  scenario,
  telemetry,
  onStep,
  onEnd,
}: ScenarioPanelProps) {
  const definition = getScenarioDefinition(scenario.scenarioId);
  const completedStepIds = scenario.completedStepIds;
  const completedCount = definition.steps.filter((step) =>
    completedStepIds.includes(step.id)
  ).length;
  const allComplete = completedCount === definition.steps.length;
  const nextStep = definition.steps.find(
    (step) => !completedStepIds.includes(step.id)
  );
  const result =
    allComplete && scenario.mode === 'CHECKRIDE'
      ? evaluateScenario(scenario, telemetry, false)
      : null;
  const elapsed = getScenarioElapsedSeconds(
    scenario,
    telemetry.elapsedSimSeconds
  );
  const engineFailures = (telemetry.engines ?? []).filter(
    (engine) => engine.state === 'FAILED'
  ).length;
  const gearJammed = scenario.scenarioId === 'GEAR_JAM';
  const cabinAltitude = telemetry.cabinAltitudeFt ?? 8000;

  return (
    <div className="flex flex-col gap-2.5 p-3 rounded-xl bg-rose-950/20 border border-rose-700/60">
      <div className="flex flex-wrap items-center gap-2">
        <div className="p-2 rounded-lg bg-rose-500/15 text-rose-300 border border-rose-500/40">
          <ScenarioIcon scenarioId={scenario.scenarioId} className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-black text-white uppercase tracking-wider">
              {definition.title}
            </span>
            <span
              className={`px-1.5 py-0.5 rounded border text-[8px] font-black uppercase tracking-wider ${
                scenario.mode === 'CHECKRIDE'
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                  : 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
              }`}
            >
              {scenario.mode === 'CHECKRIDE' ? 'Checkride' : 'Training'}
            </span>
            {allComplete && (
              <span className="px-1.5 py-0.5 rounded border text-[8px] font-black uppercase tracking-wider bg-emerald-500/15 border-emerald-500/40 text-emerald-300">
                Complete
              </span>
            )}
          </div>
          <div className="text-[10px] font-mono text-rose-200/80">
            {definition.subtitle} · ELAPSED {formatDuration(elapsed)}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {scenario.scenarioId === 'ENGINE_FAILURE' && engineFailures > 0 && (
            <span className="px-2 py-1 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-300 text-[9px] font-mono font-bold">
              {engineFailures > 1 ? `${engineFailures} ENG FAILED` : 'ENG FAILED'}
            </span>
          )}
          {gearJammed && (
            <span
              className={`px-2 py-1 rounded-lg border text-[9px] font-mono font-bold ${
                telemetry.gearDown
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-500/15 border-rose-500/40 text-rose-300 animate-pulse'
              }`}
            >
              {telemetry.gearDown ? 'GEAR ALT EXT' : 'GEAR JAMMED'}
            </span>
          )}
          {scenario.scenarioId === 'DEPRESSURIZATION' && (
            <span
              className={`px-2 py-1 rounded-lg border text-[9px] font-mono font-bold ${
                cabinAltitude > 10000
                  ? 'bg-rose-500/15 border-rose-500/40 text-rose-300 animate-pulse'
                  : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
              }`}
            >
              CABIN {cabinAltitude.toLocaleString()} FT
            </span>
          )}
          <button
            onClick={onEnd}
            className="px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 text-[10px] font-semibold transition-colors"
          >
            End Drill
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-zinc-950 rounded-full overflow-hidden border border-zinc-800">
          <div
            className="h-full bg-gradient-to-r from-rose-500 to-amber-400 transition-all"
            style={{
              width: `${(completedCount / definition.steps.length) * 100}%`,
            }}
          />
        </div>
        <span className="text-[9px] font-mono text-zinc-400">
          {completedCount}/{definition.steps.length}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {definition.steps.map((step) => {
          const done = completedStepIds.includes(step.id);
          const isNext = nextStep?.id === step.id;
          const waitingForLevelOff =
            step.id === 'levelOff' && telemetry.altitudeFt > 11000;
          const disabled = done || !isNext || waitingForLevelOff;
          return (
            <button
              key={step.id}
              onClick={() => onStep(step.id)}
              disabled={disabled}
              className={`flex items-start gap-2 p-2 rounded-lg border text-left transition-colors ${
                done
                  ? 'bg-emerald-950/25 border-emerald-800/50 text-emerald-300'
                  : isNext && !waitingForLevelOff
                  ? 'bg-zinc-950/60 border-amber-600/50 text-zinc-200 hover:bg-zinc-900'
                  : 'bg-zinc-950/30 border-zinc-800 text-zinc-500'
              } ${waitingForLevelOff ? 'cursor-wait' : disabled ? 'cursor-default' : ''}`}
            >
              {done ? (
                <CheckSquare className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              ) : (
                <Square className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              )}
              <span className="min-w-0">
                <span className="block text-[10px] font-bold uppercase tracking-wide">
                  {step.label}
                </span>
                <span className="block text-[9px] font-mono leading-snug normal-case text-zinc-400">
                  {waitingForLevelOff
                    ? 'Wait until level at 10,000 ft.'
                    : step.detail}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {result && (
        <div
          className={`flex flex-col gap-1.5 p-2.5 rounded-xl border ${
            result.passed
              ? 'bg-emerald-950/30 border-emerald-700/60'
              : 'bg-amber-950/30 border-amber-700/60'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-white">
              <CheckCircle2
                className={`w-4 h-4 ${
                  result.passed ? 'text-emerald-400' : 'text-amber-400'
                }`}
              />
              {result.passed ? 'Checkride Passed' : 'Checkride Review'}
            </span>
            <span className="text-sm font-black font-mono text-white">
              {result.score}/100
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
            {result.objectives.map((objective) => (
              <div
                key={objective.id}
                className={`flex items-center gap-1.5 text-[9px] font-mono ${
                  objective.met ? 'text-emerald-300' : 'text-rose-300'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
                <span>{objective.label}</span>
              </div>
            ))}
          </div>
          <div className="text-[9px] text-zinc-500">
            Landing safety is scored again in the final flight debrief.
          </div>
        </div>
      )}
    </div>
  );
}
