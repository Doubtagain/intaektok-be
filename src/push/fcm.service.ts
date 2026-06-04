import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as admin from 'firebase-admin';

export interface PushNotification {
  title: string;
  body: string;
}

/**
 * Firebase Cloud Messaging wrapper. If FCM_SERVICE_ACCOUNT_JSON is absent or
 * unreadable the service degrades to a no-op (logs only) so local/dev runs work
 * without credentials. External integration is hidden behind this interface
 * (spec §12.8) for easy mocking.
 */
@Injectable()
export class FcmService implements OnModuleInit {
  private readonly logger = new Logger(FcmService.name);
  private app: admin.app.App | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const serviceAccount = this.loadServiceAccount();
    if (!serviceAccount) {
      this.logger.warn('FCM disabled (no credentials configured) — push is a no-op.');
      return;
    }
    try {
      this.app = admin.initializeApp(
        { credential: admin.credential.cert(serviceAccount) },
        'intaktok',
      );
      this.logger.log('FCM initialized');
    } catch (err) {
      this.logger.error(`FCM init failed: ${(err as Error).message}`);
      this.app = null;
    }
  }

  /**
   * Resolve credentials from (in order):
   *  1. FCM_SERVICE_ACCOUNT — inline JSON or base64 (preferred on PaaS like Railway)
   *  2. FCM_SERVICE_ACCOUNT_JSON — path to a JSON file (local/dev)
   */
  private loadServiceAccount(): admin.ServiceAccount | null {
    const inline = this.config.get<string>('fcm.serviceAccount');
    if (inline) {
      try {
        const trimmed = inline.trim();
        const json = trimmed.startsWith('{')
          ? trimmed
          : Buffer.from(trimmed, 'base64').toString('utf8');
        return JSON.parse(json) as admin.ServiceAccount;
      } catch (err) {
        this.logger.error(`FCM_SERVICE_ACCOUNT is not valid JSON/base64: ${(err as Error).message}`);
        return null;
      }
    }

    const jsonPath = this.config.get<string>('fcm.serviceAccountJson');
    if (!jsonPath) return null;
    const resolved = path.resolve(jsonPath);
    if (!fs.existsSync(resolved)) {
      this.logger.warn(`FCM service account not found at ${resolved}.`);
      return null;
    }
    return JSON.parse(fs.readFileSync(resolved, 'utf8')) as admin.ServiceAccount;
  }

  get enabled(): boolean {
    return this.app !== null;
  }

  /** Send to many tokens. Returns the tokens that are invalid and should be purged. */
  async sendToTokens(
    tokens: string[],
    notification: PushNotification,
    data: Record<string, string> = {},
  ): Promise<{ invalidTokens: string[] }> {
    if (!this.app || tokens.length === 0) {
      if (!this.app) {
        this.logger.debug(`[FCM no-op] ${notification.title}: ${notification.body} -> ${tokens.length} tokens`);
      }
      return { invalidTokens: [] };
    }

    const res = await this.app.messaging().sendEachForMulticast({
      tokens,
      notification,
      data,
    });

    const invalidTokens: string[] = [];
    res.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error?.code ?? '';
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token'
        ) {
          invalidTokens.push(tokens[i]);
        }
      }
    });
    return { invalidTokens };
  }
}
