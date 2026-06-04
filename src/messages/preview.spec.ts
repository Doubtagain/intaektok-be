import { MessageType } from '@prisma/client';
import { messagePreview } from './preview';

describe('messagePreview', () => {
  it('returns text content (truncated to 80 chars)', () => {
    expect(messagePreview(MessageType.TEXT, '안녕!')).toBe('안녕!');
    const long = 'x'.repeat(200);
    expect(messagePreview(MessageType.TEXT, long)).toHaveLength(80);
  });

  it('labels media types', () => {
    expect(messagePreview(MessageType.IMAGE, null)).toBe('사진');
    expect(messagePreview(MessageType.GIF, null)).toBe('움짤');
    expect(messagePreview(MessageType.VIDEO, null)).toBe('동영상');
    expect(messagePreview(MessageType.FILE, null)).toBe('파일');
  });

  it('renders SYSTEM payloads', () => {
    const content = JSON.stringify({ code: 'ROOM_RENAMED', actorId: 'u1', name: '팀 인택' });
    expect(messagePreview(MessageType.SYSTEM, content)).toContain('팀 인택');
  });
});
