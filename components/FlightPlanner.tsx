'use client';

import React, { useState, useMemo } from 'react';
import { Airport, Aircraft, FlightPlan } from '@/types/flight';
import {
  AIRPORTS,
  getAllCountries,
  getAirportsByCountry,
  getAirportByCode,
} from '@/lib/airports';
import { AIRCRAFT_FLEET } from '@/lib/aircraft';
import {
  calculateDistanceKm,
  generateGreatCircleRoute,
} from '@/lib/geodesics';
import {
  Plane,
  MapPin,
  Compass,
  AlertTriangle,
  CheckCircle,
  Clock,
  Gauge,
  Sparkles,
  ArrowRight,
  ShieldAlert,
  Navigation,
} from 'lucide-react';

import { APP_CONFIG } from '@/lib/config';

interface FlightPlannerProps {
  onStartFlight: (plan: FlightPlan) => void;
}

export default function FlightPlanner({ onStartFlight }: FlightPlannerProps) {
  const initialOrigin = getAirportByCode(APP_CONFIG.defaultOriginCode) || AIRPORTS[0];
  const initialDest = getAirportByCode(APP_CONFIG.defaultDestCode) || AIRPORTS[1];

  const [originCountry, setOriginCountry] = useState<string>(initialOrigin.country);
  const [originAirportCode, setOriginAirportCode] = useState<string>(initialOrigin.code);

  const [destCountry, setDestCountry] = useState<string>(initialDest.country);
  const [destAirportCode, setDestAirportCode] = useState<string>(initialDest.code);

  const [selectedAircraftId, setSelectedAircraftId] = useState<string>(APP_CONFIG.defaultAircraftId);

  const countries = useMemo(() => getAllCountries(), []);

  // Filtered airports by selected countries
  const originAirports = useMemo(() => {
    return getAirportsByCountry(originCountry);
  }, [originCountry]);

  const destAirports = useMemo(() => {
    return getAirportsByCountry(destCountry);
  }, [destCountry]);

  // Current airport objects
  const originAirport = useMemo(() => {
    return (
      originAirports.find((a) => a.code === originAirportCode) ||
      originAirports[0] ||
      AIRPORTS[0]
    );
  }, [originAirportCode, originAirports]);

  const destAirport = useMemo(() => {
    return (
      destAirports.find((a) => a.code === destAirportCode) ||
      destAirports[0] ||
      AIRPORTS[1]
    );
  }, [destAirportCode, destAirports]);

  const selectedAircraft = useMemo(() => {
    return (
      AIRCRAFT_FLEET.find((p) => p.id === selectedAircraftId) ||
      AIRCRAFT_FLEET[0]
    );
  }, [selectedAircraftId]);

  // Calculate real distance & duration based on aircraft speed
  const totalDistanceKm = useMemo(() => {
    if (!originAirport || !destAirport) return 0;
    return calculateDistanceKm(
      originAirport.lat,
      originAirport.lng,
      destAirport.lat,
      destAirport.lng
    );
  }, [originAirport, destAirport]);

  const isRangeExceeded = totalDistanceKm > selectedAircraft.maxRangeKm;
  const isSameAirport = originAirport.code === destAirport.code;

  const estimatedDurationHours = useMemo(() => {
    if (selectedAircraft.cruiseSpeedKmh <= 0) return 0;
    // Add 25 minutes for takeoff/climb and descent/taxi
    return totalDistanceKm / selectedAircraft.cruiseSpeedKmh + 0.42;
  }, [totalDistanceKm, selectedAircraft]);

  const durationHours = Math.floor(estimatedDurationHours);
  const durationMins = Math.round((estimatedDurationHours % 1) * 60);

  // Preset Routes
  const PRESET_ROUTES = [
    {
      name: 'Transatlantic Dreamliner',
      from: 'JFK',
      fromCountry: 'United States',
      to: 'LHR',
      toCountry: 'United Kingdom',
      plane: 'b787-9',
      tag: 'Iconic',
    },
    {
      name: 'Transpacific Crossing',
      from: 'SFO',
      fromCountry: 'United States',
      to: 'HND',
      toCountry: 'Japan',
      plane: 'a350-900',
      tag: 'Ultra Long-Haul',
    },
    {
      name: 'Supersonic Atlantic Dash',
      from: 'LHR',
      fromCountry: 'United Kingdom',
      to: 'JFK',
      toCountry: 'United States',
      plane: 'concorde',
      tag: 'Mach 2.04',
    },
    {
      name: 'European City Hopper',
      from: 'LHR',
      fromCountry: 'United Kingdom',
      to: 'CDG',
      toCountry: 'France',
      plane: 'a320neo',
      tag: 'Short Hop',
    },
    {
      name: 'Middle East Hub',
      from: 'DXB',
      fromCountry: 'United Arab Emirates',
      to: 'SIN',
      toCountry: 'Singapore',
      plane: 'b787-9',
      tag: 'Eastbound',
    },
  ];

  const handleApplyPreset = (preset: (typeof PRESET_ROUTES)[0]) => {
    setOriginCountry(preset.fromCountry);
    setOriginAirportCode(preset.from);
    setDestCountry(preset.toCountry);
    setDestAirportCode(preset.to);
    setSelectedAircraftId(preset.plane);
  };

  const handleLaunchFlight = () => {
    if (isSameAirport || isRangeExceeded) return;

    const waypoints = generateGreatCircleRoute(
      originAirport,
      destAirport,
      selectedAircraft.cruiseAltitudeFt
    );

    const flightPlan: FlightPlan = {
      id: `FL-${Date.now().toString(36).toUpperCase()}`,
      origin: originAirport,
      destination: destAirport,
      aircraft: selectedAircraft,
      totalDistanceKm: Math.round(totalDistanceKm),
      estimatedFlightTimeHours: Math.round(estimatedDurationHours * 10) / 10,
      waypoints,
      departureTime: new Date(),
    };

    onStartFlight(flightPlan);
  };

  return (
    <div className="w-full max-w-5xl mx-auto p-4 sm:p-6 text-zinc-100 flex flex-col gap-6">
      {/* Title & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-cyan-500/20 text-cyan-400">
              <Plane className="w-5 h-5" />
            </span>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              NextAir Flight Dispatch
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            2D Aeronautical Navigation & Physics Simulation Engine
          </p>
        </div>

        {/* Quick Presets */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1 shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" /> Presets:
          </span>
          {PRESET_ROUTES.map((p) => (
            <button
              key={p.name}
              onClick={() => handleApplyPreset(p)}
              className="px-2.5 py-1 bg-zinc-850 hover:bg-zinc-800 border border-zinc-700/80 rounded-lg text-xs font-medium text-zinc-300 hover:text-white shrink-0 transition-all flex items-center gap-1"
            >
              <span>
                {p.from} → {p.to}
              </span>
              <span className="text-[9px] px-1 rounded bg-zinc-800 text-cyan-300">
                {p.tag}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Main Grid: Origin, Destination & Route Specs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Origin Airport Selection */}
        <div className="p-4 bg-zinc-900/90 border border-zinc-800 rounded-2xl shadow-xl flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></div>
              <h2 className="text-sm font-bold text-emerald-400 uppercase tracking-wider">
                Departure Point (Origin)
              </h2>
            </div>
            <span className="text-xs font-mono font-bold text-zinc-400">
              {originAirport.icao}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Country Picker */}
            <div>
              <label className="text-[11px] font-semibold text-zinc-400 block mb-1">
                Country
              </label>
              <select
                value={originCountry}
                onChange={(e) => {
                  const country = e.target.value;
                  setOriginCountry(country);
                  const firstAirport = getAirportsByCountry(country)[0];
                  if (firstAirport) setOriginAirportCode(firstAirport.code);
                }}
                className="w-full bg-zinc-950 border border-zinc-750 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
              >
                {countries.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* Airport Picker */}
            <div>
              <label className="text-[11px] font-semibold text-zinc-400 block mb-1">
                Airport Hub
              </label>
              <select
                value={originAirport.code}
                onChange={(e) => setOriginAirportCode(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-750 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
              >
                {originAirports.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} - {a.city}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Airport Preview Card */}
          <div className="p-3 bg-zinc-950/60 rounded-xl border border-zinc-800 text-xs flex flex-col gap-1">
            <div className="font-bold text-white text-sm">
              {originAirport.name}
            </div>
            <div className="text-zinc-400 text-[11px] flex items-center gap-3">
              <span>City: {originAirport.city}</span>
              <span>•</span>
              <span>Elevation: {originAirport.elevation} ft</span>
              <span>•</span>
              <span>Runway: {originAirport.runwayHeading}°</span>
            </div>
          </div>
        </div>

        {/* Destination Airport Selection */}
        <div className="p-4 bg-zinc-900/90 border border-zinc-800 rounded-2xl shadow-xl flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-rose-400 animate-pulse"></div>
              <h2 className="text-sm font-bold text-rose-400 uppercase tracking-wider">
                Destination Point (Arrival)
              </h2>
            </div>
            <span className="text-xs font-mono font-bold text-zinc-400">
              {destAirport.icao}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Country Picker */}
            <div>
              <label className="text-[11px] font-semibold text-zinc-400 block mb-1">
                Country
              </label>
              <select
                value={destCountry}
                onChange={(e) => {
                  const country = e.target.value;
                  setDestCountry(country);
                  const firstAirport = getAirportsByCountry(country)[0];
                  if (firstAirport) setDestAirportCode(firstAirport.code);
                }}
                className="w-full bg-zinc-950 border border-zinc-750 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
              >
                {countries.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* Airport Picker */}
            <div>
              <label className="text-[11px] font-semibold text-zinc-400 block mb-1">
                Airport Hub
              </label>
              <select
                value={destAirport.code}
                onChange={(e) => setDestAirportCode(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-750 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
              >
                {destAirports.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} - {a.city}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Airport Preview Card */}
          <div className="p-3 bg-zinc-950/60 rounded-xl border border-zinc-800 text-xs flex flex-col gap-1">
            <div className="font-bold text-white text-sm">{destAirport.name}</div>
            <div className="text-zinc-400 text-[11px] flex items-center gap-3">
              <span>City: {destAirport.city}</span>
              <span>•</span>
              <span>Elevation: {destAirport.elevation} ft</span>
              <span>•</span>
              <span>Runway: {destAirport.runwayHeading}°</span>
            </div>
          </div>
        </div>
      </div>

      {/* Aircraft Selection Fleet */}
      <div className="p-5 bg-zinc-900/90 border border-zinc-800 rounded-2xl shadow-xl flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Plane className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              Select Aircraft Fleet & Performance Specs
            </h2>
          </div>
          <span className="text-xs text-zinc-400">
            Speed, range, and ceiling dynamically driven by selected airframe
          </span>
        </div>

        {/* Aircraft Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {AIRCRAFT_FLEET.map((plane) => {
            const isSelected = plane.id === selectedAircraftId;
            const canMakeDistance = totalDistanceKm <= plane.maxRangeKm;

            return (
              <div
                key={plane.id}
                onClick={() => setSelectedAircraftId(plane.id)}
                className={`p-3.5 rounded-xl border cursor-pointer transition-all flex flex-col justify-between gap-2.5 ${
                  isSelected
                    ? 'bg-cyan-950/40 border-cyan-500 ring-2 ring-cyan-500/20 shadow-lg shadow-cyan-950/50'
                    : 'bg-zinc-950/60 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/40'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-bold text-sm text-white flex items-center gap-1.5">
                        <span>{plane.name}</span>
                        {plane.id === 'b787-9' && (
                          <span className="text-[9px] bg-cyan-500 text-black px-1.5 py-0.2 rounded font-extrabold">
                            FLAGSHIP
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-zinc-400 capitalize">
                        {plane.manufacturer} • {plane.type}
                      </div>
                    </div>

                    <div
                      className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 mt-0.5 ${
                        isSelected
                          ? 'border-cyan-400 bg-cyan-400 text-black'
                          : 'border-zinc-600'
                      }`}
                    >
                      {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-black"></div>}
                    </div>
                  </div>

                  <p className="text-[11px] text-zinc-400 line-clamp-2 mt-1.5">
                    {plane.description}
                  </p>
                </div>

                {/* Specs Pill List */}
                <div className="grid grid-cols-3 gap-1 pt-2 border-t border-zinc-800/80 text-[10px]">
                  <div>
                    <span className="text-zinc-500 block">CRUISE</span>
                    <span className="font-mono font-bold text-zinc-200">
                      {plane.cruiseSpeedKmh} km/h
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">MAX RANGE</span>
                    <span
                      className={`font-mono font-bold ${
                        canMakeDistance ? 'text-zinc-200' : 'text-rose-400'
                      }`}
                    >
                      {plane.maxRangeKm.toLocaleString()} km
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">CEILING</span>
                    <span className="font-mono font-bold text-zinc-200">
                      FL{Math.round(plane.cruiseAltitudeFt / 100)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Flight Plan Summary & Validation Bar */}
      <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Distance & Flight Time calculation */}
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <Navigation className="w-4 h-4 text-cyan-400" />
            <div>
              <div className="text-[10px] text-zinc-400 font-medium uppercase">
                Route Distance
              </div>
              <div className="text-lg font-black font-mono text-white">
                {Math.round(totalDistanceKm).toLocaleString()}{' '}
                <span className="text-xs text-zinc-400 font-normal">
                  KM ({Math.round(totalDistanceKm * 0.539957).toLocaleString()} NM)
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-emerald-400" />
            <div>
              <div className="text-[10px] text-zinc-400 font-medium uppercase">
                Est. Flight Time (at {selectedAircraft.cruiseSpeedKmh} km/h)
              </div>
              <div className="text-lg font-black font-mono text-emerald-400">
                {durationHours}h {durationMins}m
              </div>
            </div>
          </div>

          {/* Range Status */}
          <div>
            {isSameAirport ? (
              <div className="flex items-center gap-1.5 text-xs text-rose-400 font-semibold bg-rose-950/40 border border-rose-800 px-3 py-1.5 rounded-lg">
                <AlertTriangle className="w-4 h-4" />
                <span>Origin and Destination cannot be identical!</span>
              </div>
            ) : isRangeExceeded ? (
              <div className="flex items-center gap-1.5 text-xs text-rose-400 font-semibold bg-rose-950/40 border border-rose-800 px-3 py-1.5 rounded-lg">
                <ShieldAlert className="w-4 h-4" />
                <span>
                  Exceeds Range! Max {selectedAircraft.maxRangeKm.toLocaleString()} km
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold bg-emerald-950/40 border border-emerald-800 px-3 py-1.5 rounded-lg">
                <CheckCircle className="w-4 h-4" />
                <span>Within Operational Range</span>
              </div>
            )}
          </div>
        </div>

        {/* Start Flight Button */}
        <button
          onClick={handleLaunchFlight}
          disabled={isSameAirport || isRangeExceeded}
          className={`w-full md:w-auto px-8 py-3.5 rounded-xl font-black text-sm flex items-center justify-center gap-2 transition-all shadow-xl ${
            isSameAirport || isRangeExceeded
              ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700'
              : 'bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-black shadow-cyan-500/25 active:scale-95'
          }`}
        >
          <span>FILE FLIGHT PLAN & BOARD</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
