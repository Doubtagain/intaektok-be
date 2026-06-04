# 인택톡(Intaktok) 백엔드 구축 지시서

> **목적**: Claude Code가 이 문서를 기반으로 인택톡 백엔드 서비스를 단계별로 구현한다.
> **범위**: 백엔드 API 서버, 실시간 메시징(WebSocket), 인증, 미디어 처리, 인프라 설계.
> **대상 독자**: 구현 에이전트(Claude Code) 및 개발자.
> **이번 버전 정책**: 기능 구현 우선을 위해 **종단간 암호화(E2EE)는 전역적으로 제외**한다. 그룹 채팅은 **필수 기능(P0)** 이다. (E2EE는 후속 과제로 분리)

---

## 0. 한눈에 보는 요약

| 항목 | 내용 |
|---|---|
| 서비스명 | 인택톡 (Intaktok) |
| 유형 | **폐쇄형(closed)** 실시간 채팅 플랫폼 — 등록(화이트리스트)된 사용자만 이용 |
| 핵심 특징 | 카카오 OAuth 로그인, 최초 프로필 온보딩, 1:1 + 그룹 채팅, GIF/움짤 자동 재생 |
| 백엔드 스택 | NestJS(TypeScript) + PostgreSQL + Redis + Socket.IO |
| 실시간 | Socket.IO Gateway + Redis Adapter(수평 확장) |
| 메시지 저장 | **서버 저장(평문 본문 + 메타데이터)** — E2EE 미적용. 전송 구간 TLS, 저장 구간 암호화(at-rest)로 보호 |
| 미디어 | S3 호환 스토리지에 업로드(presigned URL), CDN 배포, 서버 측 썸네일/메타 처리 가능 |
| 푸시 | FCM(Firebase Cloud Messaging) |

> **보안 메모**: E2EE를 제외했으므로 서버는 메시지 본문을 읽을 수 있다. 대신 (1) 전 구간 TLS, (2) DB·스토리지 at-rest 암호화, (3) 엄격한 접근 권한(IDOR 방지)으로 데이터를 보호한다. 향후 E2EE 도입 시 메시지/미디어 모델만 교체하면 되도록 모듈 경계를 깨끗하게 유지한다.

---

## 1. 기능 기획 (Feature Spec)

### 1.1 사용자 여정 (User Journey)

```
[앱 진입] → [카카오 로그인] → [화이트리스트 검증]
   ├─ 미등록 사용자 → 접근 거부(안내 화면)
   └─ 등록 사용자
        ├─ 최초 로그인 → [프로필 온보딩] → [메인(채팅 목록)]
        └─ 재로그인 → [메인(채팅 목록)]
```

### 1.2 기능 목록 (우선순위 포함)

| # | 기능 | 우선순위 | 설명 |
|---|---|---|---|
| F1 | 카카오 OAuth 로그인 | P0 | 카카오 인가/토큰 → 백엔드 토큰 발급 |
| F2 | 화이트리스트 검증 | P0 | 등록된 사용자만 가입/로그인 허용 |
| F3 | 프로필 온보딩 | P0 | 최초 로그인 시 닉네임·아바타·상태메시지 설정 |
| F4 | 1:1 채팅 | P0 | 실시간 메시지 송수신 |
| F5 | **그룹 채팅** | **P0** | 다자간 방, 멤버/권한 관리, 입장·퇴장 시스템 메시지 |
| F6 | 메시지 이력 | P0 | 메시지 페이지네이션 조회(서버 저장) |
| F7 | 읽음 확인 / 미읽음 수 | P1 | 멤버별 `lastReadSeq` 기반 미읽음 수 동기화 |
| F8 | 입력 중 표시(typing) | P2 | 실시간 typing indicator |
| F9 | 온라인 상태(presence) | P2 | online/offline/last_seen |
| F10 | 미디어·움짤 전송 | P1 | 이미지/GIF/WebP/동영상 업로드, 자동 재생 메타데이터 |
| F11 | 푸시 알림 | P1 | FCM 기반 |
| F12 | 연락처/사용자 검색 | P1 | 등록 사용자 범위 내에서만 검색 가능 |
| F13 | 화이트리스트 관리(관리자) | P0 | 사용자 등록/초대/차단 |
| F14 | 메시지 삭제(언센드) | P2 | 발신자 본인 메시지 소프트 삭제, "삭제된 메시지" 표시 |

### 1.3 비기능 요구사항 (Non-functional)

- **확장성**: WebSocket 서버 수평 확장(인스턴스 N개) 지원.
- **가용성**: 무상태(stateless) API 서버 + 외부 세션 스토어(Redis).
- **보안**: 전송 구간 TLS, 저장 구간 at-rest 암호화, 룸 멤버 단위 접근 제어.
- **응답성**: 메시지 전달 지연 p95 < 300ms(동일 리전).
- **데이터 정합성**: 메시지 순서 보장(룸 단위 단조 증가 시퀀스).

---

## 2. 기술 스택 (Tech Stack)

