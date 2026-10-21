'use client';

import { FlightPlan } from '@/types/flight';
import { ArrowRight } from 'lucide-react';

interface AircraftCardProps {
  flightPlan: FlightPlan;
}

export default function AircraftCard({ flightPlan }: AircraftCardProps) {
  const { aircraft, origin, destination, airline, flightNumber } = flightPlan;

  return (
    <div className="w-[200px] sm:w-[248px] bg-zinc-950/85 backdrop-blur-xl border border-zinc-800/90 rounded-2xl shadow-[0_10px_35px_rgba(0,0,0,0.8)] overflow-hidden animate-in fade-in duration-200">
      <div className="px-3 pt-3 pb-2.5 flex flex-col gap-0.5">
        <div className="text-[11px] font-black text-white truncate">{aircraft.name}</div>
        <div className="flex items-center gap-1.5 text-[9px] font-mono min-w-0">
          {airline && <span className="text-zinc-400 truncate">{airline.name}</span>}
          {flightNumber && (
            <span className="text-emerald-300 font-bold shrink-0">{flightNumber}</span>
          )}
        </div>
        <div className="flex items-center gap-1 text-[9px] font-mono text-zinc-500">
          <span className="font-bold text-zinc-300">{origin.code}</span>
          <ArrowRight className="w-2.5 h-2.5" />
          <span className="font-bold text-zinc-300">{destination.code}</span>
          <span className="ml-auto text-zinc-600">
            FL{Math.round(aircraft.cruiseAltitudeFt / 100)}
          </span>
        </div>
        {flightPlan.layover && (
          <div className="text-[9px] font-mono font-bold text-amber-400/90">
            REFUEL STOP · {flightPlan.layover.airport.code}
          </div>
        )}
      </div>
    </div>
  );
}
