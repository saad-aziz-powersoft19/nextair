export type FlightPlanImportFormat = 'icao' | 'simbrief' | 'route';

export interface FlightPlanImportResult {
  format: FlightPlanImportFormat;
  originCode: string | null;
  destinationCode: string | null;
  aircraftType: string | null;
  cruiseAltitudeFt: number | null;
  flightNumber: string | null;
  routeTokens: string[];
  warnings: string[];
}

const ROUTE_LABEL_PATTERN = /^\s*(?:ROUTE|RTE|RTE\s*\/\s*ROUTE)\s*[:=]?\s*(.*)$/i;
const SECTION_LABEL_PATTERN = /^[A-Z][A-Z0-9 /_-]{2,}:\s*$/;
const ROUTE_SECTION_STOP_PATTERN =
  /^(?:WAYPOINTS?|IDENT|LAT|LONG|LONGITUDE|FREQ|FREQUENCY|TRK|TRACK|DIST|DISTANCE|ALT|ALTITUDE|ETE|FUEL|TOTAL|TIME|FLIGHT\s+LEVEL)\b/;
const SPEED_LEVEL_PATTERN = /^(?:N|M|K)\d{3,4}F\d{2,3}$/;
const FLIGHT_LEVEL_PATTERN = /^FL\d{2,3}$/;
const RUNWAY_PATTERN = /^(?:RWY?\d{2}[LCR]?|\d{2}[LCR])$/;
const PSEUDO_TOKENS = new Set(['DCT', 'SID', 'STAR', 'IFR', 'VFR', 'ROUTE', 'RTE', 'OFP']);

function extractFlightLevel(value: string): number | null {
  const direct = /\bFL\s?(\d{2,3})\b/.exec(value);
  if (direct) {
    const level = Number(direct[1]);
    if (level >= 100 && level <= 600) return level * 100;
  }
  const speedLevel = /\b(?:N|M|K)\d{3,4}F(\d{3})\b/.exec(value);
  if (speedLevel) {
    const level = Number(speedLevel[1]);
    if (level >= 100 && level <= 600) return level * 100;
  }
  const encoded = /\bF(\d{3})\b/.exec(value);
  if (encoded) {
    const level = Number(encoded[1]);
    if (level >= 100 && level <= 600) return level * 100;
  }
  const altitude = /(?:CRZ|CRUISE|ALTITUDE|ALT)\s*(?:ALT|FL)?\s*[:=]?\s*(\d{4,5})\b/.exec(
    value
  );
  if (altitude) {
    return Number(altitude[1]);
  }
  return null;
}

function extractAirportPair(value: string): { origin: string | null; destination: string | null } {
  const pairMatches = Array.from(
    value.matchAll(/(?:^|\n)\s*([A-Z]{4})\/[A-Z]{3}\b/g),
    (match) => match[1]
  );
  if (pairMatches.length >= 2) {
    return { origin: pairMatches[0], destination: pairMatches[1] };
  }

  const originMatch = /(?:^|\n)\s*(?:ORIGIN|DEPARTURE|FROM|DEP)\s*[:=]?\s*([A-Z]{4})\b/.exec(
    value
  );
  const destinationMatch =
    /(?:^|\n)\s*(?:DESTINATION|DEST|ARRIVAL|ARR|TO)\s*[:=]?\s*([A-Z]{4})\b/.exec(value);
  return {
    origin: originMatch?.[1] ?? null,
    destination: destinationMatch?.[1] ?? null,
  };
}

function extractRouteSection(value: string): string | null {
  const lines = value.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const labelMatch = ROUTE_LABEL_PATTERN.exec(lines[i]);
    if (!labelMatch) continue;

    const routeLines: string[] = [];
    const inline = labelMatch[1].trim();
    if (inline) routeLines.push(inline);

    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j].trim();
      if (!line) {
        if (routeLines.length > 0) break;
        continue;
      }
      if (
        SECTION_LABEL_PATTERN.test(line) ||
        ROUTE_SECTION_STOP_PATTERN.test(line) ||
        /^\[.*\]$/.test(line) ||
        /[a-z]/.test(line)
      ) {
        break;
      }
      routeLines.push(line);
    }
    return routeLines.join(' ');
  }
  return null;
}