| 레이어 | 선택 | 사유 |
|---|---|---|
| 런타임/언어 | Node.js 20 LTS + TypeScript 5 | 타입 안정성, 생태계 |
| 프레임워크 | NestJS 10 | 모듈 구조, WebSocket Gateway 내장, DI |
| ORM | Prisma 5 | 타입 세이프 스키마, 마이그레이션 |
| RDB | PostgreSQL 16 | 관계형 데이터, JSONB, 인덱싱 |
| 캐시/세션/PubSub | Redis 7 | 세션, Socket.IO 어댑터, presence, 시퀀스 |
| 실시간 | Socket.IO 4 | 재연결, 룸, 어댑터(@socket.io/redis-adapter) |
| 인증 | Passport + JWT(access/refresh) | 표준 토큰 인증 |
| 객체 스토리지 | S3 호환(AWS S3 / MinIO) | 미디어 저장 |
| CDN | CloudFront(또는 동급) | 미디어 배포 |
| 미디어 처리 | sharp(썸네일/메타), 필요 시 ffmpeg(동영상) | 서버 측 썸네일·메타데이터 추출 |
| 푸시 | FCM | 크로스 플랫폼 푸시 |
| 검증/직렬화 | class-validator, class-transformer | DTO 검증 |
| 로깅 | pino + nestjs-pino | 구조적 로깅 |
| 컨테이너 | Docker / Docker Compose(로컬), ECS/K8s(운영) | 배포 일관성 |
| API 문서 | Swagger(@nestjs/swagger) | 자동 OpenAPI |

> **대안 메모**: Java/Spring 선호 시 Spring Boot + Spring WebSocket(STOMP) + Spring Security로 동일 설계 적용 가능. 본 문서는 NestJS 기준으로 작성한다.

---

## 3. 시스템 아키텍처 (System Architecture)

```
                         ┌──────────────┐
   Mobile / Web Client   │   Kakao OAuth │
        │   ▲             └──────┬───────┘
        │   │                    │ (토큰 검증)
        ▼   │                    ▼
   ┌────────────────┐    ┌────────────────────┐
   │  CDN (미디어)   │    │  Load Balancer (TLS) │
   └───────┬────────┘    └──────────┬──────────┘
           │                        │
           │              ┌─────────┴─────────┐
           │              │   API / WS Nodes   │  (NestJS, N개, stateless)
           │              │  REST + Socket.IO  │
           │              └───┬───────────┬────┘
           │                  │           │
   ┌───────▼────────┐  ┌──────▼─────┐  ┌──▼──────────┐
   │ Object Storage │  │ PostgreSQL │  │   Redis      │
   │   (미디어)      │  │ 메시지/메타 │  │ 세션/PubSub  │
   └────────────────┘  └────────────┘  │ /presence    │
                                        │ /시퀀스       │
                                        └──────┬───────┘
                                               │
                                        ┌──────▼───────┐
                                        │  FCM (푸시)   │
                                        └──────────────┘
```

### 3.1 수평 확장 전략

- 모든 API/WS 노드는 **무상태**. 인증 상태는 JWT, 연결 상태는 Redis에 보관.
- Socket.IO는 `@socket.io/redis-adapter`로 노드 간 이벤트 브로드캐스트.
- 같은 룸의 사용자들이 서로 다른 노드에 연결되어 있어도 Redis Pub/Sub로 메시지 라우팅.
- 로드밸런서는 WebSocket(Upgrade)을 지원해야 하며, 핸드셰이크 안정성을 위해 sticky session 권장(어댑터 사용 시 필수는 아님).

---

## 4. 데이터베이스 설계 (Database Design)

> 메시지 본문은 서버에 저장된다(`Message.content`). E2EE는 적용하지 않는다. 그룹 채팅은 단일 메시지를 룸 멤버 전원에게 브로드캐스트하는 방식으로 단순하게 처리한다.

### 4.1 ER 개요

```
users ─1:1─ profiles
  ├─1:N─ room_members ─N:1─ rooms
  ├─1:N─ push_tokens
  └─1:N─ messages (sender)

rooms ─1:N─ messages
messages ─N:1─ media (선택)
whitelist (독립, 가입 검증용)
```

### 4.2 Prisma 스키마 초안

