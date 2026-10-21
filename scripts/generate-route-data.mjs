import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const DATA_DIR = process.argv[2] || path.join(ROOT, '.route-data');

const EARTH_RADIUS_KM = 6371.0;
const CORRIDOR_KM = 110;
const MIN_TERMINAL_MARGIN_KM = 100;
const MIN_FIX_SPACING_KM = 300;
const MAX_ENROUTE_FIXES = 14;
const PREVIEW_PAIRS = [
  ['KHI', 'DXB'],
  ['JFK', 'LHR'],
  ['SYD', 'LAX'],
];

const NAV_TYPES = new Set(['VOR', 'VOR-DME', 'VORTAC', 'TACAN']);

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function centralAngle(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(toRad(lat1)) * Math.cos(toRad(lat2));
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceKm(lat1, lng1, lat2, lng2) {
  return centralAngle(lat1, lng1, lat2, lng2) * EARTH_RADIUS_KM;
}

function bearingDeg(lat1, lng1, lat2, lng2) {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLambda = toRad(lng2 - lng1);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function crossTrackKm(pLat, pLng, aLat, aLng, bLat, bLng) {
  const d13 = centralAngle(aLat, aLng, pLat, pLng);
  const theta13 = toRad(bearingDeg(aLat, aLng, pLat, pLng));
  const theta12 = toRad(bearingDeg(aLat, aLng, bLat, bLng));
  const dxt = Math.asin(Math.sin(d13) * Math.sin(theta13 - theta12));
  return dxt * EARTH_RADIUS_KM;
}

function alongTrackKm(pLat, pLng, aLat, aLng, bLat, bLng) {
  const d13 = centralAngle(aLat, aLng, pLat, pLng);
  const dxt = crossTrackKm(pLat, pLng, aLat, aLng, bLat, bLng) / EARTH_RADIUS_KM;
  const ratio = Math.min(1, Math.max(-1, Math.cos(d13) / Math.cos(dxt)));
  const bearingDiff =
    ((bearingDeg(aLat, aLng, pLat, pLng) - bearingDeg(aLat, aLng, bLat, bLng) + 540) % 360) - 180;
  const sign = Math.abs(bearingDiff) > 90 ? -1 : 1;
  return sign * Math.acos(ratio) * EARTH_RADIUS_KM;
}

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function readLines(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
}

const airportsSrc = fs.readFileSync(path.join(ROOT, 'lib', 'airports.ts'), 'utf8');
const airports = [...airportsSrc.matchAll(/code:\s*'([A-Z]{3})',[\s\S]*?lat:\s*(-?[\d.]+),\s*lng:\s*(-?[\d.]+),/g)].map(
  (match) => ({ code: match[1], lat: Number(match[2]), lng: Number(match[3]) })
);
if (airports.length < 30) {
  throw new Error(`Only parsed ${airports.length} airports from lib/airports.ts`);
}

const airlinesByIata = new Map();
for (const line of readLines(path.join(DATA_DIR, 'airlines.dat'))) {
  const fields = parseCsvLine(line);
  const name = fields[1];
  const iata = fields[3];
  const active = fields[7];
  if (name && iata && iata !== '\\N' && /^[A-Z0-9]{2}$/.test(iata) && active === 'Y') {
    airlinesByIata.set(iata, name);
  }
}

const airportCodes = new Set(airports.map((a) => a.code));
const routesByPair = new Map();
for (const line of readLines(path.join(DATA_DIR, 'routes.dat'))) {
  const fields = parseCsvLine(line);
  const airlineCode = fields[0];
  const src = fields[2];
  const dst = fields[4];
  const stops = fields[7];
  if (stops !== '0') continue;
  if (!airportCodes.has(src) || !airportCodes.has(dst) || src === dst) continue;
  if (!airlinesByIata.has(airlineCode)) continue;
  const key = [src, dst].sort().join('-');
  if (!routesByPair.has(key)) routesByPair.set(key, new Set());
  routesByPair.get(key).add(airlineCode);
}

const navaidsRaw = readLines(path.join(DATA_DIR, 'navaids.csv'));
const header = parseCsvLine(navaidsRaw[0]);
const col = (name) => header.indexOf(name);
const idx = {
  ident: col('ident'),
  name: col('name'),
  type: col('type'),
  lat: col('latitude_deg'),
  lng: col('longitude_deg'),
  country: col('iso_country'),
};

const candidates = [];
let typeCounts = {};
for (const line of navaidsRaw.slice(1)) {
  const fields = parseCsvLine(line);
  const type = fields[idx.type];
  typeCounts[type] = (typeCounts[type] || 0) + 1;
  if (!NAV_TYPES.has(type)) continue;
  const lat = Number(fields[idx.lat]);
  const lng = Number(fields[idx.lng]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
  candidates.push({
    ident: fields[idx.ident],
    name: fields[idx.name],
    type,
    country: fields[idx.country],
    lat: Math.round(lat * 1000) / 1000,
    lng: Math.round(lng * 1000) / 1000,
  });
}

const selected = new Map();
for (let i = 0; i < airports.length; i += 1) {
  for (let j = i + 1; j < airports.length; j += 1) {
    const a = airports[i];
    const b = airports[j];
    const total = distanceKm(a.lat, a.lng, b.lat, b.lng);
    if (total < 2 * MIN_TERMINAL_MARGIN_KM) continue;
    const spacing = Math.max(MIN_FIX_SPACING_KM, total / MAX_ENROUTE_FIXES);
    const hits = [];
    for (const nav of candidates) {
      const xt = crossTrackKm(nav.lat, nav.lng, a.lat, a.lng, b.lat, b.lng);
      if (Math.abs(xt) > CORRIDOR_KM) continue;
      const at = alongTrackKm(nav.lat, nav.lng, a.lat, a.lng, b.lat, b.lng);
      if (at < MIN_TERMINAL_MARGIN_KM || at > total - MIN_TERMINAL_MARGIN_KM) continue;
      hits.push({ nav, at });
    }
    hits.sort((x, y) => x.at - y.at);
    let lastAt = -Infinity;
    let kept = 0;
    for (const hit of hits) {
      if (kept >= MAX_ENROUTE_FIXES) break;
      if (hit.at - lastAt < spacing) continue;
      selected.set(`${hit.nav.ident}|${hit.nav.lat}|${hit.nav.lng}`, hit.nav);
      lastAt = hit.at;
      kept += 1;
    }
  }
}

const navaids = [...selected.values()].sort((x, y) => (x.ident < y.ident ? -1 : x.ident > y.ident ? 1 : 0));

function previewRoute(aCode, bCode) {
  const a = airports.find((airport) => airport.code === aCode);
  const b = airports.find((airport) => airport.code === bCode);
  if (!a || !b) return `${aCode}->${bCode}: airport missing`;
  const total = distanceKm(a.lat, a.lng, b.lat, b.lng);
  const spacing = Math.max(MIN_FIX_SPACING_KM, total / MAX_ENROUTE_FIXES);
  const hits = [];
  for (const nav of navaids) {
    const xt = crossTrackKm(nav.lat, nav.lng, a.lat, a.lng, b.lat, b.lng);
    if (Math.abs(xt) > CORRIDOR_KM) continue;
    const at = alongTrackKm(nav.lat, nav.lng, a.lat, a.lng, b.lat, b.lng);
    if (at < MIN_TERMINAL_MARGIN_KM || at > total - MIN_TERMINAL_MARGIN_KM) continue;
    hits.push({ nav, at });
  }
  hits.sort((x, y) => x.at - y.at);
  let lastAt = -Infinity;
  const kept = [];
  for (const hit of hits) {
    if (kept.length >= MAX_ENROUTE_FIXES) break;
    if (hit.at - lastAt < spacing) continue;
    kept.push(`${hit.nav.ident}@${Math.round(hit.at)}`);
    lastAt = hit.at;
  }
  return `${aCode}->${bCode} (${Math.round(total)}km): ${kept.join(' ')}`;
}
for (const [a, b] of PREVIEW_PAIRS) console.log(previewRoute(a, b));

const realRoutes = {};
for (const [key, codes] of [...routesByPair.entries()].sort()) {
  realRoutes[key] = [...codes]
    .sort()
    .map((code) => ({ code, name: airlinesByIata.get(code) }));
}

const navRows = navaids
  .map(
    (n) =>
      `  { ident: '${n.ident}', name: ${JSON.stringify(n.name)}, type: '${n.type}', country: '${n.country}', lat: ${n.lat}, lng: ${n.lng} },`
  )
  .join('\n');

const navOut = `// Generated by scripts/generate-route-data.mjs from OurAirports navaids data (public domain).
// Do not edit manually. Run: node scripts/generate-route-data.mjs <navdata-dir>

export interface NavAid {
  ident: string;
  name: string;
  type: string;
  country: string;
  lat: number;
  lng: number;
}

export const NAVAIDS: NavAid[] = [
${navRows}
];
`;

const routeRows = Object.entries(realRoutes)
  .map(([key, airlines]) => {
    const list = airlines
      .map((a) => `{ code: '${a.code}', name: ${JSON.stringify(a.name)} }`)
      .join(', ');
    return `  '${key}': [${list}],`;
  })
  .join('\n');

const routeOut = `// Generated by scripts/generate-route-data.mjs from OpenFlights routes/airlines data.
// Do not edit manually. Run: node scripts/generate-route-data.mjs <navdata-dir>

export interface RealRouteAirline {
  code: string;
  name: string;
}

export const REAL_ROUTES: Record<string, RealRouteAirline[]> = {
${routeRows}
};
`;

fs.mkdirSync(path.join(ROOT, 'lib', 'data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'lib', 'data', 'navaids.ts'), navOut);
fs.writeFileSync(path.join(ROOT, 'lib', 'data', 'realRoutes.ts'), routeOut);

console.log(`Airports parsed: ${airports.length}`);
console.log(`Navaid type counts (raw):`, typeCounts);
console.log(`Pruned navaids: ${navaids.length}`);
console.log(`Real route pairs: ${Object.keys(realRoutes).length}`);
console.log(
  `Sample pairs:`,
  Object.entries(realRoutes)
    .slice(0, 5)
    .map(([k, v]) => `${k} (${v.map((a) => a.code).join(',')})`)
    .join(' | ')
);
console.log(`navaids.ts: ${navOut.length} bytes`);
console.log(`realRoutes.ts: ${routeOut.length} bytes`);