function parseIcaoFlightPlan(value: string): {
  originCode: string | null;
  destinationCode: string | null;
  aircraftType: string | null;
  cruiseAltitudeFt: number | null;
  flightNumber: string | null;
  routeText: string | null;
} | null {
  const start = value.search(/\bFPL-/);
  if (start === -1) return null;

  let body = value.slice(start);
  const closeIndex = body.indexOf(')');
  if (closeIndex !== -1) body = body.slice(0, closeIndex);

  const fields = body
    .split('-')
    .map((field) => field.trim())
    .filter(Boolean);
  if (fields.length < 4) return null;

  const aircraftIndex = fields.findIndex(
    (field, index) => index > 1 && /^[A-Z0-9]{2,4}\/[A-Z]$/.test(field)
  );
  const searchStart = aircraftIndex === -1 ? 2 : aircraftIndex + 1;
  const originIndex = fields.findIndex(
    (field, index) => index >= searchStart && /^[A-Z]{4}\d{0,4}$/.test(field)
  );
  if (originIndex === -1) return null;

  const originCode = fields[originIndex].slice(0, 4);
  const routeField = fields[originIndex + 1] ?? '';
  const destinationField = fields[originIndex + 2] ?? '';
  const destinationCode = /^[A-Z]{4}\d{0,4}$/.test(destinationField)
    ? destinationField.slice(0, 4)
    : fields
        .slice(originIndex + 2)
        .find((field) => /^[A-Z]{4}\d{0,4}$/.test(field))
        ?.slice(0, 4) ?? null;
  const aircraftType = aircraftIndex === -1 ? null : fields[aircraftIndex].split('/')[0];
  const callsign = fields[1] ?? '';
  const flightNumber = /^[A-Z]{2,3}\d{1,4}[A-Z]?$/.test(callsign) ? callsign : null;

  return {
    originCode,
    destinationCode,
    aircraftType,
    cruiseAltitudeFt: extractFlightLevel(`${fields[originIndex + 1] ?? ''} ${value}`),
    flightNumber,
    routeText: routeField || null,
  };
}

export function normalizeRouteTokens(value: string): string[] {
  const tokens = value
    .toUpperCase()
    .replace(/\b(?:ROUTE(?:\s+ID)?|RTE|OFP)\s*[:=]/g, ' ')
    .replace(/[→>,;()[\]{}]/g, ' ')
    .replace(/\//g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/[^A-Z0-9]/g, ''))
    .filter((token) => token.length >= 2 && token.length <= 12)
    .filter(
      (token) =>
        !PSEUDO_TOKENS.has(token) &&
        !SPEED_LEVEL_PATTERN.test(token) &&
        !FLIGHT_LEVEL_PATTERN.test(token) &&
        !RUNWAY_PATTERN.test(token)
    );

  return tokens;
}

export function parseFlightPlanText(value: string): FlightPlanImportResult {
  const normalized = value.replace(/\r/g, '\n').trim().toUpperCase();
  const warnings: string[] = [];
  if (!normalized) {
    return {
      format: 'route',
      originCode: null,
      destinationCode: null,
      aircraftType: null,
      cruiseAltitudeFt: null,
      flightNumber: null,
      routeTokens: [],
      warnings: ['Paste a flight plan or route before importing.'],
    };
  }

  const icao = parseIcaoFlightPlan(normalized);
  const routeSection = icao ? null : extractRouteSection(normalized);
  const isSimbrief =
    routeSection !== null ||
    /\bSIMBRIEF\b|\bOFP\b/.test(normalized) ||
    /(?:^|\n)\s*(?:AIRCRAFT|ORIGIN|DESTINATION|CALLSIGN)\s*[:=]/.test(normalized);

  let format: FlightPlanImportFormat = 'route';
  let originCode: string | null = null;
  let destinationCode: string | null = null;
  let aircraftType: string | null = null;
  let cruiseAltitudeFt = extractFlightLevel(normalized);
  let flightNumber: string | null = null;
  let routeText: string | null = null;

  if (icao) {
    format = 'icao';
    originCode = icao.originCode;
    destinationCode = icao.destinationCode;
    aircraftType = icao.aircraftType;
    cruiseAltitudeFt = icao.cruiseAltitudeFt ?? cruiseAltitudeFt;
    flightNumber = icao.flightNumber;
    routeText = icao.routeText;
    if (!routeText) warnings.push('ICAO flight plan did not contain a route field.');
  } else {
    format = isSimbrief ? 'simbrief' : 'route';
    const pair = extractAirportPair(normalized);
    originCode = pair.origin;
    destinationCode = pair.destination;

    const aircraftMatch =
      /(?:AIRCRAFT(?:\s+TYPE)?|A\/C(?:\s+TYPE)?|TYPE)\s*[:=]?\s*([A-Z0-9-]{2,12})/.exec(
        normalized
      );
    aircraftType = aircraftMatch?.[1] ?? null;

    const flightMatch =
      /(?:FLIGHT(?:\s+NUMBER|\s+NO)?|FLT(?:\s+NO)?|CALLSIGN)\s*[:=]?\s*([A-Z]{2,3}\d{1,4}[A-Z]?)/.exec(
        normalized
      );
    flightNumber = flightMatch?.[1] ?? null;

    if (routeSection !== null) {
      routeText = routeSection;
    } else if (isSimbrief) {
      warnings.push('No ROUTE section was found in the SimBrief/OFP text.');
    } else {
      routeText = normalized;
    }
  }

  const routeTokens = routeText ? normalizeRouteTokens(routeText) : [];
  if (routeTokens.length === 0) {
    warnings.push('No usable route fixes were detected.');
  }
  if (originCode && destinationCode && originCode === destinationCode) {
    warnings.push('Origin and destination are identical.');
  }

  return {
    format,
    originCode,
    destinationCode,
    aircraftType,
    cruiseAltitudeFt,
    flightNumber,
    routeTokens,
    warnings,
  };
}
