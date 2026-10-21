import { NextRequest, NextResponse } from 'next/server';

const OPENSKY_STATES_URL = 'https://opensky-network.org/api/states/all';
const MAX_BBOX_AREA = 25;
const UPSTREAM_TIMEOUT_MS = 15_000;

function parseBound(value: string | null, min: number, max: number): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const lamin = parseBound(searchParams.get('lamin'), -90, 90);
  const lamax = parseBound(searchParams.get('lamax'), -90, 90);
  const lomin = parseBound(searchParams.get('lomin'), -180, 180);
  const lomax = parseBound(searchParams.get('lomax'), -180, 180);

  if (
    lamin === null ||
    lamax === null ||
    lomin === null ||
    lomax === null ||
    lamax <= lamin ||
    lomax <= lomin
  ) {
    return NextResponse.json({ error: 'Invalid bounding box' }, { status: 400 });
  }

  if ((lamax - lamin) * (lomax - lomin) > MAX_BBOX_AREA) {
    return NextResponse.json({ error: 'Bounding box too large' }, { status: 400 });
  }

  const upstreamParams = new URLSearchParams({
    lamin: lamin.toFixed(4),
    lomin: lomin.toFixed(4),
    lamax: lamax.toFixed(4),
    lomax: lomax.toFixed(4),
  });

  try {
    const upstream = await fetch(`${OPENSKY_STATES_URL}?${upstreamParams.toString()}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    const headers = new Headers({ 'Cache-Control': 'no-store' });
    for (const name of ['x-rate-limit-remaining', 'x-rate-limit-retry-after-seconds']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }

    if (!upstream.ok) {
      return NextResponse.json(
        { error: 'OpenSky request failed' },
        { status: upstream.status, headers }
      );
    }

    const payload = await upstream.json();
    return NextResponse.json(payload, { headers });
  } catch {
    return NextResponse.json(
      { error: 'OpenSky is unavailable' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
