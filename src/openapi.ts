import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { GLOBAL_API_PREFIX, GLOBAL_PREFIX_EXCLUDE } from './global-prefix';
import { buildOpenApiDocument } from './swagger';

/**
 * Standalone OpenAPI spec exporter — writes openapi.json without booting the
 * HTTP server.
 *
 * Infra-free by design: NestFactory.create() runs provider *constructors* but
 * NOT lifecycle hooks (onModuleInit), so PrismaService.$connect never fires and
 * no database/Redis needs to be reachable. Only a valid .env (DATABASE_URL,
 * REDIS_URL present) is required to satisfy env validation.
 *
 * Run the COMPILED output (`node dist/openapi.js`) so the @nestjs/swagger CLI
 * plugin metadata — DTO types + JSDoc descriptions — is baked in, matching the
 * runtime /docs exactly. See the `openapi:export` npm script.
 */
async function exportSpec(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  // Mirror main.ts so the exported paths carry the /api/v1 prefix (parity with
  // the live /docs-json). setGlobalPrefix is config-only; no init() needed.
  app.setGlobalPrefix(GLOBAL_API_PREFIX, { exclude: GLOBAL_PREFIX_EXCLUDE });
  const document = buildOpenApiDocument(app);
  const outPath = resolve(process.cwd(), 'openapi.json');
  writeFileSync(outPath, JSON.stringify(document, null, 2) + '\n', 'utf8');
  // eslint-disable-next-line no-console
  console.log(`[openapi] wrote ${outPath} (${Object.keys(document.paths).length} paths)`);
  // Hard-exit: a background Redis (re)connection attempt keeps the event loop
  // alive, so process.exit avoids a hang. We never init()'d, so there is no
  // graceful shutdown to perform.
  process.exit(0);
}

exportSpec().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[openapi] export failed:', err);
  process.exit(1);
});
