import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { MediaModule } from '../media/media.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { KakaoService } from './kakao.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { WhitelistBootstrapService } from './whitelist-bootstrap.service';

@Module({
  imports: [PassportModule, MediaModule],
  controllers: [AuthController],
  providers: [AuthService, KakaoService, JwtStrategy, WhitelistBootstrapService],
  exports: [AuthService],
})
export class AuthModule {}