```prisma
// schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum UserStatus {
  ACTIVE
  SUSPENDED
  DELETED
}

enum WhitelistStatus {
  INVITED   // 초대됨, 아직 미가입
  ACTIVE    // 가입 완료
  BLOCKED   // 차단
}

enum RoomType {
  DIRECT    // 1:1
  GROUP     // 그룹
}

enum MemberRole {
  OWNER
  ADMIN
  MEMBER
}

enum MessageType {
  TEXT
  IMAGE
  GIF       // 움짤(자동재생 대상)
  VIDEO
  FILE
  SYSTEM    // 시스템 메시지(입장/퇴장/방 이름 변경 등)
}

model Whitelist {
  id          String          @id @default(cuid())
  kakaoId     String?         @unique  // 카카오 회원번호로 사전 등록
  identifier  String?         // 이메일/전화 등 대체 식별자(선택)
  status      WhitelistStatus @default(INVITED)
  invitedBy   String?         // 초대한 사용자 id
  note        String?
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt

  @@index([status])
}

model User {
  id          String       @id @default(cuid())
  kakaoId     String       @unique          // 카카오 회원번호(고유)
  status      UserStatus   @default(ACTIVE)
  createdAt   DateTime     @default(now())
  lastSeenAt  DateTime?

  profile      Profile?
  memberships  RoomMember[]
  pushTokens   PushToken[]
  sentMessages Message[]    @relation("SentMessages")

  @@index([status])
}

model Profile {
  userId        String   @id
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  nickname      String
  statusMessage String?
  avatarMediaId String?  // 아바타 이미지(Media 참조) 또는 avatarUrl 직접 사용
  onboardedAt   DateTime?  // null이면 온보딩 미완료
  updatedAt     DateTime @updatedAt

  @@index([nickname])
}

model Room {
  id         String       @id @default(cuid())
  type       RoomType
  name       String?      // GROUP에서만 사용
  avatarMediaId String?
  createdBy  String
  createdAt  DateTime     @default(now())
  updatedAt  DateTime     @updatedAt
  lastMessageAt DateTime?  // 목록 정렬용(메시지 저장 시 갱신)

  members    RoomMember[]
  messages   Message[]

  @@index([type])
  @@index([lastMessageAt])
}

model RoomMember {
  roomId      String
  userId      String
  room        Room       @relation(fields: [roomId], references: [id], onDelete: Cascade)
  user        User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  role        MemberRole @default(MEMBER)
  joinedAt    DateTime   @default(now())
  lastReadSeq BigInt     @default(0)  // 마지막으로 읽은 메시지 시퀀스
  mutedUntil  DateTime?
  leftAt      DateTime?              // 그룹 퇴장 시각(이력 보존용, 소프트 탈퇴)

  @@id([roomId, userId])
  @@index([userId])
}

// 메시지: 룸 단위 단조 증가 seq, 본문은 서버 저장
model Message {
  id         String      @id @default(cuid())
  roomId     String
  room       Room        @relation(fields: [roomId], references: [id], onDelete: Cascade)
  senderId   String
  sender     User        @relation("SentMessages", fields: [senderId], references: [id])
  seq        BigInt      // 룸 내 순서 보장(Redis INCR로 발급 후 영속 확정)
  type       MessageType
  content    String?     @db.Text   // 텍스트 본문(TEXT일 때). 시스템 메시지는 코드/파라미터 저장
  mediaId    String?                // 미디어 메시지일 때 참조
  replyToId  String?                // 답장 대상 메시지(선택)
  createdAt  DateTime    @default(now())
  editedAt   DateTime?
  deletedAt  DateTime?              // 소프트 삭제(언센드)

  @@unique([roomId, seq])
  @@index([roomId, createdAt])
  @@index([roomId, seq])
}

model Media {
  id           String   @id @default(cuid())
  uploaderId   String
  storageKey   String   @unique  // 스토리지 객체 키
  mimeType     String            // image/gif, image/webp, video/mp4 등
  byteSize     Int
  width        Int?
  height       Int?
  durationMs   Int?              // 동영상/애니메이션 길이
  isAnimated   Boolean  @default(false) // 자동재생 대상 여부
  thumbnailKey String?           // 서버 생성 썸네일 키(선택)
  createdAt    DateTime @default(now())

  @@index([uploaderId])
}

model PushToken {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  deviceId  String?  // 클라이언트 디바이스 식별(선택, 중복 정리용)
  fcmToken  String   @unique
  platform  String   // ios | android | web
  createdAt DateTime @default(now())

  @@index([userId])
}
```

### 4.3 시퀀스 발급 전략

- 룸 단위 메시지 순서 보장을 위해 `seq`를 단조 증가시킨다.
- 구현 옵션 (택1):
  1. **Redis INCR**: `room:{roomId}:seq` 키로 원자적 증가(권장, 빠름).
  2. **PostgreSQL 트랜잭션**: `SELECT max(seq) ... FOR UPDATE` 후 +1.
- 본 문서는 Redis INCR을 기본으로 한다. 메시지를 DB에 영속한 뒤 seq를 확정하고, 장애 복구 시 DB의 max(seq)로 Redis 카운터를 재동기화한다.

### 4.4 미읽음 수(unread) 계산

- 방 목록의 내 미읽음 수 = 해당 방에서 `seq > 내 lastReadSeq` 인 메시지 개수(SYSTEM/삭제 메시지 정책에 따라 제외 가능).
- 특정 메시지를 "몇 명이 안 읽었는지"(카톡식 숫자) = 룸 멤버 중 `lastReadSeq < message.seq` 인 멤버 수(발신자 제외).
- 별도 receipts 테이블 없이 `RoomMember.lastReadSeq`만으로 계산하여 단순화한다.

---

## 5. 인증 플로우 — 카카오 OAuth (Auth Flow)

### 5.1 토큰 정책

- **Access Token(JWT)**: 만료 30분, 페이로드 `{ sub: userId, type: "access" }`.
- **Refresh Token**: 만료 30일, 회전(rotation) 적용, Redis에 화이트리스트 저장(`refresh:{userId}:{jti}`).
- WebSocket 핸드셰이크는 Access Token으로 인증.

### 5.2 로그인 시퀀스

