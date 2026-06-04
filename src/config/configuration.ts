export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: number; // seconds
    refreshTtl: number; // seconds
  };
  kakao: {
    restApiKey: string;
    userInfoUrl: string;
  };
  s3: {
    endpoint: string;
    publicEndpoint: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
    region: string;
    forcePathStyle: boolean;
  };
  cdnBaseUrl: string;
  fcm: {
    /** Path to a service-account JSON file (local/dev). */
    serviceAccountJson: string;
    /** Inline service-account credentials as raw JSON or base64 (cloud/PaaS). */
    serviceAccount: string;
  };
  policy: {
    messageUnsendWindowSec: number;
    mediaMaxBytes: number;
    presenceTtlSec: number;
  };
  cors: {
    origins: string[];
  };
  throttle: {
    ttl: number;
    limit: number;
  };
  admin: {
    userIds: string[];
  };
}

const toInt = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== '' ? n : fallback;
};

const toList = (v: string | undefined): string[] =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: toInt(process.env.PORT, 3000),
  databaseUrl: process.env.DATABASE_URL ?? '',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'change-me-access',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'change-me-refresh',
    accessTtl: toInt(process.env.JWT_ACCESS_TTL, 1800),
    refreshTtl: toInt(process.env.JWT_REFRESH_TTL, 2592000),
  },
  kakao: {
    restApiKey: process.env.KAKAO_REST_API_KEY ?? '',
    userInfoUrl: process.env.KAKAO_USERINFO_URL ?? 'https://kapi.kakao.com/v2/user/me',
  },
  s3: {
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    publicEndpoint: process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    bucket: process.env.S3_BUCKET ?? 'intaktok-media',
    accessKey: process.env.S3_ACCESS_KEY ?? 'minioadmin',
    secretKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
  },
  cdnBaseUrl: process.env.CDN_BASE_URL ?? '',
  fcm: {
    serviceAccountJson: process.env.FCM_SERVICE_ACCOUNT_JSON ?? '',
    serviceAccount: process.env.FCM_SERVICE_ACCOUNT ?? '',
  },
  policy: {
    messageUnsendWindowSec: toInt(process.env.MESSAGE_UNSEND_WINDOW_SEC, 300),
    mediaMaxBytes: toInt(process.env.MEDIA_MAX_BYTES, 52428800),
    presenceTtlSec: toInt(process.env.PRESENCE_TTL_SEC, 60),
  },
  cors: {
    origins: toList(process.env.CORS_ORIGINS) ,
  },
  throttle: {
    ttl: toInt(process.env.THROTTLE_TTL, 60),
    limit: toInt(process.env.THROTTLE_LIMIT, 120),
  },
  admin: {
    userIds: toList(process.env.ADMIN_USER_IDS),
  },
});
