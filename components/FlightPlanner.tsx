'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  FlightPlan,
  FlightWaypoint,
  FlightWaypointType,
  LayoverStop,
} from '@/types/flight';
import {
  AIRPORTS,
  getAllCountries,
  getAirportsByCountry,
  getAirportByCode,
} from '@/lib/airports';
import { AIRCRAFT_FLEET } from '@/lib/aircraft';
import { calculateDistanceKm } from '@/lib/geodesics';
import { buildRoute, buildRouteFromTokens, BuiltRoute } from '@/lib/routing';
import { normalizeRouteTokens, parseFlightPlanText } from '@/lib/flightPlanImport';
import {
  FINAL_RESERVE_MINUTES,
  TIGHT_FUEL_RATIO,
  calculateFuelLimitedRangeKm,
  computeFuelPlan,
  findBestLayoverAttempt,
  findLayoverOptions,
  getTankFillRatio,
  isFuelFeasible,
  pickDiversionAirport,
} from '@/lib/fuel';
import {
  Plane,
  AlertTriangle,
  CheckCircle,
  Clock,
  Sparkles,
  ArrowRight,
  ShieldAlert,
  Navigation,
  Route,
  Fuel,
  PlusCircle,
  X,
  Upload,
  RotateCcw,
  Pencil,
} from 'lucide-react';

import { APP_CONFIG } from '@/lib/config';

const FIX_TYPE_STYLES: Record<FlightWaypointType, string> = {
  airport: 'bg-emerald-950/70 border-emerald-700/70 text-emerald-200',
  sid: 'bg-amber-950/70 border-amber-700/70 text-amber-200',
  star: 'bg-orange-950/70 border-orange-700/70 text-orange-200',
  navaid: 'bg-cyan-950/60 border-cyan-800/70 text-cyan-200',
  oceanic: 'bg-indigo-950/70 border-indigo-700/70 text-indigo-200',
};

const AIRCRAFT_IMPORT_ALIASES: Record<string, string> = {
  B787: 'b787-9',
  B788: 'b787-9',
  B789: 'b787-9',
  B78X: 'b787-9',
  '787': 'b787-9',
  '7879': 'b787-9',
  '7878': 'b787-9',
  A350: 'a350-900',
  A359: 'a350-900',
  A35K: 'a350-900',
  '350': 'a350-900',
  '350900': 'a350-900',
  B777: 'b777-300er',
  B773: 'b777-300er',
  B77W: 'b777-300er',
  '777': 'b777-300er',
  '777300ER': 'b777-300er',
  '777300': 'b777-300er',
  B737: 'b737-800',
  B738: 'b737-800',
  '737': 'b737-800',
  '737800': 'b737-800',
  A320: 'a320neo',
  A20N: 'a320neo',
  '320': 'a320neo',
  A320NEO: 'a320neo',
  CONC: 'concorde',
  CONCORDE: 'concorde',
  SST: 'concorde',
  C172: 'c172',
  CESSNA172: 'c172',
  '172': 'c172',
  '172S': 'c172',
};

function findAircraftIdForType(type: string | null): string | null {
  if (!type) return null;
  const normalized = type.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return AIRCRAFT_IMPORT_ALIASES[normalized] ?? null;
}

interface CustomRouteSpec {
  tokens: string[];
  altitudeOverrideFt: number | null;
  flightNumber: string | null;
}

interface BuiltCustomRouteState {
  key: string;
  route: BuiltRoute;
  unresolved: string[];
  airways: string[];
  resolvedFixCount: number;
}

