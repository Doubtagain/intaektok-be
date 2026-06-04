/**
 * Lightweight runtime validation for required environment variables.
 * Fails fast at boot if critical config is missing in production.
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const isProd = (config.NODE_ENV ?? 'development') === 'production';

  const required = ['DATABASE_URL', 'REDIS_URL'];
  const prodRequired = [
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'KAKAO_REST_API_KEY',
    'S3_BUCKET',
  ];

  const missing: string[] = [];
  for (const key of required) {
    if (!config[key]) missing.push(key);
  }
  if (isProd) {
    for (const key of prodRequired) {
      if (!config[key]) missing.push(key);
    }
    if (config.JWT_ACCESS_SECRET === 'change-me-access') {
      missing.push('JWT_ACCESS_SECRET(must not be default in production)');
    }
    if (config.JWT_REFRESH_SECRET === 'change-me-refresh') {
      missing.push('JWT_REFRESH_SECRET(must not be default in production)');
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing/invalid environment variables: ${missing.join(', ')}`);
  }
  return config;
}
