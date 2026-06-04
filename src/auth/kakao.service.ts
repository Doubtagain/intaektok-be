import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Errors } from '../common/errors';

export interface KakaoUserInfo {
  kakaoId: string;
  nickname?: string;
  profileImageUrl?: string;
}

/**
 * Verifies Kakao access tokens by calling Kakao's userinfo endpoint directly
 * (spec §5.3: never trust client-supplied identity). Abstracted so tests can
 * substitute a fake implementation.
 */
@Injectable()
export class KakaoService {
  private readonly logger = new Logger(KakaoService.name);

  constructor(private readonly config: ConfigService) {}

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
