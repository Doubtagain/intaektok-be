import { MessageType } from '@prisma/client';

/**
 * Decoupling boundary between domain services and the realtime transport.
 *
 * Services NEVER talk to Socket.IO directly. They emit these events via
 * EventEmitter2; RealtimeGateway (the single broadcaster) and PushListener
 * subscribe with @OnEvent and fan out over WebSocket / FCM. This keeps the
 * messages/rooms modules free of any realtime dependency (and avoids the
 * circular import gateway <-> service).
 */
export const DomainEvents = {
  MESSAGE_CREATED: 'message.created',
  MESSAGE_READ: 'message.read',
  MESSAGE_DELETED: 'message.deleted',
  ROOM_CREATED: 'room.created',
  ROOM_UPDATED: 'room.updated',
  SESSION_REVOKED: 'session.revoked',
} as const;

/** Serialized message — identical shape on REST responses and WS `message:new`. */
export interface SerializedMessage {
  id: string;
  roomId: string;
  senderId: string;
  seq: number;
  type: MessageType;
  content: string | null;
  mediaId: string | null;
  replyToId: string | null;
  clientMessageId?: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  readCount?: number;
}

export interface MessageCreatedEvent {
  message: SerializedMessage;
  /** Active members of the room (used for WS routing + push targeting). */
  memberUserIds: string[];
  /** Best-effort human preview for push notifications. */
  preview: string;
  /** Display name for push title (room name or sender nickname). */
  roomTitle: string;
}

export interface MessageReadEvent {
  roomId: string;
  userId: string;
  lastReadSeq: number;
  memberUserIds: string[];
}

export interface MessageDeletedEvent {
  roomId: string;
  messageId: string;
  memberUserIds: string[];
}

export interface RoomLifecycleEvent {
  room: unknown; // serialized room view
  roomId: string;
  memberUserIds: string[];
}

export interface SessionRevokedEvent {
  userId: string;
}