```
Client                        Backend                       Kakao
  │  카카오 SDK 로그인           │                              │
  │ ───────────────────────────┼───────────────────────────► │
  │  ◄── 카카오 액세스토큰 ──────┼──────────────────────────────│
  │                            │                              │
  │ POST /auth/kakao           │                              │
  │  { kakaoAccessToken }      │                              │
  │ ──────────────────────────►│ 카카오 사용자정보 검증         │
  │                            │ ────────────────────────────►│
  │                            │ ◄── kakaoId, 프로필 ──────────│
  │                            │                              │
  │                            │ 1) Whitelist(kakaoId) 확인    │
  │                            │   - 미등록 → 403 NOT_ALLOWED  │
  │                            │ 2) User upsert                │
  │                            │ 3) JWT 발급                   │
  │ ◄── { accessToken,         │                              │
  │      refreshToken,         │                              │
  │      isOnboarded } ────────│                              │
  │                            │                              │
  │ (isOnboarded=false면 온보딩 화면으로)                       │
```

### 5.3 화이트리스트 검증 규칙

1. 카카오에서 받은 `kakaoId`로 `Whitelist`에서 조회.
2. 레코드 없음 또는 `status=BLOCKED` → `403 { code: "NOT_ALLOWED" }`.
3. `status=INVITED` → `User` 생성 후 `Whitelist.status=ACTIVE`로 갱신.
4. `status=ACTIVE` → 정상 로그인.

> **주의**: 카카오 액세스 토큰은 서버가 카카오 API(`/v2/user/me`)로 직접 검증한다. 클라이언트가 보낸 사용자 정보를 신뢰하지 않는다.

---

## 6. REST API 명세 (REST API Spec)

### 6.1 공통 규약

- Base URL: `/api/v1`
- 인증: `Authorization: Bearer <accessToken>`
- 요청/응답: `application/json` (미디어 업로드 제외)
- 에러 포맷:
  ```json
  { "code": "ERROR_CODE", "message": "사람이 읽는 메시지", "details": {} }
  ```
