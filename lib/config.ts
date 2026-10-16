const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';
const maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY || '';

export const APP_CONFIG = {
  appName: process.env.NEXT_PUBLIC_APP_NAME || 'NextAir - Flight Simulator',
  appUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',

  // Default Flight Planning
  defaultOriginCode: process.env.NEXT_PUBLIC_DEFAULT_ORIGIN || 'JFK',
  defaultDestCode: process.env.NEXT_PUBLIC_DEFAULT_DESTINATION || 'LHR',
  defaultAircraftId: process.env.NEXT_PUBLIC_DEFAULT_AIRCRAFT || 'b787-9',
  defaultTimeWarp: Number(process.env.NEXT_PUBLIC_DEFAULT_TIME_WARP) || 25,
  defaultAutoLand: process.env.NEXT_PUBLIC_AUTO_LAND_DEFAULT === 'true',

  // Tile Layers & Map Providers
  tileLayers: {
    // If user provided a Mapbox token, use Mapbox Dark Navigation by default (zero watermarks)
    radarUrl: mapboxToken
      ? `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/256/{z}/{x}/{y}?access_token=${mapboxToken}`
      : maptilerKey
      ? `https://api.maptiler.com/maps/basic-v2/256/{z}/{x}/{y}.png?key=${maptilerKey}`
      : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    satelliteUrl:
      process.env.NEXT_PUBLIC_SATELLITE_TILE_URL ||
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    streetsUrl:
      process.env.NEXT_PUBLIC_STREETS_TILE_URL ||
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  },

  // API Keys for external services
  mapboxToken,
  maptilerKey,
  openWeatherApiKey: process.env.NEXT_PUBLIC_OPENWEATHER_API_KEY || '',
};
