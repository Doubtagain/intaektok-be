import { Module } from '@nestjs/common';
import { MessagesModule } from '../messages/messages.module';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [MessagesModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