- 주요 에러 코드: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_ALLOWED`(화이트리스트), `NOT_FOUND`, `VALIDATION_ERROR`, `RATE_LIMITED`, `CONFLICT`.
- 페이지네이션: 커서 기반(`?cursor=<seq|id>&limit=<n>`), 응답에 `nextCursor`.

### 6.2 인증 (Auth)

#### `POST /api/v1/auth/kakao`
카카오 액세스 토큰으로 로그인/가입.

- Request
  ```json
  { "kakaoAccessToken": "string", "device": { "name": "iPhone 15", "platform": "ios" } }
  ```
- Response `200`
  ```json
  {
    "accessToken": "jwt...",
    "refreshToken": "jwt...",
    "user": { "id": "u_123", "kakaoId": "987654" },
    "isOnboarded": false
  }
  ```
- Errors: `403 NOT_ALLOWED`(미등록), `401 UNAUTHORIZED`(카카오 토큰 무효).

#### `POST /api/v1/auth/refresh`
- Request `{ "refreshToken": "jwt..." }`
- Response `200 { "accessToken": "...", "refreshToken": "..." }`(회전)

#### `POST /api/v1/auth/logout`
- Request `{ "refreshToken": "jwt..." }` → 해당 refresh 무효화. Response `204`.

#### `GET /api/v1/auth/me`
- Response `200`
  ```json
  { "id": "u_123", "kakaoId": "987654", "isOnboarded": true,
    "profile": { "nickname": "택이", "statusMessage": "...", "avatarUrl": "..." } }
  ```

### 6.3 프로필/온보딩 (Profile)

#### `POST /api/v1/profile`  *(최초 온보딩)*
- Request
  ```json
  { "nickname": "택이", "statusMessage": "안녕하세요", "avatarMediaId": "m_1" }
  ```
- Response `201` (Profile 객체, `onboardedAt` 설정)
- Note: 이미 온보딩된 사용자가 호출 시 `409 CONFLICT`.

#### `PATCH /api/v1/profile`
- Request(부분 갱신) `{ "nickname"?, "statusMessage"?, "avatarMediaId"? }`
- Response `200`

#### `GET /api/v1/users/{userId}/profile`
- Response `200` (요청자가 같은 룸/연락처인 경우만; 아니면 `403`)

#### `GET /api/v1/users/search?q=<keyword>`
- 등록 사용자(화이트리스트 ACTIVE) 내에서만 닉네임/식별자 검색.
- Response `200 { "items": [ { "id", "nickname", "avatarUrl" } ], "nextCursor": null }`

### 6.4 채팅방 (Rooms)

#### `GET /api/v1/rooms`
내 채팅방 목록(최근 활동순, 미읽음 수 포함).
- Response `200`
  ```json
  {
    "items": [
      { "id": "r_1", "type": "DIRECT", "name": null,
        "members": [ { "userId", "nickname", "avatarUrl", "role" } ],
        "lastMessage": { "seq": 42, "type": "TEXT", "preview": "안녕!", "createdAt": "..." },
        "unreadCount": 3 }
    ],
    "nextCursor": null
  }
  ```
- Note: `preview`는 TEXT면 본문 일부, 미디어면 "사진"/"움짤" 등 타입 라벨.

#### `POST /api/v1/rooms`
방 생성(1:1 또는 그룹). 1:1은 동일 상대 방이 있으면 기존 방 반환.
- Request
  ```json
  { "type": "DIRECT", "memberUserIds": ["u_456"] }
  // 또는
  { "type": "GROUP", "name": "팀 인택", "memberUserIds": ["u_1","u_2"] }
  ```
- Response `201` (Room 객체)
- 제약: 모든 멤버가 화이트리스트 ACTIVE여야 함. 아니면 `403`.
- 그룹 생성 시 생성자는 `OWNER`, 나머지는 `MEMBER`. 생성/입장 시 SYSTEM 메시지 발행.

#### `GET /api/v1/rooms/{roomId}`
- Response `200` (방 상세 + 멤버 목록)

#### `PATCH /api/v1/rooms/{roomId}`  *(그룹, OWNER/ADMIN)*
- Request `{ "name"?, "avatarMediaId"? }` → Response `200` (변경 시 SYSTEM 메시지 발행)

#### `POST /api/v1/rooms/{roomId}/members`  *(그룹, OWNER/ADMIN)*
- Request `{ "userIds": ["u_789"] }` → Response `200` (입장 SYSTEM 메시지 발행)

#### `PATCH /api/v1/rooms/{roomId}/members/{userId}`  *(그룹, OWNER)*
- 역할 변경. Request `{ "role": "ADMIN" }` → Response `200`

#### `DELETE /api/v1/rooms/{roomId}/members/{userId}`
- 본인 탈퇴(`leftAt` 설정) 또는 OWNER/ADMIN 추방. Response `204`. (퇴장 SYSTEM 메시지 발행)

#### `GET /api/v1/rooms/{roomId}/messages?cursor=<seq>&limit=50`
메시지 이력(최신→과거, 커서 페이지네이션).
- Response `200`
  ```json
  {
    "items": [
      { "id": "msg_1", "seq": 41, "senderId": "u_456", "type": "TEXT",
        "content": "안녕!", "mediaId": null, "replyToId": null,
        "createdAt": "...", "editedAt": null, "deletedAt": null,
        "readCount": 2 }
    ],
    "nextCursor": "40"
  }
  ```
- 삭제된 메시지는 `deletedAt != null`, `content=null`로 내려 "삭제된 메시지입니다" 표시.

#### `POST /api/v1/rooms/{roomId}/read`
읽음 위치 갱신.
- Request `{ "lastReadSeq": 42 }` → Response `204` (WS로 `message:read` 브로드캐스트)

### 6.5 메시지 전송/삭제 (REST 폴백)

> 기본 전송은 WebSocket을 사용한다. WS 불가 환경을 위한 REST 폴백 제공.

#### `POST /api/v1/rooms/{roomId}/messages`
- Request
  ```json
  {
    "clientMessageId": "uuid",     // 멱등성 키(중복 전송 방지)
    "type": "GIF",
    "content": null,               // TEXT일 때 본문
    "mediaId": "m_10",             // 미디어 메시지일 때
    "replyToId": null
  }
  ```
- Response `201 { "id": "msg_2", "seq": 43, "createdAt": "..." }`
- 처리: seq 발급 → 영속 → `Room.lastMessageAt` 갱신 → 룸 멤버에게 `message:new` 브로드캐스트.

#### `DELETE /api/v1/rooms/{roomId}/messages/{messageId}`  *(F14, 발신자 본인)*
- 소프트 삭제(`deletedAt` 설정). Response `204` (WS로 `message:deleted` 브로드캐스트)
- 정책(권장): 발신 후 일정 시간(예: 5분) 이내만 허용. 기본값은 README에 명시.

### 6.6 미디어 (Media)

#### `POST /api/v1/media/upload-url`
업로드용 presigned URL 발급.
- Request
  ```json
  { "mimeType": "image/gif", "byteSize": 1048576, "width": 320, "height": 240 }
  ```
- Response `200`
  ```json
  { "mediaId": "m_10", "uploadUrl": "https://...", "storageKey": "media/2026/..." }
  ```
- 흐름: 클라이언트가 `uploadUrl`로 미디어 PUT → 서버가 (선택) 비동기로 썸네일/메타(`isAnimated`, `durationMs`) 추출 → 전송 시 `mediaId`를 메시지에 첨부.

#### `GET /api/v1/media/{mediaId}`
- 권한 검증(요청자가 해당 미디어가 속한 룸 멤버) 후 메타데이터 + 다운로드 URL 반환.
- Response `200`
  ```json
  { "mediaId": "m_10", "url": "https://cdn/...", "thumbnailUrl": "https://cdn/...",
    "mimeType": "image/gif", "isAnimated": true, "width": 320, "height": 240, "durationMs": 1800 }
  ```

> **움짤 자동 재생**: 서버는 `mimeType`과 `isAnimated` 메타데이터를 제공한다. 클라이언트는 `isAnimated=true`(image/gif, image/webp, image/apng, 무음 video/mp4 등)인 미디어를 뷰포트 진입 시 자동 재생한다. 자동 재생 정책(예: Wi-Fi에서만)은 클라이언트 설정.

### 6.7 푸시 토큰 (Push)

#### `POST /api/v1/push/tokens`
- Request `{ "fcmToken": "...", "platform": "android", "deviceId": "d_2" }` → `201`

#### `DELETE /api/v1/push/tokens/{tokenId}` → `204`

### 6.8 관리자 — 화이트리스트 (Admin)

> 관리자 인증은 별도 역할/관리 콘솔로 보호. 운영 정책에 맞게 RBAC 적용.

#### `POST /api/v1/admin/whitelist`
- Request `{ "kakaoId"?: "987654", "identifier"?: "010-...", "note"?: "팀원" }` → `201`

#### `GET /api/v1/admin/whitelist?status=ACTIVE&cursor=&limit=`
- Response `200 { "items": [...], "nextCursor": null }`

#### `PATCH /api/v1/admin/whitelist/{id}`
- Request `{ "status": "BLOCKED" }` → `200` (BLOCKED 시 해당 사용자 세션/refresh 무효화)

#### `DELETE /api/v1/admin/whitelist/{id}` → `204`

---

## 7. WebSocket 이벤트 명세 (Realtime Spec)

### 7.1 연결

- Endpoint: `wss://<host>/ws` (Socket.IO)
- 핸드셰이크 인증: `auth: { token: "<accessToken>" }`
- 연결 성공 시 서버는 사용자의 모든 활성 룸에 자동 join, presence를 online으로 갱신.

