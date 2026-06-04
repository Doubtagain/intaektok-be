/**
 * SYSTEM message payloads are stored as JSON in Message.content so clients can
 * render localized text. We also derive a short server-side preview for pushes.
 */
export type SystemMessagePayload =
  | { code: 'ROOM_CREATED'; actorId: string }
  | { code: 'MEMBER_JOINED'; actorId: string; targetIds: string[] }
  | { code: 'MEMBER_LEFT'; actorId: string }
  | { code: 'MEMBER_KICKED'; actorId: string; targetId: string }
  | { code: 'ROOM_RENAMED'; actorId: string; name: string }
  | { code: 'ROOM_AVATAR_CHANGED'; actorId: string }
  | { code: 'ROLE_CHANGED'; actorId: string; targetId: string; role: string };

export function systemPreview(payload: SystemMessagePayload): string {
  switch (payload.code) {
    case 'ROOM_CREATED':
      return '채팅방이 생성되었습니다.';
    case 'MEMBER_JOINED':
      return '새로운 멤버가 입장했습니다.';
    case 'MEMBER_LEFT':
      return '멤버가 퇴장했습니다.';
    case 'MEMBER_KICKED':
      return '멤버가 내보내졌습니다.';
    case 'ROOM_RENAMED':
      return `방 이름이 '${payload.name}'(으)로 변경되었습니다.`;
    case 'ROOM_AVATAR_CHANGED':
      return '방 사진이 변경되었습니다.';
    case 'ROLE_CHANGED':
      return '멤버 권한이 변경되었습니다.';
    default:
      return '시스템 메시지';
  }
}
