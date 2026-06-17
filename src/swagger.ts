import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

/**
 * Single source of truth for the OpenAPI document. Shared by the runtime HTTP
 * server (main.ts) and the standalone spec exporter (openapi.ts) so the docs
 * UI and the committed openapi.json never drift.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('인택톡(Intaktok) API')
    .setDescription('폐쇄형 실시간 채팅 플랫폼 백엔드 API (v2.0, E2EE 제외)')
    .setVersion('2.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}