### 7.2 클라이언트 → 서버 이벤트

| 이벤트 | 페이로드 | 설명 |
|---|---|---|
| `message:send` | `{ clientMessageId, roomId, type, content?, mediaId?, replyToId? }` | 메시지 전송. ack로 `{ id, seq, createdAt }` 반환 |
| `message:read` | `{ roomId, lastReadSeq }` | 읽음 위치 갱신 |
| `message:delete` | `{ roomId, messageId }` | 본인 메시지 삭제(언센드) |
| `typing:start` | `{ roomId }` | 입력 시작 |
| `typing:stop` | `{ roomId }` | 입력 종료 |
| `room:join` | `{ roomId }` | 신규 방 실시간 구독(방 생성/입장 직후) |

### 7.3 서버 → 클라이언트 이벤트

| 이벤트 | 페이로드 | 설명 |
|---|---|---|
| `message:new` | `{ id, roomId, senderId, seq, type, content?, mediaId?, replyToId?, createdAt }` | 새 메시지 |
| `message:read` | `{ roomId, userId, lastReadSeq }` | 상대 읽음 갱신(미읽음 수 재계산 트리거) |
| `message:deleted` | `{ roomId, messageId }` | 메시지 삭제됨 |
| `typing` | `{ roomId, userId, isTyping }` | 입력 중 표시 |
| `presence` | `{ userId, status: "online"\|"offline", lastSeenAt? }` | 상태 변경 |
| `room:created` | `{ room }` | 새 방 초대됨 |
| `room:updated` | `{ room }` | 방 정보/멤버/권한 변경 |
| `error` | `{ code, message }` | 에러 통지 |

### 7.4 메시지 전달 보장

- `message:send`는 **ack 콜백**으로 영속 결과(`seq`)를 반환(at-least-once).
- 클라이언트는 `clientMessageId`로 멱등 처리(중복 전송 방지). 서버는 동일 `clientMessageId` 재수신 시 기존 메시지를 반환.
- 오프라인 수신자: 메시지는 DB에 저장되어 있으므로 재접속 시 `GET /rooms/{id}/messages`로 동기화. 미읽음 수는 `lastReadSeq`로 계산.
- 발신 후 수신자가 오프라인이면 FCM 푸시 발송(발신자/방 이름 + 본문 미리보기, 정책에 따라 본문 노출 여부 조정).

### 7.5 Presence 구현

- 연결 시 `presence:online:{userId}` 키를 Redis에 TTL과 함께 set, heartbeat로 갱신.
- 연결 종료/TTL 만료 시 offline 처리 + `User.lastSeenAt` 업데이트.
- 다중 연결(여러 기기/탭): 활성 연결이 1개라도 있으면 online.

---

## 8. 인프라 설계 (Infrastructure)

### 8.1 환경 구성

| 환경 | 용도 | 구성 |
|---|---|---|
| local | 개발 | Docker Compose(app, postgres, redis, minio) |
| staging | 통합 테스트 | 운영 축소판 |
| production | 운영 | LB + App(N) + 관리형 Postgres/Redis + S3 + CDN |

### 8.2 로컬 개발 — docker-compose.yml(개요)

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: intaktok
      POSTGRES_USER: intaktok
      POSTGRES_PASSWORD: devpass
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]

  redis:
    image: redis:7
    ports: ["6379:6379"]

  minio:                      # S3 호환 로컬 스토리지
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports: ["9000:9000", "9001:9001"]
    volumes: ["miniodata:/data"]

  app:
    build: .
    env_file: .env
    depends_on: [postgres, redis, minio]
    ports: ["3000:3000"]

volumes:
  pgdata:
  miniodata:
