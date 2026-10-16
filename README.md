# NextAir - 2D Aeronautical Flight Simulation & Radar Navigation

A real-time 2D aeronautical flight simulation web application built with **Next.js (App Router)**, **TypeScript**, **Tailwind CSS**, and **Leaflet**.

## 🛫 Features

1. **Flight Dispatch & Route Planning**
   - **Origin & Destination Selection**: Select starting country and arrival country with instant airport filtering across North America, Europe, Asia, Middle East, South America, and Oceania.
   - **Aircraft Fleet Performance**: Choose aircraft models that dictate real-world cruise speed, maximum non-stop range, climb/descent rates, and cruise ceiling:
     - **Boeing 787-9 Dreamliner** (Flagship: 903 km/h / 488 kts, Range: 14,140 km, Ceiling: FL390)
     - **Airbus A350-900 XWB** (903 km/h / 488 kts, Range: 15,370 km, Ceiling: FL410)
     - **Boeing 777-300ER** (905 km/h / 489 kts, Range: 13,650 km, Ceiling: FL360)
     - **Boeing 737-800 NextGen** (838 km/h / 453 kts, Range: 5,436 km, Ceiling: FL350)
     - **Airbus A320neo** (828 km/h / 447 kts, Range: 6,300 km, Ceiling: FL370)
     - **Concorde SST** (Supersonic: 2,158 km/h / Mach 2.04, Range: 7,222 km, Ceiling: FL600)
     - **Cessna 172 Skyhawk** (226 km/h / 122 kts, Range: 1,185 km, Ceiling: 8,500 ft)
   - **Range Validation**: Proactively prevents dispatching an aircraft on routes exceeding its operational fuel capacity.
   - **Preset Routes**: 1-click loading of iconic routes (Transatlantic JFK-LHR, Transpacific SFO-HND, Concorde supersonic crossing, etc.).

2. **2D Flight Radar Map (Leaflet)**
   - **Great Circle Geodesic Lines**: Calculates true orthodromic curved routes across the Earth's sphere, including anti-meridian date-line crossing handling.
   - **Dynamic Aircraft Marker**: Top-down SVG jet silhouette with smooth real-time magnetic heading rotation.
   - **2.5D Altitude Shadow**: Dynamic shadow offset and blur that scales with altitude (0 to 40,000 ft), delivering realistic flight depth on a 2D map.
   - **Top of Descent (TOD) Marker**: Waypoint indicator on the route marking where glideslope descent begins.
   - **Radar Tile Modes**: Dark Aviation Radar (CartoDB Dark), ESRI World Satellite Imagery, and Voyager Navigation.
   - **Camera Controls**: Auto-follow aircraft camera, Fit entire route bounds, and manual free-pan.

3. **Flight Physics & State Machine**
   - **Pre-Flight**: Parked at departure gate.
   - **Takeoff & Initial Climb**: Runway acceleration, rotation ($V_r$), gear retraction, initial climb-out.
   - **Climb**: Ascending through flight levels to cruising altitude.
   - **Cruise**: Steady high-speed flight along the Great Circle arc.
   - **Approach Decision Alert**: When approaching destination (Top of Descent), triggers an alert prompting the user to **"CLEAR FOR LANDING"**.
   - **Descent & Final Approach**: Deceleration to approach speed ($V_{ref}$), alignment with destination runway heading, glideslope descent.
   - **Touchdown & Rollout**: Runway touchdown, reverse thrust, wheel braking to stop.
   - **Flight Debrief**: Summary of total distance flown, sim flight time, average ground speed, and cruise altitude.

4. **Avionics Cockpit HUD**
   - Primary Flight Display (PFD) instruments: Altitude tape (FT / FL), Airspeed (KTS / km/h), Mach number, Heading bearing, Vertical Speed Indicator (ft/min).
   - Time Warp simulation multipliers: 1x, 5x, 10x, 25x, 50x, 100x, 250x, 500x.
   - Auto-Land failsafe switch for high-warp cruising.

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ or 20+
- npm or pnpm

### Run Development Server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) (or the port indicated in terminal) in your browser.

### Production Build
```bash
npm run build
npm run start
```
