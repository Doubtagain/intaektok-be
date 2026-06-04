import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { MessagesModule } from '../messages/messages.module';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

@Module({
  imports: [MessagesModule, MediaModule],
  controllers: [RoomsController],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class RoomsModule {}
