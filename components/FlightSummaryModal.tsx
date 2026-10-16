'use client';

import React from 'react';
import { FlightPlan, LiveTelemetry } from '@/types/flight';
import { Award, CheckCircle2, Plane, Clock, Navigation, Gauge, ArrowRight } from 'lucide-react';

interface FlightSummaryModalProps {
  flightPlan: FlightPlan;
  telemetry: LiveTelemetry;
  onPlanNewFlight: () => void;
  onReplayFlight: () => void;
}

export default function FlightSummaryModal({
  flightPlan,
  telemetry,
  onPlanNewFlight,
  onReplayFlight,
}: FlightSummaryModalProps) {
  const { origin, destination, aircraft, totalDistanceKm } = flightPlan;

  const hours = Math.floor(telemetry.elapsedSimSeconds / 3600);
  const minutes = Math.floor((telemetry.elapsedSimSeconds % 3600) / 60);

  const avgSpeedKmh =
    telemetry.elapsedSimSeconds > 0
      ? Math.round((totalDistanceKm / telemetry.elapsedSimSeconds) * 3600)
      : aircraft.cruiseSpeedKmh;

  return (
    <div className="fixed inset-0 z-[1600] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-300">
      <div className="w-full max-w-lg bg-zinc-900 border border-emerald-500/50 rounded-2xl shadow-[0_0_60px_rgba(16,185,129,0.3)] overflow-hidden">
        {/* Banner */}
        <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 p-6 text-white text-center relative overflow-hidden">
          <div className="absolute top-2 right-2 opacity-10">
            <Plane className="w-36 h-36" />
          </div>

          <div className="inline-flex p-3 rounded-full bg-white/20 backdrop-blur-md mb-2">
            <Award className="w-8 h-8 text-amber-300" />
          </div>
          <h2 className="text-2xl font-black tracking-tight">FLIGHT COMPLETED</h2>
          <p className="text-xs text-white/80 font-medium mt-1">
            Safe touchdown and rollout at {destination.name} ({destination.code})
          </p>
        </div>

        {/* Flight Route Badges */}
        <div className="p-6 flex flex-col gap-5 text-zinc-100">
          <div className="flex items-center justify-between p-4 bg-zinc-950/80 rounded-xl border border-zinc-800">
            <div className="text-left">
              <div className="text-[10px] text-zinc-400 font-bold uppercase">DEPARTURE</div>
              <div className="text-2xl font-black text-emerald-400 font-mono">{origin.code}</div>
              <div className="text-xs text-zinc-400">{origin.city}, {origin.country}</div>
            </div>

            <div className="flex flex-col items-center px-4">
              <span className="text-[10px] font-mono text-zinc-400">
                {Math.round(totalDistanceKm).toLocaleString()} KM
              </span>
              <div className="flex items-center gap-1 my-1">
                <div className="w-8 h-0.5 bg-emerald-500"></div>
                <Plane className="w-4 h-4 text-cyan-400 rotate-90" />
                <div className="w-8 h-0.5 bg-cyan-500"></div>
              </div>
              <span className="text-[10px] text-zinc-400">{aircraft.name}</span>
            </div>

            <div className="text-right">
              <div className="text-[10px] text-zinc-400 font-bold uppercase">ARRIVAL</div>
              <div className="text-2xl font-black text-cyan-400 font-mono">{destination.code}</div>
              <div className="text-xs text-zinc-400">{destination.city}, {destination.country}</div>
            </div>
          </div>

          {/* Statistics Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-zinc-950/60 rounded-xl border border-zinc-800 flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-400">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <div className="text-[10px] text-zinc-500 font-medium">SIM FLIGHT TIME</div>
                <div className="text-sm font-black font-mono text-white">
                  {hours}h {minutes}m
                </div>
              </div>
            </div>

            <div className="p-3 bg-zinc-950/60 rounded-xl border border-zinc-800 flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-400">
                <Navigation className="w-5 h-5" />
              </div>
              <div>
                <div className="text-[10px] text-zinc-500 font-medium">TOTAL DISTANCE</div>
                <div className="text-sm font-black font-mono text-white">
                  {Math.round(totalDistanceKm * 0.539957).toLocaleString()} NM
                </div>
              </div>
            </div>

            <div className="p-3 bg-zinc-950/60 rounded-xl border border-zinc-800 flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-400">
                <Gauge className="w-5 h-5" />
              </div>
              <div>
                <div className="text-[10px] text-zinc-500 font-medium">AVERAGE SPEED</div>
                <div className="text-sm font-black font-mono text-white">
                  {avgSpeedKmh} km/h
                </div>
              </div>
            </div>

            <div className="p-3 bg-zinc-950/60 rounded-xl border border-zinc-800 flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-purple-500/10 text-purple-400">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <div className="text-[10px] text-zinc-500 font-medium">CRUISE CEILING</div>
                <div className="text-sm font-black font-mono text-white">
                  {aircraft.cruiseAltitudeFt.toLocaleString()} FT
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={onReplayFlight}
              className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold rounded-xl border border-zinc-700 transition-colors"
            >
              Replay Route
            </button>
            <button
              onClick={onPlanNewFlight}
              className="flex-1 py-3 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-black font-extrabold text-xs rounded-xl shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 transition-all"
            >
              <span>Plan Next Flight</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