```

### 8.3 운영 토폴로지

- **Load Balancer**: WebSocket(Upgrade) 지원 ALB/NLB. TLS 종단. 헬스체크 `/health`.
- **App 노드**: 컨테이너 N개(ECS Fargate 또는 K8s Deployment). CPU/연결 수 기반 오토스케일.
- **PostgreSQL**: 관리형(RDS/Cloud SQL), Multi-AZ, 자동 백업, **at-rest 암호화 활성화**, 읽기 복제본(이력 조회 부하 분산).
- **Redis**: 관리형(ElastiCache/Memorystore), 세션·Pub/Sub·presence·시퀀스. 클러스터/복제 구성.
- **Object Storage**: S3 버킷(미디어), **at-rest 암호화(SSE)**. 버킷 정책으로 직접 접근 차단, presigned URL만 허용.
- **CDN**: CloudFront로 미디어 배포(presigned 또는 서명 쿠키). 캐시 정책 설정.
- **FCM**: 서버 키로 푸시 발송.
- **시크릿**: Secrets Manager/SSM. `.env`에는 비밀 미커밋.

### 8.4 환경 변수(.env.example)

```dotenv
NODE_ENV=development
PORT=3000

DATABASE_URL=postgresql://intaktok:devpass@localhost:5432/intaktok
REDIS_URL=redis://localhost:6379

JWT_ACCESS_SECRET=change-me
JWT_REFRESH_SECRET=change-me
JWT_ACCESS_TTL=1800
JWT_REFRESH_TTL=2592000

KAKAO_REST_API_KEY=...
KAKAO_USERINFO_URL=https://kapi.kakao.com/v2/user/me

S3_ENDPOINT=http://localhost:9000
S3_BUCKET=intaktok-media
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_REGION=us-east-1
CDN_BASE_URL=

FCM_SERVICE_ACCOUNT_JSON=./secrets/fcm.json

