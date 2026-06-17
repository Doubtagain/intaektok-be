/**
 * Single source of truth for the HTTP global prefix, shared by the runtime
 * server (main.ts) and the OpenAPI exporter (openapi.ts) so the generated spec
 * paths (e.g. /api/v1/auth/kakao) match the live routes exactly.
 *
 * health/ready are intentionally excluded so PaaS probes hit them at the root.
 */
export const GLOBAL_API_PREFIX = 'api/v1';
export const GLOBAL_PREFIX_EXCLUDE = ['health', 'ready'];
