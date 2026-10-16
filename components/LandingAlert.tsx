'use client';

import React from 'react';
import { Airport, Aircraft, LiveTelemetry } from '@/types/flight';
import { PlaneLanding, AlertTriangle, ArrowDownCircle, CheckCircle2 } from 'lucide-react';

interface LandingAlertProps {
  destination: Airport;
  aircraft: Aircraft;
  telemetry: LiveTelemetry;
  onConfirmLanding: () => void;
  onDismiss: () => void;
}

export default function LandingAlert({
  destination,
  aircraft,
  telemetry,
  onConfirmLanding,
  onDismiss,
}: LandingAlertProps) {
  return (
    <div className="fixed inset-0 z-[1500] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-zinc-900 border-2 border-amber-500/80 rounded-2xl shadow-[0_0_50px_rgba(245,158,11,0.35)] overflow-hidden">
        {/* Header Ribbon */}
        <div className="bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 p-4 text-black flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-black/20 rounded-xl">
              <PlaneLanding className="w-6 h-6 text-black" />
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-black/80">
                Air Traffic Control • Approach Clear
              </div>
              <h3 className="text-lg font-black tracking-tight text-white drop-shadow">
                Initiate Landing Sequence?
              </h3>
            </div>
          </div>
          <AlertTriangle className="w-6 h-6 text-amber-200 animate-pulse" />
        </div>

        {/* Content Body */}
        <div className="p-5 flex flex-col gap-4 text-zinc-200">
          <p className="text-sm text-zinc-300">
            Aircraft has reached the Top of Descent (TOD) waypoint near{' '}
            <strong className="text-white font-bold">{destination.city}</strong> (
            <span className="text-amber-400 font-mono font-bold">{destination.code}</span>
            ). Ready to reduce throttles and begin glideslope descent.
          </p>

          {/* Quick Telemetry Glance */}
          <div className="grid grid-cols-3 gap-2 p-3 bg-zinc-950/70 rounded-xl border border-zinc-800 text-xs">
            <div>
              <div className="text-zinc-500 text-[10px]">CURRENT ALT</div>
              <div className="font-mono font-bold text-cyan-300 text-sm">
                {telemetry.altitudeFt.toLocaleString()} ft
              </div>
            </div>
            <div>
              <div className="text-zinc-500 text-[10px]">DIST TO TOUCHDOWN</div>
              <div className="font-mono font-bold text-amber-300 text-sm">
                {Math.round(telemetry.distanceRemainingKm)} km
              </div>
            </div>
            <div>
              <div className="text-zinc-500 text-[10px]">APPROACH SPEED</div>
              <div className="font-mono font-bold text-emerald-300 text-sm">
                {aircraft.landingSpeedKnots} kts
              </div>
            </div>
          </div>

          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-start gap-2 text-xs text-amber-200">
            <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>
              Destination runway heading is{' '}
              <strong className="text-white font-mono">{destination.runwayHeading}°</strong>.
              Upon confirmation, auto-throttles will decelerate and establish approach descent.
            </span>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              onClick={onDismiss}
              className="px-4 py-2.5 text-xs font-semibold text-zinc-400 hover:text-white transition-colors"
            >
              Hold Level (Standby)
            </button>
            <button
              onClick={onConfirmLanding}
              className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-black font-extrabold text-xs rounded-xl shadow-lg shadow-emerald-500/20 flex items-center gap-2 transition-all transform active:scale-95"
            >
              <ArrowDownCircle className="w-4 h-4" />
              <span>CLEAR FOR LANDING</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

