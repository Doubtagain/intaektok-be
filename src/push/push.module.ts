import { Module } from '@nestjs/common';
import { PushController } from './push.controller';
import { PushService } from './push.service';
import { FcmService } from './fcm.service';

@Module({
  controllers: [PushController],
  providers: [PushService, FcmService],
  exports: [PushService],
})
export class PushModule {}
