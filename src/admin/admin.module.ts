import { Module } from '@nestjs/common';
import { AccessRequestController } from './access-request.controller';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  controllers: [AdminController, AccessRequestController],
  providers: [AdminService],
})
export class AdminModule {}
