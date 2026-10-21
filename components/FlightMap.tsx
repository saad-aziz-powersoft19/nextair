'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  interpolateAlongPath,
  interpolateGreatCirclePoint,
  splitPolylineAtAntimeridian,
} from '@/lib/geodesics';
import { buildNightPolygons, isNightAt } from '@/lib/solar';
import {
  Layers,
  Locate,
  Maximize2,
  Compass,
  Plane,
  Cloud,
  Moon,
  Sun,
  RadioTower,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  X,
} from 'lucide-react';
import { APP_CONFIG } from '@/lib/config';
import {
  TrafficFetchError,
  fetchLiveTraffic,
  type TrafficAircraft,
  type TrafficBounds,
  type TrafficSnapshot,
} from '@/lib/traffic';
import {
  computeTcasAdvisories,
  getTrafficRelativePosition,
  isTcasActive,
  type TcasLevel,
} from '@/lib/tcas';

const FIX_MARKER_COLORS: Record<string, string> = {
  sid: '#fbbf24',
  star: '#fb923c',
  navaid: '#22d3ee',
  oceanic: '#818cf8',
};

const TRAFFIC_REFRESH_MS = 30_000;
const TRAFFIC_ROUTE_REFRESH_MS = 60_000;
const TRAFFIC_ERROR_RETRY_MS = 60_000;
const TRAFFIC_MAX_MARKERS = 200;
const TRAFFIC_MAX_BBOX_AREA = 24;
const TRAFFIC_MAX_SPAN_DEG = 6;
const TRAFFIC_MIN_SPAN_DEG = 0.05;
const TRAFFIC_ROUTE_SPAN_DEG = 4.5;
const FOLLOW_CITY_ZOOM = 9;
const EMERGENCY_SQUAWKS = new Set(['7500', '7600', '7700']);
const OPENSKY_ATTRIBUTION =
  'Live traffic &copy; <a href="https://opensky-network.org" target="_blank" rel="noreferrer">OpenSky Network</a>';

type TrafficStatus = 'off' | 'loading' | 'live' | 'rate-limited' | 'error';
type TrafficScope = 'local' | 'route';
type TrafficFilter = 'all' | 'airborne' | 'conflicts';

const HTML_ESCAPE_CHARS: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPE_CHARS[char]);
}

function createTrafficBounds(
  lat: number,
  lng: number,
  requestedLatSpan: number,
  requestedLngSpan: number
): TrafficBounds {
  let latSpan = requestedLatSpan;
  let lngSpan = requestedLngSpan;

  if (latSpan * lngSpan > TRAFFIC_MAX_BBOX_AREA) {
    const scale = Math.sqrt(TRAFFIC_MAX_BBOX_AREA / (latSpan * lngSpan));
    latSpan *= scale;
    lngSpan *= scale;
  }

  const clampedLat = Math.min(85 - latSpan / 2, Math.max(-85 + latSpan / 2, lat));
  const normalizedLng = ((((lng + 180) % 360) + 360) % 360) - 180;
  const clampedLng = Math.min(180 - lngSpan / 2, Math.max(-180 + lngSpan / 2, normalizedLng));

  return {
    lamin: clampedLat - latSpan / 2,
    lamax: clampedLat + latSpan / 2,
    lomin: clampedLng - lngSpan / 2,
    lomax: clampedLng + lngSpan / 2,
  };
}

function getTrafficBounds(map: L.Map): TrafficBounds {
  const mapBounds = map.getBounds();
  const center = mapBounds.getCenter();
  return createTrafficBounds(
    center.lat,
    center.lng,
    Math.min(
      TRAFFIC_MAX_SPAN_DEG,
      Math.max(TRAFFIC_MIN_SPAN_DEG, mapBounds.getNorth() - mapBounds.getSouth())
    ),
    Math.min(
      TRAFFIC_MAX_SPAN_DEG,
      Math.max(TRAFFIC_MIN_SPAN_DEG, mapBounds.getEast() - mapBounds.getWest())
    )
  );
}

function getRouteTrafficBounds(
  ownship: LiveTelemetry,
  flightPlan: FlightPlan
): TrafficBounds[] {
  const legDestination =
    flightPlan.layover && ownship.legIndex === 1
      ? flightPlan.layover.airport
      : flightPlan.destination;
  const legDistanceKm =
    flightPlan.layover && ownship.legIndex === 1
      ? flightPlan.layover.distanceFromOriginKm
      : flightPlan.totalDistanceKm;
  const traveledKm = Math.min(ownship.distanceTraveledKm, legDistanceKm);
  const remainingKm = Math.max(0, legDistanceKm - traveledKm);
  const fractions = remainingKm < 300 ? [0.5] : [0, 0.5, 1];

  return fractions.map((fraction) => {
    const distanceKm = traveledKm + remainingKm * fraction;
    const point =
      flightPlan.waypoints.length >= 2
        ? interpolateAlongPath(flightPlan.waypoints, distanceKm)
        : interpolateGreatCirclePoint(
            ownship.lat,
            ownship.lng,
            legDestination.lat,
            legDestination.lng,
            fraction
          );
    return createTrafficBounds(
      point.lat,
      point.lng,
      TRAFFIC_ROUTE_SPAN_DEG,
      TRAFFIC_ROUTE_SPAN_DEG
    );
  });
}

