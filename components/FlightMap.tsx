'use client';

import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  FlightPlan,
  LiveTelemetry,
  MapTileStyle,
} from '@/types/flight';
import {
  calculateTopDescentKm,
} from '@/lib/simulation';
import {
  interpolateGreatCirclePoint,
  splitPolylineAtAntimeridian,
} from '@/lib/geodesics';
import { Layers, Locate, Maximize2, Compass, Eye, Cloud } from 'lucide-react';
import { APP_CONFIG } from '@/lib/config';

interface FlightMapProps {
  flightPlan: FlightPlan;
  telemetry: LiveTelemetry;
  autoCenter: boolean;
  onToggleAutoCenter: () => void;
}

const TILE_LAYERS: Record<
  MapTileStyle,
  { name: string; url: string; attribution: string; maxZoom: number }
> = {
  radar: {
    name: 'Aviation Radar (Dark)',
    url: APP_CONFIG.tileLayers.radarUrl,
    attribution: APP_CONFIG.mapboxToken
      ? '&copy; <a href="https://mapbox.com/">Mapbox</a> &copy; OpenStreetMap'
      : '&copy; OpenStreetMap',
    maxZoom: 19,
  },
  satellite: {
    name: 'Satellite Photoreal (ESRI)',
    url: APP_CONFIG.tileLayers.satelliteUrl,
    attribution: 'Tiles &copy; Esri',
    maxZoom: 18,
  },
  streets: {
    name: 'Navigation Chart (OSM)',
    url: APP_CONFIG.tileLayers.streetsUrl,
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  },
  'mapbox-dark': {
    name: 'Mapbox Dark Navigation',
    url: `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/{z}/{x}/{y}?access_token=${APP_CONFIG.mapboxToken}`,
    attribution: '&copy; Mapbox &copy; OpenStreetMap',
    maxZoom: 19,
  },
  'mapbox-satellite': {
    name: 'Mapbox Satellite HD',
    url: `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/{z}/{x}/{y}?access_token=${APP_CONFIG.mapboxToken}`,
    attribution: '&copy; Mapbox &copy; Maxar',
    maxZoom: 19,
  },
  'maptiler-topo': {
    name: 'MapTiler Aeronautical Topo',
    url: `https://api.maptiler.com/maps/topo-v2/{z}/{x}/{y}.png?key=${APP_CONFIG.maptilerKey}`,
    attribution: '&copy; MapTiler &copy; OpenStreetMap',
    maxZoom: 19,
  },
};

