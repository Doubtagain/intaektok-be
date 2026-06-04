import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ActiveMembership } from '../guards/room-member.guard';

/** Injects req.roomMember populated by RoomMemberGuard. */
export const RoomMembership = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ActiveMembership => {
    return ctx.switchToHttp().getRequest().roomMember;
  },
);
