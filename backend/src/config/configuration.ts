/**
 * Typed application configuration.
 * All values come from environment variables validated by env.validation.ts.
 */
export default () => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.APP_PORT ?? '3001', 10),
    frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  },

  database: {
    url: process.env.DATABASE_URL,
  },

  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD ?? '',
    tls: process.env.REDIS_TLS === 'true',
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },

  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL ?? '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
  },

  tesla: {
    clientId: process.env.TESLA_CLIENT_ID,
    clientSecret: process.env.TESLA_CLIENT_SECRET,
    redirectUri: process.env.TESLA_REDIRECT_URI,
    audience: process.env.TESLA_AUDIENCE ?? 'https://fleet-api.prd.na.vn.cloud.tesla.com',
    region: process.env.TESLA_REGION ?? 'na',
    baseUrl: process.env.TESLA_BASE_URL ?? 'https://fleet-api.prd.na.vn.cloud.tesla.com',
  },

  smartcar: {
    clientId: process.env.SMARTCAR_CLIENT_ID,
    clientSecret: process.env.SMARTCAR_CLIENT_SECRET,
    redirectUri: process.env.SMARTCAR_REDIRECT_URI,
    mode: process.env.SMARTCAR_MODE ?? 'simulated',
    baseUrl: process.env.SMARTCAR_BASE_URL ?? 'https://api.smartcar.com/v2.0',
  },

  samsara: {
    apiKey: process.env.SAMSARA_API_KEY,
    baseUrl: process.env.SAMSARA_BASE_URL ?? 'https://api.samsara.com',
  },

  googleMaps: {
    apiKey: process.env.GOOGLE_MAPS_API_KEY,
    geocodingUrl: process.env.GOOGLE_MAPS_GEOCODING_URL ?? 'https://maps.googleapis.com/maps/api/geocode/json',
    directionsUrl: process.env.GOOGLE_MAPS_DIRECTIONS_URL ?? 'https://maps.googleapis.com/maps/api/directions/json',
  },

  sentry: {
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? 'development',
  },

  telematics: {
    syncIntervalMs: parseInt(process.env.TELEMATICS_SYNC_INTERVAL_MS ?? '10000', 10),
    batchSize: parseInt(process.env.TELEMATICS_BATCH_SIZE ?? '10', 10),
  },
});