function mergeLayoverRoute(
  leg1: BuiltRoute,
  leg2: BuiltRoute
): { route: BuiltRoute; leg1DistanceKm: number } {
  const leg1DistanceKm = leg1.totalDistanceKm;
  const waypoints: FlightWaypoint[] = [
    ...leg1.waypoints,
    ...leg2.waypoints.slice(1).map((waypoint) => ({
      ...waypoint,
      distanceFromOriginKm: waypoint.distanceFromOriginKm + leg1DistanceKm,
    })),
  ];

  return {
    route: {
      waypoints,
      totalDistanceKm: leg1DistanceKm + leg2.totalDistanceKm,
      airline: null,
      flightNumber: null,
      isRealWorldRoute: false,
      enrouteFixCount: leg1.enrouteFixCount + leg2.enrouteFixCount,
      oceanicFixCount: leg1.oceanicFixCount + leg2.oceanicFixCount,
    },
    leg1DistanceKm,
  };
}

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
  const [builtRoute, setBuiltRoute] = useState<{ key: string; route: BuiltRoute } | null>(null);
  const [customRouteSpec, setCustomRouteSpec] = useState<CustomRouteSpec | null>(null);
  const [builtCustomRoute, setBuiltCustomRoute] = useState<BuiltCustomRouteState | null>(null);
  const [routeEditorOpen, setRouteEditorOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [routeFixInput, setRouteFixInput] = useState('');
  const [routeMessage, setRouteMessage] = useState<string | null>(null);
  const [layoverChoice, setLayoverChoice] = useState<{
    key: string | null;
    code: string | null;
  }>({ key: null, code: null });
  const [builtLayoverRoute, setBuiltLayoverRoute] = useState<{
    key: string;
    route: BuiltRoute;
    leg1DistanceKm: number;
  } | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);

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

  const planAircraft = useMemo(() => {
    const altitudeOverrideFt = customRouteSpec?.altitudeOverrideFt;
    if (!altitudeOverrideFt || altitudeOverrideFt === selectedAircraft.cruiseAltitudeFt) {
      return selectedAircraft;
    }
    return { ...selectedAircraft, cruiseAltitudeFt: altitudeOverrideFt };
  }, [selectedAircraft, customRouteSpec?.altitudeOverrideFt]);

  const isSameAirport = originAirport.code === destAirport.code;
  const routeKey = isSameAirport
    ? null
    : `${originAirport.code}-${destAirport.code}-${selectedAircraft.id}`;
  const customRouteKey =
    customRouteSpec && routeKey
      ? `${routeKey}-CUSTOM-${customRouteSpec.altitudeOverrideFt ?? 'STD'}-${
          customRouteSpec.flightNumber ?? 'NOFLT'
        }-${customRouteSpec.tokens.join('-')}`
      : null;

  // Build the filed navigation route asynchronously (navaid corridor + oceanic waypoints)
  useEffect(() => {
    if (!routeKey) return;
    let cancelled = false;
    buildRoute(originAirport, destAirport, selectedAircraft.cruiseAltitudeFt)
      .then((route) => {
        if (!cancelled) setBuiltRoute({ key: routeKey, route });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [originAirport, destAirport, selectedAircraft, routeKey]);

  const directRoute = builtRoute && builtRoute.key === routeKey ? builtRoute.route : null;

  useEffect(() => {
    if (!customRouteKey || !customRouteSpec || !routeKey) return;
    let cancelled = false;
    buildRouteFromTokens(
      customRouteSpec.tokens,
      originAirport,
      destAirport,
      planAircraft.cruiseAltitudeFt,
      { flightNumber: customRouteSpec.flightNumber }
    )
      .then((result) => {
        if (!cancelled) setBuiltCustomRoute({ key: customRouteKey, ...result });
      })
      .catch(() => {
        if (!cancelled) setRouteMessage('Unable to build the custom route.');
      });
    return () => {
      cancelled = true;
    };
  }, [
    customRouteKey,
    customRouteSpec,
    routeKey,
    originAirport,
    destAirport,
    planAircraft.cruiseAltitudeFt,
  ]);

  const activeCustomRoute =
    customRouteSpec && customRouteKey && builtCustomRoute?.key === customRouteKey
      ? builtCustomRoute
      : null;
  const customRouteActive = Boolean(customRouteSpec);
  const customRouteBuilding = customRouteActive && !activeCustomRoute;

  const gcDistanceKm = useMemo(() => {
    return calculateDistanceKm(
      originAirport.lat,
      originAirport.lng,
      destAirport.lat,
      destAirport.lng
    );
  }, [originAirport, destAirport]);

  const directDistanceKm = activeCustomRoute
    ? activeCustomRoute.route.totalDistanceKm
    : directRoute
    ? directRoute.totalDistanceKm
    : gcDistanceKm;

  const diversionAirport = useMemo(
    () => pickDiversionAirport(originAirport, destAirport),
    [originAirport, destAirport]
  );

  const directFuelPlan = useMemo(() => {
    if (isSameAirport || directDistanceKm <= 0) return null;
    return computeFuelPlan(
      planAircraft,
      directDistanceKm,
      originAirport,
      destAirport,
      diversionAirport
    );
  }, [planAircraft, directDistanceKm, originAirport, destAirport, diversionAirport, isSameAirport]);

  const isFuelInsufficient = directFuelPlan ? !isFuelFeasible(directFuelPlan) : false;
  const directTankFillRatio = directFuelPlan ? getTankFillRatio(directFuelPlan) : 0;
  const directRangeExceeded = directFuelPlan
    ? (directFuelPlan.routeDistanceKm ?? directDistanceKm) >
      (directFuelPlan.maxRangeKm ?? planAircraft.maxRangeKm)
    : false;
  const directFuelShortfallKg = directFuelPlan
    ? Math.max(0, directFuelPlan.totalRequiredKg - directFuelPlan.fuelOnBoardKg)
    : 0;

  const layoverOptions = useMemo(() => {
    if (isSameAirport) return [];
    return findLayoverOptions(
      selectedAircraft,
      originAirport,
      destAirport,
      directDistanceKm
    ).slice(0, 8);
  }, [selectedAircraft, originAirport, destAirport, directDistanceKm, isSameAirport]);

  const selectedLayoverCode = layoverChoice.key === routeKey ? layoverChoice.code : null;

  const fuelLimitedRangeKm = useMemo(
    () => calculateFuelLimitedRangeKm(selectedAircraft),
    [selectedAircraft]
  );
  const perLegRangeLimitKm = Math.min(fuelLimitedRangeKm, selectedAircraft.maxRangeKm);

  const bestLayoverAttempt = useMemo(() => {
    if (!isFuelInsufficient || layoverOptions.length > 0) return null;
    return findBestLayoverAttempt(selectedAircraft, originAirport, destAirport);
  }, [isFuelInsufficient, layoverOptions.length, selectedAircraft, originAirport, destAirport]);

  const layoverAirport = useMemo(() => {
    if (!selectedLayoverCode) return null;
    return (
      layoverOptions.find((option) => option.airport.code === selectedLayoverCode)?.airport ??
      null
    );
  }, [selectedLayoverCode, layoverOptions]);

  const layoverActive = Boolean(layoverAirport && isFuelInsufficient && !customRouteActive);

  // Build both legs and stitch them into a single filed route with a refuel stop
  useEffect(() => {
    if (!routeKey || !layoverAirport || !layoverActive) return;
    let cancelled = false;
    const key = `${routeKey}-LAY-${layoverAirport.code}`;
    Promise.all([
      buildRoute(originAirport, layoverAirport, selectedAircraft.cruiseAltitudeFt),
      buildRoute(layoverAirport, destAirport, selectedAircraft.cruiseAltitudeFt),
    ])
      .then(([leg1, leg2]) => {
        if (cancelled) return;
        const merged = mergeLayoverRoute(leg1, leg2);
        setBuiltLayoverRoute({ key, ...merged });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [routeKey, layoverAirport, layoverActive, originAirport, destAirport, selectedAircraft]);

  const activeLayoverRoute =
    layoverActive &&
    layoverAirport &&
    builtLayoverRoute &&
    builtLayoverRoute.key === `${routeKey}-LAY-${layoverAirport.code}`
      ? builtLayoverRoute
      : null;

  const activeRoute = customRouteActive
    ? activeCustomRoute?.route ?? null
    : activeLayoverRoute
    ? activeLayoverRoute.route
    : directRoute;
  const totalDistanceKm = activeRoute ? activeRoute.totalDistanceKm : directDistanceKm;

  const leg1DistanceKm =
    layoverActive && layoverAirport
      ? activeLayoverRoute
        ? activeLayoverRoute.leg1DistanceKm
        : calculateDistanceKm(
            originAirport.lat,
            originAirport.lng,
            layoverAirport.lat,
            layoverAirport.lng
          )
      : 0;
  const leg2DistanceKm = layoverActive ? Math.max(0, totalDistanceKm - leg1DistanceKm) : 0;

  const layoverFuelPlans = useMemo(() => {
    if (!layoverActive || !layoverAirport || leg1DistanceKm <= 0 || leg2DistanceKm <= 0) {
      return null;
    }
    return {
      leg1: computeFuelPlan(
        selectedAircraft,
        leg1DistanceKm,
        originAirport,
        layoverAirport,
        pickDiversionAirport(originAirport, layoverAirport)
      ),
      leg2: computeFuelPlan(
        selectedAircraft,
        leg2DistanceKm,
        layoverAirport,
        destAirport,
        pickDiversionAirport(layoverAirport, destAirport)
      ),
    };
  }, [
    layoverActive,
    layoverAirport,
    leg1DistanceKm,
    leg2DistanceKm,
    selectedAircraft,
    originAirport,
    destAirport,
  ]);

  const layoverFeasible = Boolean(
    layoverFuelPlans &&
      isFuelFeasible(layoverFuelPlans.leg1) &&
      isFuelFeasible(layoverFuelPlans.leg2)
  );

  const canLaunch =
    !isSameAirport &&
    !isLaunching &&
    !customRouteBuilding &&
    (customRouteActive
      ? Boolean(activeCustomRoute && directFuelPlan && isFuelFeasible(directFuelPlan))
      : isFuelInsufficient
      ? layoverActive && layoverFeasible
      : Boolean(directFuelPlan));

  const fleetFuelFeasibility = useMemo(() => {
    const feasibility = new Map<string, boolean>();
    if (directDistanceKm > 0 && !isSameAirport) {
      for (const plane of AIRCRAFT_FLEET) {
        feasibility.set(
          plane.id,
          isFuelFeasible(
            computeFuelPlan(plane, directDistanceKm, originAirport, destAirport, diversionAirport)
          )
        );
      }
    }
    return feasibility;
  }, [directDistanceKm, originAirport, destAirport, diversionAirport, isSameAirport]);

  const fleetLayoverViability = useMemo(() => {
    const viability = new Map<string, boolean>();
    if (directDistanceKm > 0 && !isSameAirport) {
      for (const plane of AIRCRAFT_FLEET) {
        viability.set(
          plane.id,
          findLayoverOptions(plane, originAirport, destAirport, directDistanceKm).length > 0
        );
      }
    }
    return viability;
  }, [directDistanceKm, originAirport, destAirport, isSameAirport]);

  const estimatedDurationHours = useMemo(() => {
    if (selectedAircraft.cruiseSpeedKmh <= 0) return 0;
    // Add 25 minutes for takeoff/climb and descent/taxi, plus 45 minutes for a layover
    return (
      totalDistanceKm / selectedAircraft.cruiseSpeedKmh +
      0.42 +
      (layoverActive ? 0.75 : 0)
    );
  }, [totalDistanceKm, selectedAircraft, layoverActive]);

  const durationHours = Math.floor(estimatedDurationHours);
  const durationMins = Math.round((estimatedDurationHours % 1) * 60);

  const launchLabel = isLaunching || customRouteBuilding
    ? 'PREPARING ROUTE…'
    : isSameAirport
    ? 'FILE FLIGHT PLAN & BOARD'
    : isFuelInsufficient && !(layoverActive && layoverFeasible)
    ? 'DIRECT DISPATCH EXCEEDS LIMITS'
    : layoverActive && layoverFeasible
    ? 'FILE & BOARD — 1 LAYOVER'
    : 'FILE FLIGHT PLAN & BOARD';

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
    {
      name: 'Arabian Sea Crossing',
      from: 'DXB',
      fromCountry: 'United Arab Emirates',
      to: 'KHI',
      toCountry: 'Pakistan',
      plane: 'a320neo',
      tag: 'South Asia',
    },
    {
      name: 'Heathrow to Islamabad',
      from: 'LHR',
      fromCountry: 'United Kingdom',
      to: 'ISB',
      toCountry: 'Pakistan',
      plane: 'b787-9',
      tag: 'Long-Haul',
    },
    {
      name: 'Kangaroo Mega Route',
      from: 'SYD',
      fromCountry: 'Australia',
      to: 'LHR',
      toCountry: 'United Kingdom',
      plane: 'a380-800',
      tag: '1-Stop',
    },
    {
      name: 'Pacific Twinjet',
      from: 'SFO',
      fromCountry: 'United States',
      to: 'SIN',
      toCountry: 'Singapore',
      plane: 'b777-200lr',
      tag: 'Ultra Long-Haul',
    },
    {
      name: 'Neo Transatlantic',
      from: 'JFK',
      fromCountry: 'United States',
      to: 'FRA',
      toCountry: 'Germany',
      plane: 'a321neo',
      tag: 'Narrowbody',
    },
    {
      name: 'Regional Europe',
      from: 'LHR',
      fromCountry: 'United Kingdom',
      to: 'FCO',
      toCountry: 'Italy',
      plane: 'e195-e2',
      tag: 'Regional',
    },
    {
      name: 'Executive Transpacific',
      from: 'LAX',
      fromCountry: 'United States',
      to: 'SYD',
      toCountry: 'Australia',
      plane: 'g650er',
      tag: 'Bizjet',
    },
  ];

  const resetCustomRoute = () => {
    setCustomRouteSpec(null);
    setBuiltCustomRoute(null);
    setRouteFixInput('');
    setRouteMessage(null);
  };

  const handleApplyPreset = (preset: (typeof PRESET_ROUTES)[0]) => {
    resetCustomRoute();
    setOriginCountry(preset.fromCountry);
    setOriginAirportCode(preset.from);
    setDestCountry(preset.toCountry);
    setDestAirportCode(preset.to);
    setSelectedAircraftId(preset.plane);
  };

  const handleImportFlightPlan = () => {
    if (!importText.trim()) return;
    const parsed = parseFlightPlanText(importText);
    const messages = [...parsed.warnings];
    const routeTokens = [...parsed.routeTokens];
    const originCode = parsed.originCode;
    const destinationCode = parsed.destinationCode;
    let importedOrigin = originCode ? getAirportByCode(originCode) : undefined;
    let importedDestination = destinationCode
      ? getAirportByCode(destinationCode)
      : undefined;

    if (!importedOrigin && !importedDestination && routeTokens.length >= 2) {
      const leadingAirport =
        routeTokens[0].length === 4 ? getAirportByCode(routeTokens[0]) : undefined;
      const trailingAirport =
        routeTokens[routeTokens.length - 1].length === 4
          ? getAirportByCode(routeTokens[routeTokens.length - 1])
          : undefined;
      if (
        leadingAirport &&
        trailingAirport &&
        leadingAirport.code !== trailingAirport.code
      ) {
        importedOrigin = leadingAirport;
        importedDestination = trailingAirport;
        routeTokens.shift();
        routeTokens.pop();
      }
    }

    if (originCode && !importedOrigin) {
      messages.push(
        `${originCode} is not in the airport database; keeping ${originAirport.code}.`
      );
    }
    if (destinationCode && !importedDestination) {
      messages.push(
        `${destinationCode} is not in the airport database; keeping ${destAirport.code}.`
      );
    }

    const nextOrigin = importedOrigin ?? originAirport;
    const nextDestination = importedDestination ?? destAirport;
    let importedAircraftId: string | null = null;
    if (parsed.aircraftType) {
      importedAircraftId = findAircraftIdForType(parsed.aircraftType);
      if (!importedAircraftId) {
        messages.push(
          `${parsed.aircraftType} is not in the fleet; keeping ${selectedAircraft.name}.`
        );
      }
    }

    if (importedOrigin) {
      setOriginCountry(importedOrigin.country);
      setOriginAirportCode(importedOrigin.code);
    }
    if (importedDestination) {
      setDestCountry(importedDestination.country);
      setDestAirportCode(importedDestination.code);
    }
    if (importedAircraftId) {
      setSelectedAircraftId(importedAircraftId);
    }

    setRouteEditorOpen(true);
    setRouteFixInput('');
    setBuiltCustomRoute(null);

    if (nextOrigin.code === nextDestination.code) {
      messages.push('Origin and destination must be different airports.');
    }
    if (routeTokens.length === 0) {
      setCustomRouteSpec(null);
      setRouteMessage(messages.join(' ') || 'No usable route fixes were detected.');
      return;
    }
    if (nextOrigin.code === nextDestination.code) {
      setCustomRouteSpec(null);
      setRouteMessage(messages.join(' '));
      return;
    }

    setCustomRouteSpec({
      tokens: routeTokens,
      altitudeOverrideFt: parsed.cruiseAltitudeFt,
      flightNumber: parsed.flightNumber,
    });
    setRouteMessage(
      [
        `Imported ${routeTokens.length} route entries for ${nextOrigin.code} → ${nextDestination.code}.`,
        ...messages,
      ].join(' ')
    );
  };

  const handleAddRouteFixes = () => {
    const tokens = normalizeRouteTokens(routeFixInput);
    if (tokens.length === 0) {
      setRouteMessage('Enter at least one fix or airway to add.');
      return;
    }
    const currentSpec = customRouteSpec ?? {
      tokens: [],
      altitudeOverrideFt: null,
      flightNumber: null,
    };
    setCustomRouteSpec({ ...currentSpec, tokens: [...currentSpec.tokens, ...tokens] });
    setBuiltCustomRoute(null);
    setRouteFixInput('');
    setRouteEditorOpen(true);
    setRouteMessage(null);
  };

  const handleRemoveRouteToken = (index: number) => {
    if (!customRouteSpec) return;
    const tokens = customRouteSpec.tokens.filter((_, tokenIndex) => tokenIndex !== index);
    setBuiltCustomRoute(null);
    if (tokens.length === 0) {
      setCustomRouteSpec(null);
      setRouteMessage('Custom route cleared; automatic routing restored.');
      return;
    }
    setCustomRouteSpec({ ...customRouteSpec, tokens });
    setRouteMessage(null);
  };

  const handleSeedAutoRoute = () => {
    if (!directRoute) {
      setRouteMessage('Wait for the automatic route to finish building.');
      return;
    }
    const tokens = directRoute.waypoints
      .filter((waypoint) => waypoint.type === 'navaid' || waypoint.type === 'oceanic')
      .map((waypoint) => waypoint.name)
      .filter((name): name is string => Boolean(name));
    if (tokens.length === 0) {
      setRouteMessage('The automatic route has no editable en-route fixes.');
      return;
    }
    setCustomRouteSpec({
      tokens,
      altitudeOverrideFt: null,
      flightNumber: null,
    });
    setBuiltCustomRoute(null);
    setRouteEditorOpen(true);
    setRouteMessage(`Loaded ${tokens.length} fixes from the automatic route.`);
  };

  const handleResetCustomRoute = () => {
    setCustomRouteSpec(null);
    setBuiltCustomRoute(null);
    setRouteFixInput('');
    setRouteEditorOpen(false);
    setRouteMessage('Automatic routing restored.');
  };

  const handleLaunchFlight = async () => {
    if (!canLaunch) return;

    if (layoverActive && layoverAirport) {
      setIsLaunching(true);
      try {
        let layoverRoute = activeLayoverRoute;
        if (!layoverRoute) {
          const [leg1Route, leg2Route] = await Promise.all([
            buildRoute(originAirport, layoverAirport, selectedAircraft.cruiseAltitudeFt),
            buildRoute(layoverAirport, destAirport, selectedAircraft.cruiseAltitudeFt),
          ]);
          const merged = mergeLayoverRoute(leg1Route, leg2Route);
          layoverRoute = { key: `${routeKey}-LAY-${layoverAirport.code}`, ...merged };
          setBuiltLayoverRoute(layoverRoute);
        }

        const leg1Plan = computeFuelPlan(
          selectedAircraft,
          layoverRoute.leg1DistanceKm,
          originAirport,
          layoverAirport,
          pickDiversionAirport(originAirport, layoverAirport)
        );
        const leg2Plan = computeFuelPlan(
          selectedAircraft,
          layoverRoute.route.totalDistanceKm - layoverRoute.leg1DistanceKm,
          layoverAirport,
          destAirport,
          pickDiversionAirport(layoverAirport, destAirport)
        );
        if (!isFuelFeasible(leg1Plan) || !isFuelFeasible(leg2Plan)) return;

        const stop: LayoverStop = {
          airport: layoverAirport,
          distanceFromOriginKm: layoverRoute.leg1DistanceKm,
          leg1FuelPlan: leg1Plan,
          leg2FuelPlan: leg2Plan,
        };

        const flightPlan: FlightPlan = {
          id: `FL-${Date.now().toString(36).toUpperCase()}`,
          origin: originAirport,
          destination: destAirport,
          aircraft: selectedAircraft,
          totalDistanceKm: Math.round(layoverRoute.route.totalDistanceKm),
          estimatedFlightTimeHours:
            Math.round(
              ((layoverRoute.route.totalDistanceKm / selectedAircraft.cruiseSpeedKmh) + 0.42 + 0.75) *
                10
            ) / 10,
          waypoints: layoverRoute.route.waypoints,
          departureTime: new Date(),
          isRealWorldRoute: false,
          fuel: leg2Plan,
          layover: stop,
        };

        onStartFlight(flightPlan);
      } finally {
        setIsLaunching(false);
      }
      return;
    }

    let route = activeRoute;
    if (!route) {
      setIsLaunching(true);
      try {
        route = await buildRoute(
          originAirport,
          destAirport,
          selectedAircraft.cruiseAltitudeFt
        );
      } finally {
        setIsLaunching(false);
      }
    }

    const launchFuelPlan = computeFuelPlan(
      planAircraft,
      route.totalDistanceKm,
      originAirport,
      destAirport,
      diversionAirport
    );
    if (!isFuelFeasible(launchFuelPlan)) return;

    const flightPlan: FlightPlan = {
      id: `FL-${Date.now().toString(36).toUpperCase()}`,
      origin: originAirport,
      destination: destAirport,
      aircraft: planAircraft,
      totalDistanceKm: Math.round(route.totalDistanceKm),
      estimatedFlightTimeHours:
        Math.round((route.totalDistanceKm / planAircraft.cruiseSpeedKmh + 0.42) * 10) / 10,
      waypoints: route.waypoints,
      departureTime: new Date(),
      airline: route.airline ?? undefined,
      flightNumber: route.flightNumber ?? undefined,
      isRealWorldRoute: customRouteActive ? false : route.isRealWorldRoute,
      fuel: launchFuelPlan,
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
                  if (country === originCountry) return;
                  resetCustomRoute();
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
                onChange={(e) => {
                  if (e.target.value === originAirport.code) return;
                  resetCustomRoute();
                  setOriginAirportCode(e.target.value);
                }}
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
                  if (country === destCountry) return;
                  resetCustomRoute();
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
                onChange={(e) => {
                  if (e.target.value === destAirport.code) return;
                  resetCustomRoute();
                  setDestAirportCode(e.target.value);
                }}
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
            const canMakeDistance = fleetFuelFeasibility.get(plane.id) ?? true;
            const layoverPossible = fleetLayoverViability.get(plane.id) ?? false;

            return (
              <div
                key={plane.id}
                onClick={() => {
                  if (plane.id === selectedAircraftId) return;
                  resetCustomRoute();
                  setSelectedAircraftId(plane.id);
                }}
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
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 pt-2 border-t border-zinc-800/80 text-[10px]">
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
                        canMakeDistance
                          ? 'text-zinc-200'
                          : layoverPossible
                          ? 'text-amber-300'
                          : 'text-rose-400'
                      }`}
                    >
                      {plane.maxRangeKm.toLocaleString()} km
                    </span>
                    {!canMakeDistance && layoverPossible && (
                      <span className="block text-[8px] font-black text-amber-400/90 uppercase">
                        1 stop ok
                      </span>
                    )}
                  </div>
                  <div>
                    <span className="text-zinc-500 block">CEILING</span>
                    <span className="font-mono font-bold text-zinc-200">
                      FL{Math.round(plane.cruiseAltitudeFt / 100)}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">BURN</span>
                    <span className="font-mono font-bold text-amber-200">
                      {plane.fuelBurnKgPerHour.toLocaleString()} kg/h
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Filed Navigation Route Strip */}
      {!isSameAirport && (
        <div className="p-4 bg-zinc-900/90 border border-zinc-800 rounded-2xl shadow-xl flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Route className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                Filed Navigation Route
              </h2>
            </div>

            {customRouteActive ? (
              <span className="flex items-center gap-1.5 px-2.5 py-1 bg-cyan-950/60 border border-cyan-700/60 rounded-lg text-[11px] font-bold text-cyan-300">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
                {activeCustomRoute
                  ? `CUSTOM ROUTE • ${customRouteSpec?.tokens.length ?? 0} ENTRIES ${
                      customRouteSpec?.flightNumber ? `• ${customRouteSpec.flightNumber}` : ''
                    }`
                  : 'BUILDING CUSTOM ROUTE…'}
              </span>
            ) : layoverActive && layoverAirport ? (
              <span className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-950/60 border border-amber-700/60 rounded-lg text-[11px] font-bold text-amber-300">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                {activeLayoverRoute
                  ? `LAYOVER ROUTE • REFUEL AT ${layoverAirport.code}`
                  : `BUILDING LAYOVER ROUTE VIA ${layoverAirport.code}…`}
              </span>
            ) : activeRoute?.isRealWorldRoute ? (
              <span className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-950/60 border border-emerald-700/60 rounded-lg text-[11px] font-bold text-emerald-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                REAL WORLD ROUTE • {activeRoute.airline?.name} ({activeRoute.airline?.code})
                {activeRoute.flightNumber ? ` • ${activeRoute.flightNumber}` : ''}
              </span>
            ) : (
              <span className="px-2.5 py-1 bg-zinc-800/80 border border-zinc-700 rounded-lg text-[11px] font-semibold text-zinc-400">
                {activeRoute ? 'SIMULATED TRACK • NO KNOWN OPERATORS' : 'COMPUTING AIRWAY ROUTE…'}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setRouteEditorOpen((open) => !open)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-[11px] font-bold text-zinc-200 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
              {customRouteActive ? 'EDIT CUSTOM ROUTE' : 'IMPORT / EDIT ROUTE'}
            </button>
            {customRouteActive ? (
              <button
                onClick={handleResetCustomRoute}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-[11px] font-bold text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                RESET TO AUTO
              </button>
            ) : (
              <button
                onClick={handleSeedAutoRoute}
                disabled={!directRoute}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-[11px] font-bold text-zinc-400 hover:text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
                EDIT AUTO ROUTE
              </button>
            )}
            {customRouteActive && (
              <span className="px-2 py-1 rounded-lg bg-zinc-950/70 border border-zinc-800 text-[10px] font-mono font-bold text-cyan-300">
                CRZ FL{Math.round(planAircraft.cruiseAltitudeFt / 100)}
              </span>
            )}
            {routeMessage && (
              <span className="text-[10px] text-amber-300/90">{routeMessage}</span>
            )}
          </div>

          {routeEditorOpen && (
            <div className="p-3 bg-zinc-950/70 border border-cyan-900/60 rounded-xl flex flex-col gap-3">
              <div>
                <div className="text-[11px] font-bold text-cyan-300 uppercase tracking-wider">
                  Import Flight Plan
                </div>
                <p className="text-[10px] text-zinc-500 mt-0.5">
                  Paste an ICAO FPL, SimBrief OFP, or a bare route. Origin, destination,
                  aircraft, cruise level, and flight number are applied when present.
                </p>
              </div>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={4}
                placeholder="(FPL-BAW123-IM-B789/H-...-EGLL...-N0450F350 DCT DVR UL9 ...-KJFK...)"
                className="w-full bg-zinc-950 border border-zinc-750 rounded-lg px-3 py-2 text-[11px] font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500 resize-y"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleImportFlightPlan}
                  disabled={!importText.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 disabled:bg-zinc-800 disabled:text-zinc-500 text-black rounded-lg text-[11px] font-black transition-all active:scale-95"
                >
                  <Upload className="w-3.5 h-3.5" />
                  APPLY IMPORT
                </button>
                <span className="text-[10px] text-zinc-500">
                  Imported 5-letter fixes are skipped when they are not in the VOR navdata.
                </span>
              </div>

              <div className="border-t border-zinc-800 pt-3 flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-cyan-300 uppercase tracking-wider">
                    Route Fixes &amp; Airways
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    {customRouteSpec?.tokens.length ?? 0} entries
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {customRouteSpec?.tokens.length ? (
                    customRouteSpec.tokens.map((token, index) => {
                      const isUnresolved = activeCustomRoute?.unresolved.includes(token);
                      const isAirway = activeCustomRoute?.airways.includes(token);
                      return (
                        <span
                          key={`${token}-${index}`}
                          title={
                            isUnresolved
                              ? 'Not found in navdata; skipped'
                              : isAirway
                              ? 'Airway reference; its fixes must be listed separately'
                              : 'Custom route waypoint'
                          }
                          className={`flex items-center gap-1 pl-2 pr-1 py-1 rounded-md border text-[10px] font-mono font-bold ${
                            isUnresolved
                              ? 'bg-rose-950/60 border-rose-700/70 text-rose-200'
                              : isAirway
                              ? 'bg-zinc-900 border-zinc-700 text-zinc-400'
                              : 'bg-cyan-950/60 border-cyan-800/70 text-cyan-200'
                          }`}
                        >
                          {token}
                          <button
                            onClick={() => handleRemoveRouteToken(index)}
                            aria-label={`Remove ${token}`}
                            className="p-0.5 rounded hover:bg-black/30 transition-colors"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      );
                    })
                  ) : (
                    <span className="text-[10px] text-zinc-500">
                      No custom fixes yet. Import a plan or add fixes below.
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={routeFixInput}
                    onChange={(e) => setRouteFixInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddRouteFixes();
                      }
                    }}
                    placeholder="Add fix, airway, or 50N030W coordinate"
                    className="flex-1 min-w-0 bg-zinc-950 border border-zinc-750 rounded-lg px-3 py-1.5 text-[11px] font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500"
                  />
                  <button
                    onClick={handleAddRouteFixes}
                    disabled={!routeFixInput.trim()}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-600 text-zinc-200 rounded-lg text-[10px] font-bold transition-colors"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    ADD
                  </button>
                </div>
                {activeCustomRoute && activeCustomRoute.airways.length > 0 && (
                  <div className="text-[10px] text-zinc-500">
                    Airways: {activeCustomRoute.airways.join(', ')}. Airway names are kept for
                    reference; only listed fixes are resolved.
                  </div>
                )}
                {activeCustomRoute && activeCustomRoute.unresolved.length > 0 && (
                  <div className="text-[10px] text-rose-300/90">
                    Skipped unresolved fixes: {activeCustomRoute.unresolved.join(', ')}
                  </div>
                )}
                {activeCustomRoute &&
                  activeCustomRoute.resolvedFixCount === 0 &&
                  customRouteSpec &&
                  customRouteSpec.tokens.length > 0 && (
                    <div className="text-[10px] text-rose-300/90">
                      No listed fixes were resolved; the route currently follows a direct
                      airport-to-airport path.
                    </div>
                  )}
              </div>
            </div>
          )}

          {activeRoute && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {activeRoute.waypoints.map((wp, index) => (
                <React.Fragment key={`${wp.name ?? 'FIX'}-${index}`}>
                  {index > 0 && <span className="text-zinc-600 text-[10px] shrink-0">›</span>}
                  <span
                    title={`${wp.type ?? 'navaid'} • ${Math.round(wp.distanceFromOriginKm)} km from origin`}
                    className={`px-2 py-1 rounded-md border text-[10px] font-mono font-bold shrink-0 ${
                      FIX_TYPE_STYLES[wp.type ?? 'navaid']
                    }`}
                  >
                    {wp.name}
                  </span>
                </React.Fragment>
              ))}
            </div>
          )}

          {activeRoute && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500">
              {customRouteActive ? (
                <>
                  <span>{customRouteSpec?.tokens.length ?? 0} custom route entries</span>
                  <span>CRZ FL{Math.round(planAircraft.cruiseAltitudeFt / 100)}</span>
                  {activeCustomRoute && activeCustomRoute.unresolved.length > 0 && (
                    <span className="text-rose-300/90">
                      {activeCustomRoute.unresolved.length} unresolved fixes skipped
                    </span>
                  )}
                  {activeCustomRoute &&
                    activeCustomRoute.resolvedFixCount === 0 &&
                    (customRouteSpec?.tokens.length ?? 0) > 0 && (
                      <span className="text-rose-300/90">
                        No listed fixes resolved — using direct track
                      </span>
                    )}
                </>
              ) : (
                <>
                  <span>{activeRoute.enrouteFixCount} en-route VOR/VORTAC/TACAN fixes</span>
                  <span>±110 km corridor of great circle track</span>
                </>
              )}
              {activeRoute.oceanicFixCount > 0 && (
                <span>{activeRoute.oceanicFixCount} oceanic grid waypoints (300 NM spacing)</span>
              )}
              {layoverActive && layoverAirport && leg1DistanceKm > 0 && (
                <span className="text-amber-400/90 font-semibold">
                  Leg 1 {Math.round(leg1DistanceKm).toLocaleString()} km →{' '}
                  {layoverAirport.code}, then {Math.round(leg2DistanceKm).toLocaleString()} km →{' '}
                  {destAirport.code}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Fuel Dispatch & Reserves */}
      {!isSameAirport && directFuelPlan && (
        <div className="p-4 bg-zinc-900/90 border border-zinc-800 rounded-2xl shadow-xl flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Fuel className="w-4 h-4 text-amber-400" />
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                Fuel Dispatch & Reserves
              </h2>
            </div>
            {layoverActive && layoverFeasible && layoverAirport ? (
              <span className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-950/60 border border-amber-700/60 rounded-lg text-[11px] font-bold text-amber-300">
                <CheckCircle className="w-3.5 h-3.5" />
                LAYOVER VIA {layoverAirport.code} — BOTH LEGS WITHIN TANKS
              </span>
            ) : isFuelInsufficient ? (
              <span className="flex items-center gap-1.5 px-2.5 py-1 bg-rose-950/60 border border-rose-700/60 rounded-lg text-[11px] font-bold text-rose-300">
                <AlertTriangle className="w-3.5 h-3.5" />
                {directRangeExceeded
                  ? `OUT OF RANGE — ${Math.round(
                      directDistanceKm - planAircraft.maxRangeKm
                    ).toLocaleString()} KM BEYOND LIMIT`
                  : `INSUFFICIENT FUEL — SHORT BY ${Math.round(
                      directFuelShortfallKg
                    ).toLocaleString()} KG`}
              </span>
            ) : directTankFillRatio >= TIGHT_FUEL_RATIO ? (
              <span className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-950/60 border border-amber-700/60 rounded-lg text-[11px] font-bold text-amber-300">
                <ShieldAlert className="w-3.5 h-3.5" />
                TIGHT FUEL MARGIN — {Math.round(directTankFillRatio * 100)}% OF TANKS
              </span>
            ) : (
              <span className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-950/60 border border-emerald-700/60 rounded-lg text-[11px] font-bold text-emerald-300">
                <CheckCircle className="w-3.5 h-3.5" />
                DISPATCH FUEL WITHIN TANKS
              </span>
            )}
          </div>

          {isFuelInsufficient &&
            (customRouteActive ? (
              <div className="flex flex-wrap items-center gap-2 p-2.5 bg-zinc-950/60 border border-rose-900/60 rounded-xl">
                <span className="text-[11px] text-zinc-300">
                  This custom route exceeds the aircraft&apos;s fuel or range limits. Shorten
                  the route or use a longer-range aircraft; layover planning requires the
                  automatic route.
                </span>
                <button
                  onClick={handleResetCustomRoute}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-[10px] font-bold transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  RESET TO AUTO
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 p-2.5 bg-zinc-950/60 border border-zinc-800 rounded-xl">
                {layoverOptions.length > 0 ? (
                  <span className="text-[11px] text-zinc-400">
                    Direct dispatch exceeds the aircraft&apos;s fuel or range limits. Insert a
                    technical stop with refueling:
                  </span>
                ) : (
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[11px] text-zinc-300 font-semibold">
                      No single airport can bridge this route within the aircraft&apos;s fuel
                      and range limits.
                    </span>
                    {bestLayoverAttempt && (
                      <span className="text-[10px] text-zinc-500">
                        {selectedAircraft.name}: ≈
                        {Math.round(perLegRangeLimitKm).toLocaleString()} km per leg with
                        reserves and range limits
                        · best stop {bestLayoverAttempt.airport.code} still leaves a{' '}
                        {Math.round(
                          Math.max(
                            bestLayoverAttempt.leg1DistanceKm,
                            bestLayoverAttempt.leg2DistanceKm
                          )
                        ).toLocaleString()}{' '}
                        km leg — choose a longer-range aircraft or a shorter route.
                      </span>
                    )}
                  </span>
                )}
                {layoverOptions.length > 0 && !layoverActive && (
                  <button
                    onClick={() =>
                      setLayoverChoice({ key: routeKey, code: layoverOptions[0].airport.code })
                    }
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-black rounded-lg text-[11px] font-black transition-all active:scale-95"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    ADD LAYOVER VIA {layoverOptions[0].airport.code}
                  </button>
                )}
                {layoverOptions.length > 0 && layoverActive && layoverAirport && (
                  <>
                    <select
                      value={layoverAirport.code}
                      onChange={(e) =>
                        setLayoverChoice({ key: routeKey, code: e.target.value })
                      }
                      className="bg-zinc-900 border border-amber-700/60 rounded-lg px-2 py-1 text-[11px] font-mono font-bold text-amber-200 focus:outline-none focus:border-amber-400"
                    >
                      {layoverOptions.map((option) => (
                        <option key={option.airport.code} value={option.airport.code}>
                          {option.airport.code} — {option.airport.city} (+
                          {Math.round(option.detourKm).toLocaleString()} km)
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => setLayoverChoice({ key: routeKey, code: null })}
                      className="flex items-center gap-1 px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-[10px] font-bold transition-colors"
                    >
                      <X className="w-3 h-3" />
                      REMOVE
                    </button>
                  </>
                )}
              </div>
            ))}

          {layoverActive && layoverAirport && layoverFuelPlans ? (
            <div className="flex flex-col gap-2.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {[
                  {
                    label: 'LEG 1',
                    from: originAirport.code,
                    to: layoverAirport.code,
                    distanceKm: leg1DistanceKm,
                    plan: layoverFuelPlans.leg1,
                  },
                  {
                    label: 'LEG 2',
                    from: layoverAirport.code,
                    to: destAirport.code,
                    distanceKm: leg2DistanceKm,
                    plan: layoverFuelPlans.leg2,
                  },
                ].map((leg) => {
                  const ratio = getTankFillRatio(leg.plan);
                  const feasible = isFuelFeasible(leg.plan);
                  return (
                    <div
                      key={leg.label}
                      className="p-2.5 bg-zinc-950/60 rounded-xl border border-zinc-800 flex flex-col gap-1.5"
                    >
                      <div className="flex items-center justify-between text-[10px] font-mono">
                        <span className="font-bold text-white">
                          {leg.label} · {leg.from} → {leg.to}
                        </span>
                        <span className="text-zinc-400">
                          {Math.round(leg.distanceKm).toLocaleString()} km
                        </span>
                      </div>
                      <div className="flex justify-between text-[10px] font-mono text-zinc-400">
                        <span>
                          Required{' '}
                          <span className={feasible ? 'text-white font-bold' : 'text-rose-300 font-bold'}>
                            {Math.round(leg.plan.totalRequiredKg).toLocaleString()} kg
                          </span>
                        </span>
                        <span>
                          Tanks{' '}
                          <span className="text-white font-bold">
                            {Math.round(leg.plan.fuelOnBoardKg).toLocaleString()} kg
                          </span>
                        </span>
                        <span className={feasible ? 'text-emerald-300 font-bold' : 'text-rose-300 font-bold'}>
                          {Math.round(ratio * 100)}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-zinc-900 rounded-full overflow-hidden border border-zinc-800">
                        <div
                          className={`h-full ${
                            !feasible
                              ? 'bg-rose-500'
                              : ratio >= TIGHT_FUEL_RATIO
                              ? 'bg-amber-400'
                              : 'bg-gradient-to-r from-cyan-500 via-emerald-400 to-teal-300'
                          }`}
                          style={{ width: `${Math.min(100, ratio * 100)}%` }}
                        />
                      </div>
                      <div className="text-[9px] text-zinc-500 font-mono truncate">
                        TRIP {Math.round(leg.plan.tripFuelKg).toLocaleString()} · CONT{' '}
                        {Math.round(leg.plan.contingencyFuelKg).toLocaleString()} · DIV{' '}
                        {Math.round(leg.plan.alternateFuelKg).toLocaleString()} · RES{' '}
                        {Math.round(leg.plan.finalReserveKg).toLocaleString()} · TAXI{' '}
                        {Math.round(leg.plan.taxiFuelKg).toLocaleString()}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="text-[11px] text-zinc-400">
                <span className="font-bold text-amber-300">Technical stop:</span>{' '}
                {layoverAirport.code} — {layoverAirport.name} ({layoverAirport.city}). Refuel to full
                tanks before departing for {destAirport.code}.
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {[
                  { label: 'TRIP FUEL', value: directFuelPlan.tripFuelKg },
                  { label: 'CONTINGENCY 5%', value: directFuelPlan.contingencyFuelKg },
                  {
                    label: directFuelPlan.alternateAirport
                      ? `DIVERSION ${directFuelPlan.alternateAirport.code}`
                      : 'DIVERSION',
                    value: directFuelPlan.alternateFuelKg,
                  },
                  { label: `RESERVE ${FINAL_RESERVE_MINUTES} MIN`, value: directFuelPlan.finalReserveKg },
                  { label: 'TAXI', value: directFuelPlan.taxiFuelKg },
                  { label: 'TANKS', value: directFuelPlan.fuelOnBoardKg },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="p-2.5 bg-zinc-950/60 rounded-xl border border-zinc-800"
                  >
                    <div className="text-[9px] font-semibold text-zinc-500 uppercase tracking-wider">
                      {item.label}
                    </div>
                    <div className="font-mono font-bold text-sm text-white mt-0.5">
                      {Math.round(item.value).toLocaleString()}
                      <span className="text-[9px] text-zinc-500 font-normal ml-1">KG</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-[11px] font-mono text-zinc-400">
                  <span>
                    Required{' '}
                    <span className="text-white font-bold">
                      {Math.round(directFuelPlan.totalRequiredKg).toLocaleString()} kg
                    </span>
                  </span>
                  <span className="font-bold text-zinc-300">
                    {Math.round(directTankFillRatio * 100)}% tanks
                  </span>
                  <span>
                    Capacity{' '}
                    <span className="text-white font-bold">
                      {Math.round(directFuelPlan.fuelOnBoardKg).toLocaleString()} kg
                    </span>
                  </span>
                </div>
                <div className="w-full h-2 bg-zinc-900 rounded-full overflow-hidden border border-zinc-800">
                  <div
                    className={`h-full ${
                      isFuelInsufficient
                        ? 'bg-rose-500'
                        : directTankFillRatio >= TIGHT_FUEL_RATIO
                        ? 'bg-amber-400'
                        : 'bg-gradient-to-r from-cyan-500 via-emerald-400 to-teal-300'
                    }`}
                    style={{ width: `${Math.min(100, directTankFillRatio * 100)}%` }}
                  />
                </div>
              </div>

              {directFuelPlan.alternateAirport && (
                <div className="text-[11px] text-zinc-400">
                  <span className="font-bold text-violet-300">Diversion airport:</span>{' '}
                  {directFuelPlan.alternateAirport.code} — {directFuelPlan.alternateAirport.name} (
                  {Math.round(directFuelPlan.alternateDistanceKm).toLocaleString()} km from{' '}
                  {destAirport.code})
                </div>
              )}
            </>
          )}
        </div>
      )}

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
              {layoverActive && (
                <div className="text-[9px] text-amber-300/90 font-semibold uppercase tracking-wide">
                  incl. 45 min refuel stop at {layoverAirport?.code}
                </div>
              )}
            </div>
          </div>

          {/* Fuel Dispatch Status */}
          <div>
            {isSameAirport ? (
              <div className="flex items-center gap-1.5 text-xs text-rose-400 font-semibold bg-rose-950/40 border border-rose-800 px-3 py-1.5 rounded-lg">
                <AlertTriangle className="w-4 h-4" />
                <span>Origin and Destination cannot be identical!</span>
              </div>
            ) : layoverActive && layoverFeasible && layoverAirport ? (
              <div className="flex items-center gap-1.5 text-xs text-amber-300 font-semibold bg-amber-950/40 border border-amber-700/70 px-3 py-1.5 rounded-lg">
                <CheckCircle className="w-4 h-4" />
                <span>Fuel valid with technical stop at {layoverAirport.code}</span>
              </div>
            ) : directFuelPlan && !isFuelFeasible(directFuelPlan) ? (
              customRouteActive ? (
                <div className="flex items-center gap-1.5 text-xs text-rose-400 font-semibold bg-rose-950/40 border border-rose-800 px-3 py-1.5 rounded-lg">
                  <ShieldAlert className="w-4 h-4" />
                  <span>Custom route exceeds fuel or range limits — reset to auto to plan a layover</span>
                </div>
              ) : layoverOptions.length > 0 ? (
                <div className="flex items-center gap-1.5 text-xs text-amber-300 font-semibold bg-amber-950/40 border border-amber-700/70 px-3 py-1.5 rounded-lg">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Direct dispatch exceeds limits — add a layover to continue</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-xs text-rose-400 font-semibold bg-rose-950/40 border border-rose-800 px-3 py-1.5 rounded-lg">
                  <ShieldAlert className="w-4 h-4" />
                  <span>
                    No non-stop dispatch: {Math.round(directDistanceKm).toLocaleString()} km
                    route, {planAircraft.maxRangeKm.toLocaleString()} km range
                  </span>
                </div>
              )
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold bg-emerald-950/40 border border-emerald-800 px-3 py-1.5 rounded-lg">
                <CheckCircle className="w-4 h-4" />
                <span>Fuel &amp; range within limits</span>
              </div>
            )}
          </div>
        </div>

        {/* Start Flight Button */}
        <button
          onClick={handleLaunchFlight}
          disabled={!canLaunch}
          className={`w-full md:w-auto px-8 py-3.5 rounded-xl font-black text-sm flex items-center justify-center gap-2 transition-all shadow-xl ${
            !canLaunch
              ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700'
              : 'bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-black shadow-cyan-500/25 active:scale-95'
          }`}
        >
          <span>{launchLabel}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
