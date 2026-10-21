# AGENTS.md

## Project

NextAir is a client-side 2D aeronautical flight simulator built with Next.js App Router, React, TypeScript, Tailwind CSS, and Leaflet. The app runs a real-time flight simulation with route planning, fuel planning, live traffic/TCAS, cold-and-dark ground operations, emergency scenarios, and checkride scoring.

## Commands

Run commands from the repository root on Windows PowerShell.

```powershell
npm run dev
npm run build
npm run start
npm run lint
npx tsc --noEmit
```

There is no test runner configured. For UI verification, use a production build with headless Chrome/Edge over the DevTools protocol when needed.

## Verification

Before finishing a task:

1. Run `npx tsc --noEmit`.
2. Run `npm run lint`.
3. Run `npm run build`.
4. Verify affected UI flows in a browser when behavior changed.

Current lint baseline is 1 pre-existing error in `app/page.tsx` for `simulationTick` being referenced before declaration, plus 4 warnings (unused `Compass` and `totalDistanceKm`, and two `FlightMap` hook dependency warnings). Do not treat these as new regressions, but report if the count changes.

## Architecture

- `app/page.tsx` owns the flight session, requestAnimationFrame simulation loop, persistence, audio phase transitions, scenario actions, and top-level modals.
- `lib/simulation.ts` is the pure flight-phase simulator. Avoid putting React or browser state in it.
- `lib/ground.ts` contains engine, taxi, checklist, and ground-configuration helpers.
- `lib/routing.ts` and `lib/flightPlanImport.ts` handle route construction, airway/navaid resolution, and ICAO/SimBrief parsing.
- `lib/aircraft.ts` defines the dispatch fleet and range helper; `lib/airports.ts` is the airport database used by routing and layovers.
- `lib/fuel.ts` handles fuel plans, tank and non-stop range validation, alternates, and one-stop layover feasibility.
- `lib/scenarios.ts` defines emergency scenarios, interactive checklist steps, and checkride scoring.
- `lib/tcas.ts`, `lib/traffic.ts`, and `app/api/traffic/route.ts` handle live traffic and TCAS advisory logic.
- `types/flight.ts` and `types/scenario.ts` contain shared domain types.
- `components/FlightPlanner.tsx` composes dispatch, aircraft, route editing, fuel, and launch.
- `components/CockpitHUD.tsx` composes ground operations, flight controls, checklists, emergency panels, and PFD cards.
- `components/FlightMapDynamic.tsx` is the client-only Leaflet entry point. Do not import Leaflet map code into server components.

## Conventions

- Use TypeScript with strict mode. Prefer explicit domain types in `types/` over inline object shapes.
- Follow existing React function-component and hook patterns. Add `'use client'` when a component uses state, effects, browser APIs, or Leaflet.
- Use the `@/` path alias for internal imports.
- Match the existing Tailwind dark zinc/cyan/emerald/rose visual language and lucide-react icon style.
- Do not add comments to hand-written code unless explicitly requested.
- Keep simulation behavior deterministic and derived from telemetry, flight plan, and scenario context. Do not mutate shared state outside React setters or the existing refs.
- Preserve backward compatibility for persisted flights under `nextair.activeFlight.v1`; new telemetry/scenario fields should be optional with safe restore defaults.
- Do not add `export const dynamic = 'force-dynamic'` or similar route overrides. Cache Components and partial prefetching are enabled in `next.config.ts`.
- Keep browser-only code out of server components. The traffic API uses a server route to avoid browser CORS restrictions.
- Do not expose `.env.local` values or add secrets to source files.

## Domain Notes

- `FlightPhase` drives simulation, audio, HUD badges, and ground/airborne controls. Add new phases consistently across `types/flight.ts`, `lib/simulation.ts`, audio handling, and phase displays.
- Emergency scenarios are interactive: checklist steps are completed by the user, and action steps apply aircraft changes such as alternate gear extension or emergency descent.
- Checkride scoring depends on checklist completion, response time, aircraft configuration, and safe landing. Keep scoring logic in `lib/scenarios.ts`.
- `lib/data/navaids.ts` does not contain 4/5-letter fixes. Imported routes should surface unresolved fixes rather than silently dropping them.
- Aircraft specs live in `lib/aircraft.ts`. Preset routes and default aircraft IDs reference these IDs, so add aircraft and route presets together. A new `Aircraft['type']` category also requires a `TAXI_FUEL_BY_TYPE` entry.
- Direct dispatch is feasible only when both tank fuel and `maxRangeKm` are satisfied. `findLayoverOptions` checks each leg against both limits and sorts candidate stops by detour; the planner displays up to eight options. Custom imported routes intentionally skip automatic layovers.
- Route presets live in `components/FlightPlanner.tsx` and must reference airports already present in `lib/airports.ts` with matching country names. `lib/data/realRoutes.ts` is generated; update it with `scripts/generate-route-data.mjs`, not by hand.
- OpenSky anonymous traffic is rate-limited; use the existing server proxy and bounding-box filtering.