function createTrafficIcon(aircraft: TrafficAircraft, tcasLevel?: TcasLevel): L.DivIcon {
  const emergency = EMERGENCY_SQUAWKS.has(aircraft.squawk);
  const color =
    emergency || tcasLevel === 'resolution'
      ? '#fb7185'
      : tcasLevel === 'traffic' || aircraft.onGround
        ? '#fbbf24'
        : '#34d399';
  const glow =
    emergency || tcasLevel === 'resolution'
      ? '0 0 0 3px rgba(244,63,94,0.4), 0 0 14px rgba(244,63,94,0.55)'
      : tcasLevel === 'traffic'
        ? '0 0 0 2px rgba(245,158,11,0.38), 0 0 10px rgba(245,158,11,0.4)'
        : 'none';
  const size = aircraft.onGround ? 14 : 18;

  return L.divIcon({
    className: 'live-traffic-marker',
    html: `
      <div style="width:${size}px;height:${size}px;border-radius:9999px;box-shadow:${glow};transform:rotate(${Math.round(aircraft.heading)}deg);transform-origin:center center;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.85));">
        <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}" stroke="rgba(9,9,11,0.9)" stroke-width="1.1" stroke-linejoin="round">
          <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
        </svg>
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

function createTrafficPopup(aircraft: TrafficAircraft, tcasLevel?: TcasLevel): string {
  const callsign = escapeHtml(aircraft.callsign);
  const icao = escapeHtml(aircraft.icao24.toUpperCase());
  const country = escapeHtml(aircraft.country || 'Unknown origin');
  const altitude = aircraft.onGround ? 'GND' : `${aircraft.altitudeFt.toLocaleString()} ft`;
  const speed = `${aircraft.groundSpeedKts.toLocaleString()} kts`;
  const verticalRate = aircraft.onGround
    ? 'ON GROUND'
    : Math.abs(aircraft.verticalRateFpm) < 100
      ? 'LEVEL'
      : `${aircraft.verticalRateFpm > 0 ? '+' : ''}${aircraft.verticalRateFpm.toLocaleString()} fpm`;
  const emergency = EMERGENCY_SQUAWKS.has(aircraft.squawk)
    ? `<div style="margin-top:2px;color:#be123c;font-weight:700;">EMERGENCY SQUAWK ${escapeHtml(aircraft.squawk)}</div>`
    : '';
  const tcas = tcasLevel
    ? `<div style="margin-top:3px;padding-top:3px;border-top:1px solid #e4e4e7;color:${tcasLevel === 'resolution' ? '#be123c' : '#b45309'};font-weight:700;">TCAS ${tcasLevel === 'resolution' ? 'RESOLUTION ADVISORY' : 'TRAFFIC ADVISORY'}</div>`
    : '';

  return `
    <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.6;color:#18181b;min-width:150px;">
      <div style="font-size:12px;font-weight:700;color:#0e7490;">${callsign} <span style="color:#71717a;font-weight:500;">${icao}</span></div>
      <div style="color:#52525b;">${country}</div>
      <div style="margin-top:3px;">${altitude} · ${speed}</div>
      <div>HDG ${Math.round(aircraft.heading)}° · ${verticalRate}</div>
      ${emergency}
      ${tcas}
    </div>
  `;
}

function renderTraffic(
  aircraft: TrafficAircraft[],
  group: L.FeatureGroup,
  origin: { lat: number; lng: number },
  conflictLevels: Map<string, TcasLevel>,
  onSelect: (icao24: string) => void,
  pinnedIcao: string | null
): void {
  group.clearLayers();

  const sorted = [...aircraft].sort((a, b) => {
    const aLevel = conflictLevels.get(a.icao24);
    const bLevel = conflictLevels.get(b.icao24);
    const levelRank =
      (Number(bLevel === 'resolution') - Number(aLevel === 'resolution')) * 2 +
      (Number(bLevel === 'traffic') - Number(aLevel === 'traffic'));
    if (levelRank !== 0) return levelRank;
    const emergencyRank =
      Number(EMERGENCY_SQUAWKS.has(b.squawk)) -
      Number(EMERGENCY_SQUAWKS.has(a.squawk));
    if (emergencyRank !== 0) return emergencyRank;
    const aDistance = (a.lat - origin.lat) ** 2 + (a.lng - origin.lng) ** 2;
    const bDistance = (b.lat - origin.lat) ** 2 + (b.lng - origin.lng) ** 2;
    return aDistance - bDistance;
  });

  let nearest = sorted.slice(0, TRAFFIC_MAX_MARKERS);
  if (pinnedIcao && !nearest.some((plane) => plane.icao24 === pinnedIcao)) {
    const pinned = sorted.find((plane) => plane.icao24 === pinnedIcao);
    if (pinned) {
      nearest = [...nearest.slice(0, TRAFFIC_MAX_MARKERS - 1), pinned];
    }
  }

  for (const plane of nearest) {
    const level = conflictLevels.get(plane.icao24);
    const marker = L.marker([plane.lat, plane.lng], {
      icon: createTrafficIcon(plane, level),
      zIndexOffset: 200,
      keyboard: false,
    })
      .bindPopup(createTrafficPopup(plane, level), { closeButton: false })
      .addTo(group);
    marker.on('click', () => onSelect(plane.icao24));
  }
}

function formatAltitudeDelta(deltaFt: number): string {
  const rounded = Math.round(deltaFt);
  const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
  return `${sign}${Math.abs(rounded).toLocaleString()}`;
}

function getTrafficStatusLabel(
  status: TrafficStatus,
  updatedAt: number | null,
  scope: TrafficScope
): string {
  switch (status) {
    case 'loading':
      return scope === 'route' ? 'SCANNING ROUTE…' : 'CONNECTING…';
    case 'live':
      return updatedAt
        ? `LIVE · ${new Date(updatedAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
          })}`
        : 'LIVE';
    case 'rate-limited':
      return 'OPENSKY RATE LIMIT — PAUSED';
    case 'error':
      return 'FEED UNAVAILABLE — RETRYING';
    default:
      return 'STANDBY';
  }
}

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
  const dayNightGroupRef = useRef<L.FeatureGroup | null>(null);
  const routeFixesGroupRef = useRef<L.FeatureGroup | null>(null);
  const trafficGroupRef = useRef<L.FeatureGroup | null>(null);
  const trafficSelectionRef = useRef<L.CircleMarker | null>(null);
  const pinnedTrafficRef = useRef<string | null>(null);

  const [mapReady, setMapReady] = useState(false);
  const [activeTileStyle, setActiveTileStyle] = useState<MapTileStyle>('radar');
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [showRangeRing, setShowRangeRing] = useState(false);
  const [showWeatherOverlay, setShowWeatherOverlay] = useState(false);
  const [showDayNight, setShowDayNight] = useState(true);
  const [showRouteFixes, setShowRouteFixes] = useState(true);
  const [showLiveTraffic, setShowLiveTraffic] = useState(false);
  const [trafficStatus, setTrafficStatus] = useState<TrafficStatus>('off');
  const [trafficCredits, setTrafficCredits] = useState<number | null>(null);
  const [trafficUpdatedAt, setTrafficUpdatedAt] = useState<number | null>(null);
  const [trafficScope, setTrafficScope] = useState<TrafficScope>('local');
  const [trafficFilter, setTrafficFilter] = useState<TrafficFilter>('all');
  const [trafficAircraft, setTrafficAircraft] = useState<TrafficAircraft[]>([]);
  const [selectedIcao, setSelectedIcao] = useState<string | null>(null);
  const [trackedIcao, setTrackedIcao] = useState<string | null>(null);
  const weatherLayerRef = useRef<L.TileLayer | null>(null);

  const flownPointsRef = useRef<[number, number][]>([]);
  const lastPanTimeRef = useRef<number>(0);
  const cityZoomAppliedRef = useRef(false);
  const telemetryRef = useRef<LiveTelemetry>(telemetry);

  const tcasActive = isTcasActive(telemetry);
  const tcasStandbyLabel =
    telemetry.altitudeFt < 400
      ? 'TCAS STANDBY · BELOW 400 FT'
      : 'TCAS STANDBY · NOT AIRBORNE';
  const allAdvisories = useMemo(
    () =>
      showLiveTraffic
        ? computeTcasAdvisories(telemetry, trafficAircraft, Number.POSITIVE_INFINITY)
        : [],
    [showLiveTraffic, telemetry, trafficAircraft]
  );
  const liveAdvisories = allAdvisories.slice(0, 3);

  const conflictKey = allAdvisories
    .map((advisory) => `${advisory.aircraft.icao24}:${advisory.level}`)
    .sort()
    .join('|');

  const conflictLevels = useMemo(() => {
    const levels = new Map<string, TcasLevel>();
    for (const entry of conflictKey.split('|')) {
      if (!entry) continue;
      const [icao24, level] = entry.split(':');
      if (!icao24 || (level !== 'traffic' && level !== 'resolution')) continue;
      if (level === 'resolution' || !levels.has(icao24)) {
        levels.set(icao24, level);
      }
    }
    return levels;
  }, [conflictKey]);

  const visibleTraffic = useMemo(() => {
    let filtered = trafficAircraft;

    if (trafficFilter === 'airborne') {
      filtered = filtered.filter((aircraft) => !aircraft.onGround);
    } else if (trafficFilter === 'conflicts') {
      filtered = filtered.filter((aircraft) => conflictLevels.has(aircraft.icao24));
    }

    for (const pinnedIcao of [trackedIcao, selectedIcao]) {
      if (!pinnedIcao || filtered.some((aircraft) => aircraft.icao24 === pinnedIcao)) {
        continue;
      }
      const pinned = trafficAircraft.find(
        (aircraft) => aircraft.icao24 === pinnedIcao
      );
      if (pinned) filtered = [pinned, ...filtered];
    }

    return filtered;
  }, [trafficAircraft, trafficFilter, conflictLevels, trackedIcao, selectedIcao]);

  const selectedAircraft = selectedIcao
    ? trafficAircraft.find((aircraft) => aircraft.icao24 === selectedIcao) ?? null
    : null;
  const selectedAdvisory = selectedIcao
    ? allAdvisories.find((advisory) => advisory.aircraft.icao24 === selectedIcao) ?? null
    : null;
  const selectedPosition = selectedAircraft
    ? getTrafficRelativePosition(telemetry, selectedAircraft)
    : null;
  const primaryAdvisory = liveAdvisories[0] ?? null;

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

    const dayNightPane = map.createPane('dayNightPane');
    dayNightPane.style.zIndex = '350';
    dayNightPane.style.pointerEvents = 'none';

    // Create feature groups in order
    plannedRouteGroupRef.current = L.featureGroup().addTo(map);
    flownRouteGroupRef.current = L.featureGroup().addTo(map);
    markersGroupRef.current = L.featureGroup().addTo(map);
    routeFixesGroupRef.current = L.featureGroup().addTo(map);
    trafficGroupRef.current = L.featureGroup().addTo(map);

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

  // Day / Night terminator overlay, synced to real-world time
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    if (!dayNightGroupRef.current) {
      dayNightGroupRef.current = L.featureGroup().addTo(map);
    }
    const group = dayNightGroupRef.current;

    const updateTerminator = () => {
      group.clearLayers();
      if (!showDayNight) return;

      buildNightPolygons(new Date()).forEach((ring) => {
        L.polygon(ring, {
          pane: 'dayNightPane',
          stroke: false,
          fillColor: '#020617',
          fillOpacity: 0.45,
          interactive: false,
        }).addTo(group);
      });
    };

    updateTerminator();
    const timer = window.setInterval(updateTerminator, 60000);

    return () => {
      window.clearInterval(timer);
    };
  }, [mapReady, showDayNight]);

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

    // Layover refuel stop marker
    const layoverStop = flightPlan.layover;
    if (layoverStop) {
      const stopIcon = L.divIcon({
        className: 'custom-airport-pin',
        html: `
          <div style="display: flex; flex-direction: column; align-items: center; gap: 2px;">
            <div style="background: #f59e0b; border: 2.5px solid #fde68a; color: black; font-weight: 900; font-size: 10px; padding: 2px 7px; border-radius: 9999px; font-family: monospace; box-shadow: 0 4px 14px rgba(0,0,0,0.6);">
              ${layoverStop.airport.code}
            </div>
            <div style="background: rgba(24,24,27,0.95); border: 1px solid #f59e0b; color: #fbbf24; font-weight: 800; font-size: 8px; padding: 1px 5px; border-radius: 4px; font-family: sans-serif; white-space: nowrap;">
              REFUEL STOP
            </div>
          </div>
        `,
        iconSize: [84, 38],
        iconAnchor: [42, 19],
      });

      L.marker([layoverStop.airport.lat, layoverStop.airport.lng], {
        icon: stopIcon,
        zIndexOffset: 180,
      })
        .bindPopup(
          `<div style="padding: 6px; font-size: 12px; color: #fff;">
            <strong style="font-size: 14px; color: #fbbf24;">${layoverStop.airport.code} - ${layoverStop.airport.name}</strong><br/>
            <span>${layoverStop.airport.city}, ${layoverStop.airport.country}</span><br/>
            <span style="color: #f59e0b; font-weight: bold;">Layover · Refuel Stop</span><br/>
            <span style="color: #94a3b8;">Leg 1 ends here — tanks refilled before leg 2</span>
          </div>`
        )
        .addTo(markersGroup || routeGroup);
    }

    // Diversion (alternate) airport marker + dashed alternate leg
    const diversion = flightPlan.fuel?.alternateAirport ?? null;
    if (diversion && diversion.code !== origin.code && diversion.code !== destination.code) {
      const diversionIcon = L.divIcon({
        className: 'custom-airport-pin',
        html: `
          <div style="display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 9999px; background: #7c3aed; border: 2.5px solid #c4b5fd; color: white; font-weight: 900; font-size: 10px; font-family: monospace; box-shadow: 0 4px 14px rgba(0,0,0,0.6);">
            ${diversion.code}
          </div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });

      L.marker([diversion.lat, diversion.lng], { icon: diversionIcon, zIndexOffset: 150 })
        .bindPopup(
          `<div style="padding: 6px; font-size: 12px; color: #fff;">
            <strong style="font-size: 14px; color: #c4b5fd;">${diversion.code} - ${diversion.name}</strong><br/>
            <span>${diversion.city}, ${diversion.country}</span><br/>
            <span style="color: #a78bfa; font-weight: bold;">Diversion Airport</span><br/>
            <span style="color: #94a3b8;">${Math.round(flightPlan.fuel?.alternateDistanceKm ?? 0)} km from ${destination.code}</span>
          </div>`
        )
        .addTo(markersGroup || routeGroup);

      splitPolylineAtAntimeridian([
        [destination.lat, destination.lng],
        [diversion.lat, diversion.lng],
      ]).forEach((seg) => {
        L.polyline(seg, {
          color: '#a78bfa',
          weight: 2,
          opacity: 0.9,
          dashArray: '4, 8',
          smoothFactor: 1,
        }).addTo(routeGroup);
      });
    }

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

    // Top-Of-Descent (TOD) waypoint along the filed route
    const todKm = calculateTopDescentKm(aircraft.cruiseAltitudeFt, destination.elevation);
    const todPt =
      waypoints.length >= 2
        ? interpolateAlongPath(waypoints, Math.max(0, totalDistanceKm - todKm))
        : { lat: origin.lat, lng: origin.lng };

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
    cityZoomAppliedRef.current = false;
    const bounds = L.latLngBounds([
      [origin.lat, origin.lng],
      [destination.lat, destination.lng],
    ]);
    map.fitBounds(bounds, { padding: [80, 80], maxZoom: 8 });
  }, [flightPlan, mapReady]);

  // 3b. Draw navigation fix markers along the planned route
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;
    if (!routeFixesGroupRef.current) {
      routeFixesGroupRef.current = L.featureGroup().addTo(mapInstanceRef.current);
    }
    const group = routeFixesGroupRef.current;
    group.clearLayers();
    if (!showRouteFixes) return;

    flightPlan.waypoints.forEach((waypoint) => {
      if (!waypoint.name || waypoint.type === 'airport') return;
      const color = FIX_MARKER_COLORS[waypoint.type ?? 'navaid'] ?? '#22d3ee';
      L.circleMarker([waypoint.lat, waypoint.lng], {
        radius: 3.5,
        color,
        weight: 1.5,
        fillColor: color,
        fillOpacity: 0.85,
      })
        .bindPopup(
          `<div style="padding: 4px; font-size: 11px; color: #fff;">
            <strong style="color: ${color};">${waypoint.name}</strong><br/>
            <span style="text-transform: uppercase;">${waypoint.type ?? 'fix'}</span><br/>
            <span>${Math.round(waypoint.distanceFromOriginKm)} km from ${flightPlan.origin.code}</span>
          </div>`
        )
        .addTo(group);
    });
  }, [flightPlan, mapReady, showRouteFixes]);

  // Handle Range Ring toggle
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current || !rangeRingRef.current) return;
    if (showRangeRing) {
      rangeRingRef.current.addTo(mapInstanceRef.current);
    } else {
      rangeRingRef.current.remove();
    }
  }, [showRangeRing, mapReady]);

  useEffect(() => {
    telemetryRef.current = telemetry;
  }, [telemetry]);

  useEffect(() => {
    pinnedTrafficRef.current = trackedIcao ?? selectedIcao;
  }, [trackedIcao, selectedIcao]);

  useEffect(() => {
    if (!mapReady || !showLiveTraffic) return;
    const mapInstance = mapInstanceRef.current;
    if (!mapInstance) return;
    const map = mapInstance;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let requestId = 0;
    const refreshMs =
      trafficScope === 'route' ? TRAFFIC_ROUTE_REFRESH_MS : TRAFFIC_REFRESH_MS;

    map.attributionControl.addAttribution(OPENSKY_ATTRIBUTION);

    function schedule(delayMs: number) {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, delayMs);
    }

    async function load() {
      if (cancelled) return;
      if (document.visibilityState === 'hidden') return;

      const currentRequestId = ++requestId;
      controller?.abort();
      const requestController = new AbortController();
      controller = requestController;

      const boundsList =
        trafficScope === 'route'
          ? getRouteTrafficBounds(telemetryRef.current, flightPlan)
          : [getTrafficBounds(map)];

      try {
        const results = await Promise.allSettled(
          boundsList.map((bounds) =>
            fetchLiveTraffic(bounds, requestController.signal)
          )
        );
        if (cancelled || currentRequestId !== requestId) return;

        const fulfilled = results.filter(
          (result): result is PromiseFulfilledResult<TrafficSnapshot> =>
            result.status === 'fulfilled'
        );

        if (fulfilled.length === 0) {
          const rejected =
            results.find(
              (result): result is PromiseRejectedResult =>
                result.status === 'rejected' &&
                result.reason instanceof TrafficFetchError &&
                result.reason.status === 429
            ) ??
            results.find(
              (result): result is PromiseRejectedResult =>
                result.status === 'rejected'
            );
          throw rejected?.reason ?? new Error('Traffic unavailable');
        }

        const merged = new Map<string, TrafficAircraft>();
        for (const result of fulfilled) {
          for (const aircraft of result.value.aircraft) {
            if (!merged.has(aircraft.icao24)) {
              merged.set(aircraft.icao24, aircraft);
            }
          }
        }

        const aircraft = Array.from(merged.values());
        const credits = fulfilled.reduce<number | null>((minimum, result) => {
          const remaining = result.value.remainingCredits;
          if (remaining === null) return minimum;
          return minimum === null ? remaining : Math.min(minimum, remaining);
        }, null);

        setTrafficAircraft(aircraft);
        setTrafficUpdatedAt(Date.now());
        setTrafficCredits(credits);
        setTrafficStatus('live');
        setSelectedIcao((current) =>
          current && !aircraft.some((item) => item.icao24 === current) ? null : current
        );
        setTrackedIcao((current) =>
          current && !aircraft.some((item) => item.icao24 === current) ? null : current
        );
        schedule(refreshMs);
      } catch (error) {
        if (cancelled || currentRequestId !== requestId) return;
        if (error instanceof Error && error.name === 'AbortError') return;

        if (error instanceof TrafficFetchError && error.status === 429) {
          const retrySeconds =
            error.retryAfterSeconds && error.retryAfterSeconds > 0
              ? error.retryAfterSeconds
              : 600;
          if (error.remainingCredits !== null) {
            setTrafficCredits(error.remainingCredits);
          }
          setTrafficStatus('rate-limited');
          schedule(Math.min(retrySeconds, 3600) * 1000);
          return;
        }

        setTrafficStatus('error');
        schedule(TRAFFIC_ERROR_RETRY_MS);
      }
    }

    void load();

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (timer) clearTimeout(timer);
      void load();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (mapInstanceRef.current === map) {
        map.attributionControl.removeAttribution(OPENSKY_ATTRIBUTION);
      }
    };
  }, [
    mapReady,
    showLiveTraffic,
    trafficScope,
    flightPlan,
    telemetry.legIndex,
  ]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapInstanceRef.current;
    const group = trafficGroupRef.current;
    if (!map || !group) return;

    if (!showLiveTraffic) {
      group.clearLayers();
      return;
    }

    renderTraffic(
      visibleTraffic,
      group,
      { lat: telemetryRef.current.lat, lng: telemetryRef.current.lng },
      conflictLevels,
      setSelectedIcao,
      pinnedTrafficRef.current
    );
  }, [mapReady, showLiveTraffic, visibleTraffic, conflictLevels]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    trafficSelectionRef.current?.remove();
    trafficSelectionRef.current = null;

    if (!showLiveTraffic || !selectedAircraft) return;

    const ring = L.circleMarker([selectedAircraft.lat, selectedAircraft.lng], {
      radius: 16,
      color: '#22d3ee',
      weight: 2,
      opacity: 0.9,
      fill: false,
      dashArray: '4 3',
      interactive: false,
    }).addTo(map);

    trafficSelectionRef.current = ring;

    return () => {
      ring.remove();
      if (trafficSelectionRef.current === ring) {
        trafficSelectionRef.current = null;
      }
    };
  }, [mapReady, showLiveTraffic, selectedAircraft]);

  useEffect(() => {
    if (!trackedIcao || !mapReady) return;
    const map = mapInstanceRef.current;
    const target = trafficAircraft.find(
      (aircraft) => aircraft.icao24 === trackedIcao
    );
    if (!map || !target) return;
    map.panTo([target.lat, target.lng], { animate: true, duration: 0.8 });
  }, [trackedIcao, trafficAircraft, mapReady]);

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

    const isAirborne =
      phase !== 'PRE_FLIGHT' &&
      phase !== 'TAXI' &&
      phase !== 'TAXI_TAKEOFF' &&
      phase !== 'ARRIVED';

    if (autoCenter && !trackedIcao && isAirborne && !cityZoomAppliedRef.current) {
      cityZoomAppliedRef.current = true;
      if (map.getZoom() < FOLLOW_CITY_ZOOM) {
        map.setView([lat, lng], FOLLOW_CITY_ZOOM, { animate: false });
      }
    }

    // Auto-center camera throttled (every 250ms) to prevent Leaflet render churn
    const now = performance.now();
    if (
      autoCenter &&
      !trackedIcao &&
      phase !== 'ARRIVED' &&
      now - lastPanTimeRef.current > 250
    ) {
      lastPanTimeRef.current = now;
      map.setView([lat, lng], map.getZoom(), { animate: false });
    }
  }, [telemetry, autoCenter, trackedIcao, mapReady]);

  const handleToggleTraffic = () => {
    if (showLiveTraffic) {
      setShowLiveTraffic(false);
      setTrafficStatus('off');
      setTrafficAircraft([]);
      setTrafficUpdatedAt(null);
      setSelectedIcao(null);
      setTrackedIcao(null);
      trafficGroupRef.current?.clearLayers();
      return;
    }
    setShowLiveTraffic(true);
    setTrafficStatus('loading');
  };

  const handleTrafficScope = (scope: TrafficScope) => {
    if (scope === trafficScope) return;
    setTrafficScope(scope);
    setTrafficAircraft([]);
    setTrafficStatus('loading');
    setSelectedIcao(null);
    setTrackedIcao(null);
    trafficGroupRef.current?.clearLayers();
  };

  const handleFollowOwnship = () => {
    setTrackedIcao(null);
    if (!autoCenter) onToggleAutoCenter();
    const map = mapInstanceRef.current;
    if (map) {
      cityZoomAppliedRef.current = true;
      map.setView(
        [telemetry.lat, telemetry.lng],
        Math.max(map.getZoom(), FOLLOW_CITY_ZOOM),
        { animate: true }
      );
    }
  };

  const trafficStatusLabel = getTrafficStatusLabel(
    trafficStatus,
    trafficUpdatedAt,
    trafficScope
  );

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
            className="flex items-center gap-2 px-3 py-2.5 sm:py-2 bg-zinc-900/95 hover:bg-zinc-800 text-zinc-100 text-xs font-semibold rounded-lg border border-zinc-700/80 shadow-2xl backdrop-blur-md transition-all touch-manipulation"
            title="Change Map Style"
          >
            <Layers className="w-4 h-4 text-cyan-400" />
            <span>{TILE_LAYERS[activeTileStyle].name}</span>
          </button>

          {showLayerMenu && (
            <div className="absolute left-0 mt-1 z-50 w-56 bg-zinc-900/95 border border-zinc-700 rounded-lg shadow-2xl backdrop-blur-lg py-1 text-xs">
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

              {/* Day / Night Terminator Toggle */}
              <button
                onClick={() => setShowDayNight(!showDayNight)}
                className="w-full text-left px-3 py-2 hover:bg-zinc-800 transition-colors flex items-center justify-between text-zinc-300"
              >
                <span className="flex items-center gap-1.5">
                  <Moon className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Day / Night Terminator</span>
                </span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                    showDayNight
                      ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                      : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  {showDayNight ? 'ON' : 'OFF'}
                </span>
              </button>

              {/* Route Waypoint Fixes Toggle */}
              <button
                onClick={() => setShowRouteFixes(!showRouteFixes)}
                className="w-full text-left px-3 py-2 hover:bg-zinc-800 transition-colors flex items-center justify-between text-zinc-300"
              >
                <span className="flex items-center gap-1.5">
                  <RadioTower className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Route Waypoint Fixes</span>
                </span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                    showRouteFixes
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                      : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  {showRouteFixes ? 'ON' : 'OFF'}
                </span>
              </button>

              <button
                onClick={handleToggleTraffic}
                className="w-full text-left px-3 py-2 hover:bg-zinc-800 transition-colors flex items-center justify-between text-zinc-300"
                title="Live aircraft from the OpenSky Network anonymous API"
              >
                <span className="flex items-center gap-1.5">
                  <Plane className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Live Traffic (OpenSky)</span>
                </span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                    showLiveTraffic
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  {showLiveTraffic ? 'ON' : 'OFF'}
                </span>
              </button>

              {showLiveTraffic && (
                <div className="px-3 pb-2 space-y-1.5">
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      onClick={() => handleTrafficScope('local')}
                      className={`px-2 py-1 rounded border font-mono text-[10px] font-bold transition-colors ${
                        trafficScope === 'local'
                          ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                          : 'bg-zinc-800/60 border-zinc-700/60 text-zinc-400 hover:text-zinc-200'
                      }`}
                      title="Current map view · 1 credit · refresh 30 s"
                    >
                      LOCAL
                    </button>
                    <button
                      onClick={() => handleTrafficScope('route')}
                      className={`px-2 py-1 rounded border font-mono text-[10px] font-bold transition-colors ${
                        trafficScope === 'route'
                          ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                          : 'bg-zinc-800/60 border-zinc-700/60 text-zinc-400 hover:text-zinc-200'
                      }`}
                      title="Scan 1–3 sectors along the remaining route · up to 3 credits · refresh 60 s"
                    >
                      ROUTE
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-1">
                    {(
                      [
                        ['all', 'ALL'],
                        ['airborne', 'AIR'],
                        ['conflicts', 'TCAS'],
                      ] as const
                    ).map(([filter, label]) => (
                      <button
                        key={filter}
                        onClick={() => setTrafficFilter(filter)}
                        className={`px-1.5 py-1 rounded border font-mono text-[10px] font-bold transition-colors ${
                          trafficFilter === filter
                            ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                            : 'bg-zinc-800/60 border-zinc-700/60 text-zinc-400 hover:text-zinc-200'
                        }`}
                        title={
                          filter === 'conflicts'
                            ? 'Show only aircraft with a TCAS traffic or resolution advisory'
                            : filter === 'airborne'
                              ? 'Hide aircraft on the ground'
                              : 'Show all live aircraft'
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                    <span
                      className={`whitespace-nowrap ${
                        trafficStatus === 'error' || trafficStatus === 'rate-limited'
                          ? 'text-amber-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {trafficStatusLabel}
                    </span>
                    <span
                      className="text-zinc-500 text-right whitespace-nowrap"
                      title="OpenSky anonymous API credits remaining today"
                    >
                      {trafficStatus === 'live'
                        ? `${trafficAircraft.length} AC`
                        : ''}
                      {trafficCredits !== null
                        ? `${trafficStatus === 'live' ? ' · ' : ''}${trafficCredits} CR`
                        : ''}
                    </span>
                  </div>
                </div>
              )}

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
          onClick={handleFollowOwnship}
          className={`flex items-center gap-2 px-3 py-2.5 sm:py-2 text-xs font-semibold rounded-lg border shadow-xl backdrop-blur-md transition-all touch-manipulation ${
            trackedIcao
              ? 'bg-amber-500/15 border-amber-500/60 text-amber-300'
              : autoCenter
                ? 'bg-cyan-500/20 border-cyan-500/60 text-cyan-300'
                : 'bg-zinc-900/90 hover:bg-zinc-800 border-zinc-700/80 text-zinc-300'
          }`}
          title={
            trackedIcao
              ? 'Stop tracking traffic and return camera to own aircraft at city zoom'
              : 'Center own aircraft and zoom to city detail'
          }
        >
          <Locate
            className={`w-4 h-4 ${
              trackedIcao
                ? 'text-amber-400 animate-pulse'
                : autoCenter
                  ? 'text-cyan-400 animate-pulse'
                  : 'text-zinc-400'
            }`}
          />
          <span>{trackedIcao ? 'Following Traffic' : 'Follow Aircraft'}</span>
        </button>

        {/* Fit Route Bounds */}
        <button
          onClick={handleFitRoute}
          className="flex items-center gap-2 px-3 py-2.5 sm:py-2 bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 text-xs font-semibold rounded-lg border border-zinc-700/80 shadow-xl backdrop-blur-md transition-all touch-manipulation"
          title="View Entire Flight Route"
        >
          <Maximize2 className="w-4 h-4 text-emerald-400" />
          <span>Fit Full Route</span>
        </button>

        {showLiveTraffic && (
          <div
            className={`w-56 rounded-lg border shadow-2xl backdrop-blur-md px-3 py-2 ${
              primaryAdvisory?.level === 'resolution'
                ? 'bg-rose-950/90 border-rose-500/60'
                : primaryAdvisory
                  ? 'bg-amber-950/90 border-amber-500/60'
                  : 'bg-zinc-900/90 border-zinc-700/80'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className={`flex items-center gap-1.5 text-[10px] font-bold tracking-widest ${
                  primaryAdvisory?.level === 'resolution'
                    ? 'text-rose-300'
                    : primaryAdvisory
                      ? 'text-amber-300'
                      : 'text-zinc-400'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                TCAS
              </span>
              <span
                className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold ${
                  primaryAdvisory?.level === 'resolution'
                    ? 'border-rose-500/50 bg-rose-500/20 text-rose-300'
                    : primaryAdvisory
                      ? 'border-amber-500/50 bg-amber-500/20 text-amber-300'
                      : 'border-zinc-700 bg-zinc-800 text-zinc-400'
                }`}
              >
                {primaryAdvisory?.level === 'resolution'
                  ? 'RA'
                  : primaryAdvisory
                    ? 'TA'
                    : !tcasActive
                      ? 'STBY'
                      : trafficStatus === 'live'
                        ? 'CLEAR'
                        : trafficStatus === 'loading'
                          ? 'SCAN'
                          : 'DOWN'}
              </span>
            </div>

            {liveAdvisories.length > 0 ? (
              <div className="mt-1 space-y-0.5">
                {liveAdvisories.map((advisory) => (
                  <button
                    key={`${advisory.aircraft.icao24}-${advisory.level}`}
                    onClick={() => setSelectedIcao(advisory.aircraft.icao24)}
                    className={`flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left transition-colors ${
                      selectedIcao === advisory.aircraft.icao24
                        ? 'bg-white/10'
                        : 'hover:bg-white/5'
                    }`}
                    title={`${advisory.aircraft.callsign || advisory.aircraft.icao24} · ${advisory.rangeNm.toFixed(1)} NM · ${formatAltitudeDelta(advisory.relativeAltitudeFt)} ft`}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      {advisory.level === 'resolution' ? (
                        advisory.command === 'DESCEND' ? (
                          <ArrowDown className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                        ) : (
                          <ArrowUp className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                        )
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                      )}
                      <span className="truncate font-mono text-[11px] font-bold text-white">
                        {advisory.aircraft.callsign ||
                          advisory.aircraft.icao24.toUpperCase()}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end font-mono text-[9px] leading-tight">
                      <span
                        className={
                          advisory.level === 'resolution'
                            ? 'font-bold text-rose-300'
                            : 'font-bold text-amber-300'
                        }
                      >
                        {advisory.level === 'resolution'
                          ? advisory.command
                          : 'TRAFFIC'}
                      </span>
                      <span className="text-zinc-400">
                        {advisory.rangeNm.toFixed(1)} NM ·{' '}
                        {formatAltitudeDelta(advisory.relativeAltitudeFt)} FT
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div
                className={`mt-1 font-mono text-[10px] ${
                  trafficStatus === 'live' ? 'text-emerald-400' : 'text-zinc-500'
                }`}
              >
                {!tcasActive
                  ? tcasStandbyLabel
                  : trafficStatus === 'live'
                    ? `${trafficAircraft.length} LIVE · NO CONFLICTS`
                    : trafficStatus === 'loading'
                      ? 'SCANNING AIRSPACE…'
                      : trafficStatus === 'rate-limited'
                        ? 'OPENSKY LIMIT · TCAS PAUSED'
                        : 'FEED UNAVAILABLE · TCAS PAUSED'}
              </div>
            )}

            {(allAdvisories.length > liveAdvisories.length ||
              trafficScope === 'route') && (
              <div className="mt-1 space-y-0.5 border-t border-white/10 pt-1 font-mono text-[9px] text-zinc-500">
                {allAdvisories.length > liveAdvisories.length && (
                  <div className="text-zinc-400">
                    +{allAdvisories.length - liveAdvisories.length} MORE CONFLICT
                    {allAdvisories.length - liveAdvisories.length === 1 ? '' : 'S'}
                  </div>
                )}
                {trafficScope === 'route' && (
                  <div>
                    ROUTE CORRIDOR ·{' '}
                    {trafficStatus === 'live' ? 'ACTIVE' : 'SCANNING'}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {showLiveTraffic && selectedAircraft && selectedPosition && (
          <div className="w-56 rounded-lg border border-cyan-500/40 bg-zinc-900/95 px-3 py-2 shadow-2xl backdrop-blur-md">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Plane className="w-3.5 h-3.5 shrink-0 text-cyan-400" />
                  <span className="truncate font-mono text-[11px] font-black text-white">
                    {selectedAircraft.callsign ||
                      selectedAircraft.icao24.toUpperCase()}
                  </span>
                  {trackedIcao === selectedAircraft.icao24 && (
                    <span className="shrink-0 rounded border border-amber-500/40 bg-amber-500/15 px-1 py-0.5 font-mono text-[8px] font-bold text-amber-300">
                      TRACKED
                    </span>
                  )}
                </div>
                <div className="truncate font-mono text-[9px] text-zinc-500">
                  {selectedAircraft.icao24.toUpperCase()} ·{' '}
                  {selectedAircraft.country || 'UNKNOWN'}
                </div>
              </div>
              <button
                onClick={() => setSelectedIcao(null)}
                className="shrink-0 rounded p-0.5 text-zinc-500 transition-colors hover:text-zinc-200"
                title="Close traffic details"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[10px]">
              <span className="text-zinc-500">RANGE</span>
              <span className="text-right text-zinc-200">
                {selectedPosition.rangeNm.toFixed(1)} NM
              </span>
              <span className="text-zinc-500">BEARING</span>
              <span className="text-right text-zinc-200">
                {Math.round(selectedPosition.bearingDeg)}°
              </span>
              <span className="text-zinc-500">ALTITUDE</span>
              <span className="text-right text-zinc-200">
                {selectedAircraft.onGround
                  ? 'GND'
                  : `${selectedAircraft.altitudeFt.toLocaleString()} FT`}
              </span>
              <span className="text-zinc-500">REL ALT</span>
              <span
                className={`text-right ${
                  selectedPosition.relativeAltitudeFt >= 0
                    ? 'text-cyan-300'
                    : 'text-amber-300'
                }`}
              >
                {formatAltitudeDelta(selectedPosition.relativeAltitudeFt)} FT
              </span>
              <span className="text-zinc-500">GS</span>
              <span className="text-right text-zinc-200">
                {selectedAircraft.groundSpeedKts.toLocaleString()} KT
              </span>
              <span className="text-zinc-500">V/S</span>
              <span className="text-right text-zinc-200">
                {selectedAircraft.onGround
                  ? 'GND'
                  : `${selectedAircraft.verticalRateFpm > 0 ? '+' : ''}${selectedAircraft.verticalRateFpm.toLocaleString()} FPM`}
              </span>
              {selectedAdvisory && (
                <>
                  <span className="text-zinc-500">TCAS</span>
                  <span
                    className={`text-right font-bold ${
                      selectedAdvisory.level === 'resolution'
                        ? 'text-rose-300'
                        : 'text-amber-300'
                    }`}
                  >
                    {selectedAdvisory.level === 'resolution'
                      ? selectedAdvisory.command
                      : 'TRAFFIC'}
                  </span>
                  <span className="text-zinc-500">CPA</span>
                  <span className="text-right text-zinc-200">
                    {selectedAdvisory.cpaNm.toFixed(1)} NM ·{' '}
                    {Math.max(
                      0,
                      Math.round(selectedAdvisory.timeToCpaSeconds ?? 0)
                    )}{' '}
                    S
                  </span>
                </>
              )}
            </div>

            <button
              onClick={() =>
                setTrackedIcao((current) =>
                  current === selectedAircraft.icao24
                    ? null
                    : selectedAircraft.icao24
                )
              }
              className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded border px-2 py-1.5 text-[10px] font-bold transition-colors ${
                trackedIcao === selectedAircraft.icao24
                  ? 'border-amber-500/50 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
                  : 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25'
              }`}
            >
              {trackedIcao === selectedAircraft.icao24 ? (
                <>
                  <X className="w-3.5 h-3.5" /> STOP TRACKING
                </>
              ) : (
                <>
                  <Locate className="w-3.5 h-3.5" /> TRACK AIRCRAFT
                </>
              )}
            </button>
          </div>
        )}
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
        <span className="text-zinc-500">•</span>
        {isNightAt(telemetry.lat, telemetry.lng, new Date()) ? (
          <span className="flex items-center gap-1 text-indigo-300 font-bold">
            <Moon className="w-3 h-3" />
            NIGHT
          </span>
        ) : (
          <span className="flex items-center gap-1 text-amber-300 font-bold">
            <Sun className="w-3 h-3" />
            DAY
          </span>
        )}
      </div>

      {/* Compass / Heading Card bottom right */}
      <div className="absolute bottom-6 right-6 z-[400] bg-zinc-900/85 backdrop-blur-md border border-zinc-700/80 rounded-xl p-3 shadow-2xl hidden sm:flex items-center gap-3">
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