MESSAGE_UNSEND_WINDOW_SEC=300   # 메시지 삭제 허용 시간(초)
```

### 8.5 관측성 & 운영

- **로깅**: pino 구조적 로그. 운영에서 메시지 본문 로깅은 마스킹/비활성(개인정보 보호).
- **메트릭**: 연결 수, 메시지 처리량/지연, DB 커넥션 풀, 큐 적체.
- **헬스체크**: `/health`(liveness), `/ready`(DB·Redis 연결 확인).
- **레이트 리밋**: 로그인·메시지 전송·미디어 업로드에 사용자 단위 제한.

---

## 9. 프로젝트 구조 (Project Structure)

```
intaktok-backend/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── common/                 # 가드, 인터셉터, 필터, 데코레이터
│   │   ├── guards/jwt-auth.guard.ts
│   │   ├── guards/ws-auth.guard.ts
│   │   ├── guards/room-member.guard.ts   # 룸 멤버 권한 검사(IDOR 방지)
│   │   ├── filters/http-exception.filter.ts
│   │   └── pipes/validation.pipe.ts
│   ├── config/                 # 환경설정 로더
│   ├── prisma/prisma.service.ts
│   ├── redis/redis.service.ts
│   ├── auth/                   # F1, F2: 카카오 로그인 + 화이트리스트
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── kakao.service.ts
│   │   └── strategies/jwt.strategy.ts
│   ├── users/                  # 프로필 조회, 검색
│   ├── profile/                # F3: 온보딩
│   ├── rooms/                  # F4, F5: 1:1 + 그룹 방 관리
│   ├── messages/               # F6, F14: 이력, 전송 REST 폴백, 삭제
│   ├── realtime/               # WebSocket Gateway(F4~F9)
│   │   ├── realtime.gateway.ts
│   │   └── realtime.service.ts
│   ├── media/                  # F10: presigned URL, 썸네일/메타
│   ├── push/                   # F11: FCM
│   └── admin/                  # F13: 화이트리스트 관리
├── test/
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── package.json
└── tsconfig.json
```

---

## 10. 개발 단계 (Implementation Phases)

> Claude Code는 아래 순서로 구현하고, 각 단계 종료 시 빌드·테스트·간단한 통합 확인을 거친다.

### Phase 0 — 부트스트랩
- NestJS 프로젝트 생성, TypeScript/ESLint/Prettier 설정.
- Prisma 초기화, `schema.prisma` 작성, 첫 마이그레이션.
- docker-compose(postgres/redis/minio) 기동, `/health` 구현.
- **완료 기준**: 서버 기동 + DB 연결 + 헬스체크 200.

### Phase 1 — 인증 & 화이트리스트 (F1, F2)
- 카카오 토큰 검증(`KakaoService`), 화이트리스트 검증.
- JWT 발급/갱신/로그아웃, `JwtAuthGuard`.
- **완료 기준**: 미등록 → 403, 등록 → 토큰 발급, `/auth/me` 동작.

### Phase 2 — 프로필 온보딩 (F3)
- 온보딩 생성/수정, 미온보딩 가드(주요 API 접근 차단 또는 안내).
- 사용자 검색(화이트리스트 범위).
- **완료 기준**: 온보딩 완료 플로우, `isOnboarded` 정확성.

### Phase 3 — 방 & 메시지 이력 (F4, F5, F6, F14)
- 방 생성(1:1 중복 방지)/목록/상세.
- **그룹**: 멤버 추가/추방/탈퇴, 역할 변경, 입장·퇴장·방 변경 SYSTEM 메시지.
- 메시지 영속, 시퀀스 발급(Redis INCR + 영속 확정), 이력 페이지네이션.
- 미읽음 수/읽음 수 계산, 메시지 소프트 삭제(언센드).
- `RoomMemberGuard`로 룸 접근 권한 검사.
- **완료 기준**: REST로 1:1·그룹 메시지 저장/조회, seq 단조 증가, 미읽음 수 정확.

### Phase 4 — 실시간 (F4, F5, F7, F8, F9)
- Socket.IO Gateway + WS 인증 가드 + Redis 어댑터.
- `message:send`(ack), `message:new`/`message:read`/`message:deleted` 라우팅, typing, presence.
- 그룹 브로드캐스트(룸 멤버 전원에게 전달).
- **완료 기준**: 2개 노드에서 교차 연결된 1:1·그룹 사용자 간 실시간 수신.

### Phase 5 — 미디어 & 움짤 (F10)
- presigned 업로드/다운로드, 미디어 메타데이터(`isAnimated`), 서버 썸네일(선택).
- **완료 기준**: 미디어 업로드 후 메시지 첨부, 다운로드 URL·메타 제공, 움짤 메타 정확.

### Phase 6 — 푸시 (F11)
- 토큰 등록, 오프라인 수신자에게 FCM 발송.
- **완료 기준**: 오프라인 사용자 푸시 수신, 1:1·그룹 모두 동작.

### Phase 7 — 관리자 & 하드닝 (F13 + 보안)
- 화이트리스트 관리 API, RBAC, BLOCKED 시 세션 무효화.
- 레이트 리밋, 입력 검증, 보안 헤더, 로깅 마스킹.
- Swagger 문서 자동화.
- **완료 기준**: 보안 체크리스트(아래) 통과.

---

## 11. 보안 체크리스트 (Security Checklist)

- [ ] 전 구간 TLS, 보안 헤더(helmet) 적용.
- [ ] **DB·스토리지 at-rest 암호화 활성화**(E2EE 미적용에 대한 보완).
- [ ] 카카오 토큰은 서버가 카카오 API로 직접 검증(클라이언트 입력 불신뢰).
- [ ] 화이트리스트 미등록자 가입·로그인 차단, BLOCKED 시 세션/refresh 무효화.
- [ ] JWT 시크릿 환경변수화, refresh 토큰 회전 + Redis 화이트리스트.
- [ ] 권한 검사: 룸 멤버만 메시지·미디어 접근(IDOR 방지). 메시지 삭제는 발신자 본인만.
- [ ] 미디어는 presigned URL만 허용, 버킷 직접 접근 차단.
- [ ] 입력 검증(class-validator) + 페이로드/파일 크기 제한.
- [ ] 레이트 리밋(로그인/전송/업로드) 및 abuse 방지.
- [ ] CORS 화이트리스트 도메인만 허용.
- [ ] 운영 로그에서 메시지 본문·개인정보 마스킹.
- [ ] 그룹 권한 모델 검증(OWNER/ADMIN/MEMBER 액션 분리).

> **후속(E2EE 도입 시)**: 본 설계는 메시지/미디어 모듈을 경계가 분명하게 분리해 둔다. 추후 E2EE가 필요하면 `messages`/`media`의 본문 저장을 디바이스별 암호문(envelope) + 키 교환(prekey) 모델로 교체하고, 서버 측 미리보기/검색 기능을 클라이언트로 이전하면 된다.

---

## 12. 클로드 코드 작업 지침 (Instructions for Claude Code)

1. **Phase 0부터 순서대로** 구현하고, 각 Phase 종료 시 빌드/유닛 테스트/기동 확인을 수행한다.
2. 스키마 변경 시 항상 Prisma 마이그레이션을 생성한다(수동 SQL 금지).
3. **E2EE는 구현하지 않는다.** 메시지 본문은 서버에 저장하되, 메시지/미디어 모듈은 향후 암호화 도입을 위해 경계를 명확히 분리한다(본문 저장 로직을 한 곳에 모은다).
4. 모든 보호 엔드포인트에 인증 가드와 룸 멤버 권한 검사를 적용한다(IDOR 방지).
5. 그룹 채팅 권한(OWNER/ADMIN/MEMBER)별 허용 액션을 명확히 구현하고 테스트한다.
6. 환경 의존 값은 `.env`로 분리하고 `.env.example`을 최신으로 유지한다.
7. 새 엔드포인트는 Swagger 데코레이터로 문서화한다.
8. 외부 연동(카카오, FCM, S3)은 인터페이스로 추상화하여 로컬에서 목/대체 구현(MinIO 등)으로 테스트 가능하게 한다.
9. 커밋은 Phase/기능 단위로 작게 나눈다.
10. 의존성 설치·테스트 명령은 npm 기준으로 한다(`npm install`, `npm run test`).
11. 모호한 정책(레이트 리밋 수치, 언센드 허용 시간, 자동재생 정책, 푸시 본문 노출 여부)은 합리적 기본값을 적용하고 README에 명시한다.

---

*문서 버전: v2.0 — 인택톡 백엔드 구축 지시서 (E2EE 제외, 그룹 채팅 P0)*
