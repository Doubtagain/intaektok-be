import { MessageType } from '@prisma/client';
import { SystemMessagePayload, systemPreview } from './system-message';

/** Human-readable one-liner for a message — used in room list & push bodies. */
export function messagePreview(type: MessageType, content: string | null): string {
  switch (type) {
    case MessageType.TEXT:
      return (content ?? '').slice(0, 80);
    case MessageType.IMAGE:
      return '사진';
    case MessageType.GIF:
      return '움짤';
    case MessageType.VIDEO:
      return '동영상';
    case MessageType.FILE:
      return '파일';
    case MessageType.SYSTEM:
      return content ? systemPreview(JSON.parse(content) as SystemMessagePayload) : '시스템 메시지';
    default:
      return '';
  }
}
