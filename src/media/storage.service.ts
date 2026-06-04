import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * S3-compatible object storage (AWS S3 in prod, MinIO locally). All client
 * access goes through presigned URLs; the bucket itself stays private
 * (spec §11: presigned-only, block direct bucket access).
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly cdnBaseUrl: string;
  private readonly publicEndpoint: string;

  constructor(private readonly config: ConfigService) {
    const s3 = this.config.get('s3') as {
      endpoint: string;
      publicEndpoint: string;
      bucket: string;
      accessKey: string;
      secretKey: string;
      region: string;
      forcePathStyle: boolean;
    };
    this.bucket = s3.bucket;
    this.publicEndpoint = s3.publicEndpoint;
    this.cdnBaseUrl = this.config.get<string>('cdnBaseUrl') ?? '';
    this.client = new S3Client({
      endpoint: s3.endpoint,
      region: s3.region,
      forcePathStyle: s3.forcePathStyle,
      credentials: { accessKeyId: s3.accessKey, secretAccessKey: s3.secretKey },
    });
  }

  /** Presigned PUT URL for the client to upload directly to storage. */
  getUploadUrl(key: string, contentType: string, expiresSec = 600): Promise<string> {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.client, cmd, { expiresIn: expiresSec });
  }

  /** Presigned GET URL for downloading a private object. */
  getDownloadUrl(key: string, expiresSec = 3600): Promise<string> {
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, cmd, { expiresIn: expiresSec });
  }

  /**
   * Public URL via CDN when configured, otherwise a path-style URL against the
   * storage endpoint (objects must be CDN/public-readable for this to work).
   */
  buildPublicUrl(key: string): string {
    if (this.cdnBaseUrl) {
      return `${this.cdnBaseUrl.replace(/\/$/, '')}/${key}`;
    }
    return `${this.publicEndpoint.replace(/\/$/, '')}/${this.bucket}/${key}`;
  }

  get hasCdn(): boolean {
    return !!this.cdnBaseUrl;
  }

  /**
   * Read URL for an object intended to be *displayed* (avatars, thumbnails):
   *  - CDN_BASE_URL set  -> public CDN/custom-domain URL (bucket served publicly).
   *  - otherwise         -> presigned GET, so the bucket can stay fully private.
   */
  getReadUrl(key: string, expiresSec = 3600): Promise<string> {
    if (this.cdnBaseUrl) return Promise.resolve(this.buildPublicUrl(key));
    return this.getDownloadUrl(key, expiresSec);
  }

  async headObject(key: string): Promise<{ contentLength?: number; contentType?: string } | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { contentLength: res.ContentLength, contentType: res.ContentType };
    } catch (err) {
      this.logger.debug(`headObject(${key}) failed: ${(err as Error).message}`);
      return null;
    }
  }
}