export default function FlightMap({
  flightPlan,
  telemetry,
  autoCenter,
  onToggleAutoCenter,
}: FlightMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);

  // Layer groups
  const plannedRouteGroupRef = useRef<L.FeatureGroup | null>(null);
  const flownRouteGroupRef = useRef<L.FeatureGroup | null>(null);
  const markersGroupRef = useRef<L.FeatureGroup | null>(null);
  const planeMarkerRef = useRef<L.Marker | null>(null);
  const rangeRingRef = useRef<L.Circle | null>(null);

  const [mapReady, setMapReady] = useState(false);
  const [activeTileStyle, setActiveTileStyle] = useState<MapTileStyle>('radar');
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [showRangeRing, setShowRangeRing] = useState(false);
  const [showWeatherOverlay, setShowWeatherOverlay] = useState(false);
  const weatherLayerRef = useRef<L.TileLayer | null>(null);

  const flownPointsRef = useRef<[number, number][]>([]);
  const lastPanTimeRef = useRef<number>(0);
  const lastHeadingRef = useRef<number>(-1);

  // 1. Initialize Map with robust dimension handling and ResizeObserver
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || mapInstanceRef.current) return;

    // Create Leaflet Map
    const map = L.map(container, {
      center: [flightPlan.origin.lat, flightPlan.origin.lng],
      zoom: 4,
      zoomControl: false,
      worldCopyJump: true,
      minZoom: 2,
      maxZoom: 18,
    });

    // Add Tile Layer
    const activeConfig = TILE_LAYERS[activeTileStyle];
    const tileLayer = L.tileLayer(activeConfig.url, {
      attribution: activeConfig.attribution,
      maxZoom: activeConfig.maxZoom,
      subdomains: 'abc',
    }).addTo(map);

    tileLayerRef.current = tileLayer;

    // Create feature groups in order
    plannedRouteGroupRef.current = L.featureGroup().addTo(map);
    flownRouteGroupRef.current = L.featureGroup().addTo(map);
    markersGroupRef.current = L.featureGroup().addTo(map);

    // Zoom controls top right
    L.control
      .zoom({
        position: 'topright',
      })
      .addTo(map);

    mapInstanceRef.current = map;

    // Invalidate size immediately and after layout settles
    const handleResize = () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(container);

    requestAnimationFrame(() => {
      handleResize();
    });
    setTimeout(() => {
      handleResize();
    }, 150);
    setTimeout(() => {
      handleResize();
    }, 500);

    setMapReady(true);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
      setMapReady(false);
    };
  }, []);

  // 2. Switch Tile Layer
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !tileLayerRef.current) return;
    const config = TILE_LAYERS[activeTileStyle];
    tileLayerRef.current.setUrl(config.url);
  }, [activeTileStyle, mapReady]);

  // Handle OpenWeather Live Clouds / Weather Radar Overlay
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    if (showWeatherOverlay && APP_CONFIG.openWeatherApiKey) {
      if (!weatherLayerRef.current) {
        weatherLayerRef.current = L.tileLayer(
          `https://tile.openweathermap.org/map/clouds_new/{z}/{x}/{y}.png?appid=${APP_CONFIG.openWeatherApiKey}`,
          {
            opacity: 0.65,
            maxZoom: 18,
            zIndex: 350,
          }
        );
      }
      weatherLayerRef.current.addTo(map);
    } else if (weatherLayerRef.current) {
      weatherLayerRef.current.remove();
    }
  }, [showWeatherOverlay, mapReady]);

  // 3. Draw Planned Route, Airport Pins, and TOD Marker
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !plannedRouteGroupRef.current) return;
    const map = mapInstanceRef.current;
    const routeGroup = plannedRouteGroupRef.current;
    const markersGroup = markersGroupRef.current;

    routeGroup.clearLayers();
    if (markersGroup) markersGroup.clearLayers();
    flownPointsRef.current = [];

    const { origin, destination, waypoints, aircraft, totalDistanceKm } = flightPlan;

    // Origin airport marker
    const originIcon = L.divIcon({
      className: 'custom-airport-pin',
      html: `
        <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 44px; height: 44px;">
          <div style="position: absolute; inset: -4px; background: rgba(16, 185, 129, 0.3); border-radius: 9999px; animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
          <div style="width: 36px; height: 36px; border-radius: 9999px; background: #059669; border: 2.5px solid #6ee7b7; display: flex; align-items: center; justify-content: center; color: white; font-weight: 900; font-size: 11px; font-family: monospace; box-shadow: 0 4px 14px rgba(0,0,0,0.6); z-index: 10;">
            ${origin.code}
          </div>
        </div>
      `,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });

    L.marker([origin.lat, origin.lng], { icon: originIcon, zIndexOffset: 200 })
      .bindPopup(
        `<div style="padding: 6px; font-size: 12px; color: #fff;">
          <strong style="font-size: 14px; color: #34d399;">${origin.code} - ${origin.name}</strong><br/>
          <span>${origin.city}, ${origin.country}</span><br/>
          <span style="color: #10b981; font-weight: bold;">Origin Airport</span>
        </div>`
      )
      .addTo(markersGroup || routeGroup);

    // Destination airport marker
    const destIcon = L.divIcon({
      className: 'custom-airport-pin',
      html: `
        <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 44px; height: 44px;">
          <div style="position: absolute; inset: -4px; background: rgba(244, 63, 94, 0.3); border-radius: 9999px; animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
          <div style="width: 36px; height: 36px; border-radius: 9999px; background: #e11d48; border: 2.5px solid #fda4af; display: flex; align-items: center; justify-content: center; color: white; font-weight: 900; font-size: 11px; font-family: monospace; box-shadow: 0 4px 14px rgba(0,0,0,0.6); z-index: 10;">
            ${destination.code}
          </div>
        </div>
      `,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });

    L.marker([destination.lat, destination.lng], { icon: destIcon, zIndexOffset: 200 })
      .bindPopup(
        `<div style="padding: 6px; font-size: 12px; color: #fff;">
          <strong style="font-size: 14px; color: #fb7185;">${destination.code} - ${destination.name}</strong><br/>
          <span>${destination.city}, ${destination.country}</span><br/>
          <span style="color: #f43f5e; font-weight: bold;">Destination Airport</span>
        </div>`
      )
      .addTo(markersGroup || routeGroup);

    // Planned Great Circle Route lines
    const rawCoords = waypoints.map((w) => [w.lat, w.lng] as [number, number]);
    const segments = splitPolylineAtAntimeridian(rawCoords);

    segments.forEach((seg) => {
      // Glow underlay
      L.polyline(seg, {
        color: '#0284c7',
        weight: 6,
        opacity: 0.45,
        smoothFactor: 1,
      }).addTo(routeGroup);

      // Main dashed route line
      L.polyline(seg, {
        color: '#38bdf8',
        weight: 2.5,
        opacity: 0.95,
        dashArray: '8, 8',
        smoothFactor: 1,
      }).addTo(routeGroup);
    });

    // Top-Of-Descent (TOD) waypoint
    const todKm = calculateTopDescentKm(aircraft.cruiseAltitudeFt, destination.elevation);
    const todFraction = Math.max(0.2, (totalDistanceKm - todKm) / totalDistanceKm);
    const todPt = interpolateGreatCirclePoint(
      origin.lat,
      origin.lng,
      destination.lat,
      destination.lng,
      todFraction
    );

    const todIcon = L.divIcon({
      className: 'custom-tod-pin',
      html: `
        <div style="background: rgba(245, 158, 11, 0.95); color: black; font-weight: 900; font-size: 10px; padding: 2px 6px; border-radius: 4px; border: 1px solid #fde68a; box-shadow: 0 2px 8px rgba(0,0,0,0.5); font-family: sans-serif; white-space: nowrap;">
          ▼ TOD
        </div>
      `,
      iconSize: [48, 20],
      iconAnchor: [24, 10],
    });

    L.marker([todPt.lat, todPt.lng], { icon: todIcon, zIndexOffset: 150 })
      .bindPopup(
        `<div style="padding: 4px; font-size: 11px; color: #fff;">
          <strong style="color: #fbbf24;">Top of Descent (TOD)</strong><br/>
          <span>${Math.round(todKm)} km from ${destination.code}</span><br/>
          <span>Glideslope descent starts here.</span>
        </div>`
      )
      .addTo(markersGroup || routeGroup);

    // Max Range radius ring around origin
    if (rangeRingRef.current) rangeRingRef.current.remove();
    rangeRingRef.current = L.circle([origin.lat, origin.lng], {
      radius: aircraft.maxRangeKm * 1000,
      color: '#f59e0b',
      weight: 1.5,
      dashArray: '6, 8',
      fillColor: '#f59e0b',
      fillOpacity: 0.03,
    });
    if (showRangeRing) {
      rangeRingRef.current.addTo(map);
    }

    // Fit map bounds to encompass flight path comfortably
    map.invalidateSize();
    const bounds = L.latLngBounds([
      [origin.lat, origin.lng],
      [destination.lat, destination.lng],
    ]);
    map.fitBounds(bounds, { padding: [80, 80], maxZoom: 8 });
  }, [flightPlan, mapReady]);

  // Handle Range Ring toggle
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !rangeRingRef.current) return;
    if (showRangeRing) {
      rangeRingRef.current.addTo(mapInstanceRef.current);
    } else {
      rangeRingRef.current.remove();
    }
  }, [showRangeRing, mapReady]);

  // 4. Update Airplane Position, Orientation & Flown Path
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    const { lat, lng, heading, altitudeFt, phase } = telemetry;

    // Track flown points
    const lastFlown = flownPointsRef.current[flownPointsRef.current.length - 1];
    if (
      !lastFlown ||
      Math.abs(lastFlown[0] - lat) > 0.005 ||
      Math.abs(lastFlown[1] - lng) > 0.005
    ) {
      flownPointsRef.current.push([lat, lng]);

      // Re-draw flown path
      if (flownRouteGroupRef.current) {
        flownRouteGroupRef.current.clearLayers();
        const segments = splitPolylineAtAntimeridian(flownPointsRef.current);
        segments.forEach((seg) => {
          L.polyline(seg, {
            color: '#10b981',
            weight: 3.5,
            opacity: 0.95,
            smoothFactor: 1,
          }).addTo(flownRouteGroupRef.current!);
        });
      }
    }

    // Dynamic 2.5D shadow offset based on altitude
    const altRatio = Math.min(1, Math.max(0, altitudeFt / 40000));
    const shadowOffset = Math.round(altRatio * 16);
    const shadowOpacity = Math.max(0.2, 0.5 - altRatio * 0.15);

    // Airplane SVG
    const planeHtml = `
      <div style="position: relative; width: 56px; height: 56px; display: flex; align-items: center; justify-content: center; pointer-events: none; transform: rotate(${heading}deg); transform-origin: center center;">
        
        <!-- Altitude Shadow -->
        <svg style="position: absolute; transform: translate(${shadowOffset}px, ${shadowOffset}px); opacity: ${shadowOpacity}; filter: blur(${2 + altRatio * 4}px); color: black;" width="44" height="44" viewBox="0 0 24 24" fill="currentColor">
          <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
        </svg>

        <!-- Aircraft Body (Neon Cyan with white highlights) -->
        <svg style="position: relative; z-index: 10; color: #22d3ee; filter: drop-shadow(0 0 10px rgba(34, 211, 238, 0.8));" width="44" height="44" viewBox="0 0 24 24" fill="currentColor">
          <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
        </svg>

        <!-- Port (Left) Red Nav Light -->
        <div style="position: absolute; top: 28px; left: 6px; width: 5px; height: 5px; border-radius: 9999px; background: #ef4444; box-shadow: 0 0 8px red;"></div>
        <!-- Starboard (Right) Green Nav Light -->
        <div style="position: absolute; top: 28px; right: 6px; width: 5px; height: 5px; border-radius: 9999px; background: #10b981; box-shadow: 0 0 8px #10b981;"></div>
        <!-- Tail White Beacon Light -->
        <div style="position: absolute; bottom: 4px; width: 5px; height: 5px; border-radius: 9999px; background: white; box-shadow: 0 0 8px white;"></div>
      </div>
    `;

    const planeIcon = L.divIcon({
      className: 'custom-airplane-marker',
      html: planeHtml,
      iconSize: [56, 56],
      iconAnchor: [28, 28],
    });

    if (!planeMarkerRef.current) {
      planeMarkerRef.current = L.marker([lat, lng], {
        icon: planeIcon,
        zIndexOffset: 1000,
      }).addTo(map);
    } else {
      planeMarkerRef.current.setLatLng([lat, lng]);
      planeMarkerRef.current.setIcon(planeIcon);
    }

    // Auto-center camera throttled (every 250ms) to prevent Leaflet render churn
    const now = performance.now();
    if (autoCenter && phase !== 'ARRIVED' && now - lastPanTimeRef.current > 250) {
      lastPanTimeRef.current = now;
      map.setView([lat, lng], map.getZoom(), { animate: false });
    }
  }, [telemetry, autoCenter, mapReady]);

  // Fit bounds helper
  const handleFitRoute = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    map.invalidateSize();
    const { origin, destination } = flightPlan;
    const bounds = L.latLngBounds([
      [origin.lat, origin.lng],
      [destination.lat, destination.lng],
    ]);
    map.fitBounds(bounds, { padding: [80, 80], maxZoom: 8 });
  };

  return (
    <div className="relative w-full h-full bg-[#050507] overflow-hidden">
      {/* Absolute full-size Leaflet container */}
      <div ref={mapContainerRef} className="absolute inset-0 w-full h-full z-0" />

      {/* Floating Toolbar Top Left */}
      <div className="absolute top-4 left-4 z-[400] flex flex-col gap-2">
        {/* Layer Switcher */}
        <div className="relative">
          <button
            onClick={() => setShowLayerMenu(!showLayerMenu)}
            className="flex items-center gap-2 px-3 py-2 bg-zinc-900/95 hover:bg-zinc-800 text-zinc-100 text-xs font-semibold rounded-lg border border-zinc-700/80 shadow-2xl backdrop-blur-md transition-all"
            title="Change Map Style"
          >
            <Layers className="w-4 h-4 text-cyan-400" />
            <span>{TILE_LAYERS[activeTileStyle].name}</span>
          </button>

          {showLayerMenu && (
            <div className="absolute left-0 mt-1 w-56 bg-zinc-900/95 border border-zinc-700 rounded-lg shadow-2xl backdrop-blur-lg py-1 text-xs">
              {(Object.keys(TILE_LAYERS) as MapTileStyle[])
                .filter((style) => {
                  if (style.startsWith('mapbox-')) return Boolean(APP_CONFIG.mapboxToken);
                  if (style.startsWith('maptiler-')) return Boolean(APP_CONFIG.maptilerKey);
                  return true;
                })
                .map((style) => (
                  <button
                    key={style}
                    onClick={() => {
                      setActiveTileStyle(style);
                      setShowLayerMenu(false);
                    }}
                    className={`w-full text-left px-3 py-2 hover:bg-zinc-800 transition-colors flex items-center justify-between ${
                      activeTileStyle === style
                        ? 'text-cyan-400 font-bold bg-zinc-800/60'
                        : 'text-zinc-300'
                    }`}
                  >
                    <span>{TILE_LAYERS[style].name}</span>
                    {activeTileStyle === style && (
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                    )}
                  </button>
                ))}

              <div className="border-t border-zinc-800 my-1"></div>

              {/* Range Ring Toggle */}
              <button
                onClick={() => setShowRangeRing(!showRangeRing)}
                className="w-full text-left px-3 py-2 hover:bg-zinc-800 transition-colors flex items-center justify-between text-zinc-300"
              >
                <span>Aircraft Range Ring</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                    showRangeRing
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  {showRangeRing ? 'ON' : 'OFF'}
                </span>
              </button>

              {/* OpenWeather Live Clouds Toggle */}
              {APP_CONFIG.openWeatherApiKey && (
                <button
                  onClick={() => setShowWeatherOverlay(!showWeatherOverlay)}
                  className="w-full text-left px-3 py-2 hover:bg-zinc-800 transition-colors flex items-center justify-between text-zinc-300"
                >
                  <span className="flex items-center gap-1.5">
                    <Cloud className="w-3.5 h-3.5 text-blue-400" />
                    <span>Live Clouds (Radar)</span>
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                      showWeatherOverlay
                        ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                        : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {showWeatherOverlay ? 'ON' : 'OFF'}
                  </span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Center / Follow Aircraft Toggle */}
        <button
          onClick={onToggleAutoCenter}
          className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border shadow-xl backdrop-blur-md transition-all ${
            autoCenter
              ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-300'
              : 'bg-zinc-900/90 hover:bg-zinc-800 border-zinc-700/80 text-zinc-300'
          }`}
          title="Toggle Auto Center on Aircraft"
        >
          <Locate
            className={`w-4 h-4 ${
              autoCenter ? 'text-cyan-400 animate-pulse' : 'text-zinc-400'
            }`}
          />
          <span>Follow Aircraft</span>
        </button>

        {/* Fit Route Bounds */}
        <button
          onClick={handleFitRoute}
          className="flex items-center gap-2 px-3 py-2 bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 text-xs font-semibold rounded-lg border border-zinc-700/80 shadow-xl backdrop-blur-md transition-all"
          title="View Entire Flight Route"
        >
          <Maximize2 className="w-4 h-4 text-emerald-400" />
          <span>Fit Full Route</span>
        </button>
      </div>

      {/* Floating Telemetry Coordinates Bar Top Right */}
      <div className="absolute top-4 right-16 z-[400] hidden sm:flex items-center gap-2 bg-zinc-900/85 backdrop-blur-md border border-zinc-700/80 rounded-lg px-3 py-1.5 text-[11px] font-mono text-zinc-300 shadow-xl">
        <span className="text-zinc-500">POS:</span>
        <span className="text-cyan-300 font-bold">
          {telemetry.lat >= 0 ? `${telemetry.lat.toFixed(2)}°N` : `${Math.abs(telemetry.lat).toFixed(2)}°S`}
        </span>
        <span className="text-zinc-500">,</span>
        <span className="text-cyan-300 font-bold">
          {telemetry.lng >= 0 ? `${telemetry.lng.toFixed(2)}°E` : `${Math.abs(telemetry.lng).toFixed(2)}°W`}
        </span>
      </div>

      {/* Compass / Heading Card bottom right */}
      <div className="absolute bottom-6 right-6 z-[400] bg-zinc-900/85 backdrop-blur-md border border-zinc-700/80 rounded-xl p-3 shadow-2xl flex items-center gap-3">
        <div className="relative w-10 h-10 rounded-full border-2 border-zinc-600 bg-zinc-950 flex items-center justify-center">
          <div
            className="w-1 h-6 bg-gradient-to-t from-zinc-600 via-rose-500 to-rose-400 rounded-full transition-transform duration-200"
            style={{ transform: `rotate(${telemetry.heading}deg)` }}
          />
          <span className="absolute -top-1.5 text-[8px] font-black text-rose-400">N</span>
        </div>
        <div className="text-left">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium">
            HEADING (HDG)
          </div>
          <div className="text-base font-black text-white font-mono flex items-center gap-1">
            <span>{String(telemetry.heading).padStart(3, '0')}°</span>
            <Compass className="w-3.5 h-3.5 text-cyan-400" />
          </div>
        </div>
      </div>
    </div>
  );
}
