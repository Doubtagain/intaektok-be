import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Errors } from '../common/errors';

export interface KakaoUserInfo {
  kakaoId: string;
  nickname?: string;
  profileImageUrl?: string;
}

/**
 * Talks to Kakao's OAuth endpoints. Two responsibilities:
 *   1. exchangeCodeForToken — swap a short-lived, single-use authorization code
 *      (standard OAuth redirect flow / Kakao SDK v2) for a Kakao access token
 *      server-side, using the app's REST API key (+ optional client secret).
 *      The secret never reaches the browser.
 *   2. getUserInfo — resolve that access token to a Kakao identity via
 *      /v2/user/me (spec §5.3: never trust client-supplied identity).
 * Abstracted so tests can substitute a fake implementation.
 */
@Injectable()
export class KakaoService {
  private readonly logger = new Logger(KakaoService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Exchanges an authorization code for a Kakao access token.
   * @param code        single-use code from Kakao's redirect callback
   * @param redirectUri MUST byte-match the redirect_uri used to obtain the code
   */
  async exchangeCodeForToken(code: string, redirectUri: string): Promise<string> {
    const url = this.config.get<string>('kakao.tokenUrl')!;
    const restApiKey = this.config.get<string>('kakao.restApiKey')!;
    const clientSecret = this.config.get<string>('kakao.clientSecret') ?? '';

    if (!restApiKey) {
      // Server misconfiguration, not a client error — fail loudly in logs.
      this.logger.error('KAKAO_REST_API_KEY is not set — cannot exchange authorization code.');
      throw Errors.unauthorized('카카오 로그인 설정이 올바르지 않습니다.');
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: restApiKey,
      redirect_uri: redirectUri,
      code,
    });
    if (clientSecret) body.set('client_secret', clientSecret);

    let res: globalThis.Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
        body: body.toString(),
      });
    } catch (err) {
      this.logger.error(`Kakao token request failed: ${(err as Error).message}`);
      throw Errors.unauthorized('카카오 인증에 실패했습니다.');
    }

    const data = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!res.ok || !data.access_token) {
      // Kakao returns 4xx + { error, error_description } for expired/reused codes
      // or a redirect_uri mismatch. Log the cause (never the code) for diagnosis.
      this.logger.warn(
        `Kakao token exchange failed (status=${res.status}, error=${data.error ?? 'unknown'}: ${data.error_description ?? ''})`,
      );
      throw Errors.unauthorized('유효하지 않거나 만료된 카카오 인가 코드입니다.');
    }

    return data.access_token;
  }

  async getUserInfo(kakaoAccessToken: string): Promise<KakaoUserInfo> {
    const url = this.config.get<string>('kakao.userInfoUrl')!;
    let res: globalThis.Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${kakaoAccessToken}`,
          'Content-type': 'application/x-www-form-urlencoded;charset=utf-8',
        },
      });
    } catch (err) {
      this.logger.error(`Kakao userinfo request failed: ${(err as Error).message}`);
      throw Errors.unauthorized('카카오 인증에 실패했습니다.');
    }

    if (!res.ok) {
      this.logger.warn(`Kakao userinfo returned ${res.status}`);
      throw Errors.unauthorized('유효하지 않은 카카오 토큰입니다.');
    }

    const data = (await res.json()) as {
      id?: number | string;
      kakao_account?: { profile?: { nickname?: string; profile_image_url?: string } };
      properties?: { nickname?: string; profile_image?: string };
    };

    if (data.id === undefined || data.id === null) {
      throw Errors.unauthorized('카카오 사용자 정보를 확인할 수 없습니다.');
    }

    const profile = data.kakao_account?.profile;
    return {
      kakaoId: String(data.id),
      nickname: profile?.nickname ?? data.properties?.nickname,
      profileImageUrl: profile?.profile_image_url ?? data.properties?.profile_image,
    };
  }
}
