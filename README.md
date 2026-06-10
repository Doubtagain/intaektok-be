# 인택톡(Intaktok) Backend

폐쇄형(closed) 실시간 채팅 플랫폼 백엔드. 등록(화이트리스트)된 사용자만 카카오 로그인으로 이용하며, 1:1 + 그룹 채팅, 미디어/움짤, 푸시 알림을 제공합니다.

> **이번 버전 정책**: 기능 구현 우선을 위해 **종단간 암호화(E2EE)는 전역적으로 제외**. 메시지 본문은 서버에 평문 저장되며, 전송 구간 TLS + 저장 구간 at-rest 암호화 + 엄격한 접근 제어(IDOR 방지)로 보호합니다. 그룹 채팅은 P0 필수 기능입니다.

스택: **NestJS 10 · TypeScript 5 · PostgreSQL 16(Prisma 5) · Redis 7 · Socket.IO 4 · JWT · S3/MinIO · FCM**

---

## 1. 빠른 시작 (로컬)

```bash
# 1) 의존성 설치
npm install

# 2) 환경변수 준비
cp .env.example .env      # Windows(PowerShell): Copy-Item .env.example .env

# 3) 인프라 기동 (postgres / redis / minio + 버킷 생성)
docker compose up -d postgres redis minio createbuckets

# 4) DB 마이그레이션 + 클라이언트 생성 + 시드
npm run prisma:generate
npm run prisma:migrate     # 최초 마이그레이션 이름 입력 (예: init)
npm run db:seed            # 화이트리스트 시드(로컬 로그인용)

# 5) 서버 실행
npm run start:dev
```

- API: `http://localhost:3000/api/v1`
- Swagger 문서: `http://localhost:3000/docs`
- Health: `GET /health` (liveness), `GET /ready` (DB·Redis 확인)
- WebSocket: `ws://localhost:3000/ws` (Socket.IO, `auth: { token }`)

### Docker로 전체 기동

```bash
docker compose up --build       # app 컨테이너가 migrate deploy 후 기동
```

---

## 2. 프로젝트 구조

```
src/
├── main.ts                 # 부트스트랩(helmet, CORS, ValidationPipe, Swagger, Redis WS 어댑터)
├── app.module.ts           # 모듈 조립(Config/Logger/Throttler/EventEmitter/Jwt + 기능 모듈)
├── config/                 # 환경설정 로더 + 검증
├── common/                 # errors, events, types, guards, filters, decorators, dto
├── prisma/  redis/  presence/   # 인프라 서비스(전역)
├── auth/                   # F1,F2  카카오 로그인 + 화이트리스트 + JWT
├── profile/                # F3     온보딩
├── users/                  # F12    프로필 조회 / 검색
├── rooms/                  # F4,F5  1:1 + 그룹 방, 멤버/권한, 시스템 메시지
├── messages/               # F6,F14 이력/전송(REST 폴백)/삭제, seq, 미읽음·읽음 수
├── realtime/               # F4~F9  Socket.IO Gateway + Redis 어댑터
├── media/                  # F10    presigned 업로드/다운로드, 움짤 메타
├── push/                   # F11    FCM 토큰 + 오프라인 푸시
├── admin/                  # F13    화이트리스트 관리(RBAC, BLOCKED 시 세션 무효화)
└── health/                 # /health, /ready
```

### 아키텍처 메모: 모듈 디커플링

서비스는 **Socket.IO에 직접 접근하지 않습니다.** 도메인 이벤트(`message.created`, `message.read`, `message.deleted`, `room.created`, `room.updated`, `session.revoked`)를 `EventEmitter2`로 발행하고, **`RealtimeGateway`가 유일한 브로드캐스터**로서 `@OnEvent`으로 구독해 WebSocket으로 팬아웃합니다. `PushService`도 같은 `message.created` 이벤트를 구독해 오프라인 수신자에게 FCM을 보냅니다. 덕분에 `messages`/`rooms` 모듈은 실시간 의존성이 전혀 없고(게이트웨이 ↔ 서비스 순환참조 없음), 추후 **E2EE 도입 시 `messages`/`media`의 본문 저장 로직만 교체**하면 됩니다. (메시지 영속은 `MessagesService.createMessage` 한 곳에 모여 있음)

실시간 전달은 각 소켓이 자신의 개인 룸 `user:{userId}`에만 join하고, 브로드캐스트는 대상 멤버들의 개인 룸 합집합으로 보냅니다(Redis 어댑터가 노드 간 라우팅, Socket.IO가 중복 제거). 신규 입장 멤버도 룸 join 타이밍에 의존하지 않고 즉시 수신합니다.

---

## 3. 인증 플로우 (카카오 OAuth)

1. 클라이언트가 카카오 SDK로 로그인 → `kakaoAccessToken` 획득
2. `POST /api/v1/auth/kakao { kakaoAccessToken }`
3. 서버가 **카카오 `/v2/user/me`로 토큰을 직접 검증**(클라이언트 입력 불신뢰) → `kakaoId` 확보
4. `Whitelist(kakaoId)` 확인
   - 없음/`BLOCKED` → `403 { code: "NOT_ALLOWED" }`
   - `INVITED` → `User` 생성 + `Whitelist.status=ACTIVE`
   - `ACTIVE` → 정상 로그인
5. `{ accessToken, refreshToken, user, isOnboarded }` 반환. `isOnboarded=false`면 온보딩 화면으로.

- **Access Token**: 30분, payload `{ sub, type:"access" }`
- **Refresh Token**: 30일, **회전(rotation)** 적용, Redis에 `refresh:{userId}:{jti}` 화이트리스트. 재사용 감지 시 전체 세션 무효화.
- WebSocket 핸드셰이크도 Access Token으로 인증.
- 모든 요청에서 `User.status`를 확인하여 `SUSPENDED/DELETED` 계정을 즉시 차단(화이트리스트 BLOCKED 연동).

---

## 4. REST API 요약

`Base: /api/v1` · 인증: `Authorization: Bearer <accessToken>` · 에러: `{ code, message, details }`

| 영역 | 메서드 · 경로 | 비고 |
|---|---|---|
| Auth | `POST /auth/kakao` · `POST /auth/refresh` · `POST /auth/logout` · `GET /auth/me` | 로그인/회전/로그아웃/내정보 |
| Profile | `POST /profile`(온보딩) · `PATCH /profile` | 이미 온보딩 시 `409` |
| Users | `GET /users/search?q=` · `GET /users/:userId/profile` | 등록 사용자만, 같은 룸만 조회 |
| Rooms | `GET /rooms` · `POST /rooms` · `GET /rooms/:id` · `PATCH /rooms/:id` | 1:1 중복 시 기존 방 반환 |
| Members | `POST /rooms/:id/members` · `PATCH /rooms/:id/members/:userId` · `DELETE /rooms/:id/members/:userId` | 그룹 권한별 |
| Messages | `GET /rooms/:id/messages?cursor=&limit=` · `POST /rooms/:id/messages` · `DELETE /rooms/:id/messages/:msgId` · `POST /rooms/:id/read` | 전송은 WS 권장(REST 폴백) |
| Media | `POST /media/upload-url` · `POST /media/:id/complete` · `GET /media/:id` | presigned, 움짤 메타 |
| Push | `POST /push/tokens` · `DELETE /push/tokens/:id` | FCM 토큰 |
| Admin | `POST/GET/PATCH/DELETE /admin/whitelist[/:id]` | RBAC(ADMIN_USER_IDS) |

**페이지네이션(커서)**
- 메시지 이력: `cursor`는 **`seq < cursor`** 인 과거 메시지를 반환. `nextCursor`는 현재 페이지의 가장 오래된 `seq`(다음 호출에 그대로 전달).
- 방 목록: `cursor`는 `lastMessageAt`(ISO) 기준, 최근 활동순.

---

## 5. WebSocket 이벤트

연결: `wss://<host>/ws`, `auth: { token: "<accessToken>" }`. 연결 시 개인 룸 자동 join + presence online.

**Client → Server** (ack 콜백 `{ ok, ... } | { ok:false, error }`)
| 이벤트 | 페이로드 |
|---|---|
| `message:send` | `{ clientMessageId?, roomId, type, content?, mediaId?, replyToId? }` → ack `{ ok, id, seq, createdAt }` |
| `message:read` | `{ roomId, lastReadSeq }` |
| `message:delete` | `{ roomId, messageId }` |
| `typing:start` / `typing:stop` | `{ roomId }` |
| `room:join` | `{ roomId }` (멤버십 확인 ack) |

**Server → Client**
| 이벤트 | 페이로드 |
|---|---|
| `message:new` | 직렬화된 메시지 `{ id, roomId, senderId, seq, type, content?, mediaId?, replyToId?, createdAt, ... }` |
| `message:read` | `{ roomId, userId, lastReadSeq }` |
| `message:deleted` | `{ roomId, messageId }` |
| `typing` | `{ roomId, userId, isTyping }` |
| `presence` | `{ userId, status: "online"\|"offline", lastSeenAt? }` |
| `room:created` / `room:updated` | `{ room }` |
| `error` | `{ code, message }` |

**전달 보장**: `message:send`는 ack로 `seq`를 반환(at-least-once). `clientMessageId`로 멱등 처리(동일 키 재수신 시 기존 메시지 반환, 재브로드캐스트 없음). 오프라인 수신자는 재접속 시 이력 조회로 동기화하며 미읽음 수는 `lastReadSeq`로 계산.

> **설계 결정**: `message:new`는 발신자를 **포함한** 전체 멤버에게 브로드캐스트합니다(발신 소켓은 ack도 받지만, 발신자의 다른 기기는 `message:new`로 동기화 — 멀티 디바이스 일관성). 클라이언트는 `id`/`clientMessageId`로 중복 제거합니다. `readCount`는 §6의 정의대로 **읽은 사람 수**(발신자 제외)이며, 카톡식 "안 읽은 수"는 `(활성 멤버 수 − 1 − readCount)`로 파생합니다.

---

## 6. 시퀀스 · 미읽음/읽음 수

- **seq**: 룸 단위 단조 증가. `Redis INCR room:{roomId}:seq`로 발급(키 미존재 시 DB `max(seq)`로 초기화). 영속 시 `@@unique([roomId, seq])`로 정합성 보장하며, seq 충돌(예: Redis 초기화) 시 DB max로 재동기화 후 재시도.
- **미읽음 수(방 목록)**: 해당 방에서 `seq > 내 lastReadSeq` 이며 삭제되지 않고 **내가 보낸 메시지 제외**한 개수.
- **읽음 수(메시지별 `readCount`)**: 룸 멤버(발신자 제외) 중 `lastReadSeq >= message.seq` 인 멤버 수 = **그 메시지를 읽은 사람 수**. 카톡식 "안 읽은 수"는 `(활성 멤버 수 - 1 - readCount)`로 클라이언트에서 계산.
- 별도 receipts 테이블 없이 `RoomMember.lastReadSeq`만으로 계산.

---

## 7. 그룹 권한 모델

| 액션 | OWNER | ADMIN | MEMBER |
|---|:---:|:---:|:---:|
| 방 정보 수정(name/avatar) | ✅ | ✅ | ❌ |
| 멤버 추가 | ✅ | ✅ | ❌ |
| 역할 변경 | ✅ | ❌ | ❌ |
| 멤버 추방 | 모두(소유자 제외) | MEMBER만 | ❌ |
| 본인 탈퇴 | ✅(소유권 자동 이양) | ✅ | ✅ |

- 생성자는 `OWNER`. `OWNER` 권한 이양 시 기존 소유자는 `ADMIN`으로 강등(소유자는 항상 1명).
- 그룹 생성/입장/퇴장/추방/이름·사진 변경/역할 변경 시 **SYSTEM 메시지** 발행(코드+파라미터 JSON 저장 → 클라이언트가 현지화 렌더링).
- 신규 입장 멤버의 `lastReadSeq`는 현재 head로 설정(이전 전체 이력이 미읽음으로 잡히지 않도록).

---

## 8. 미디어 · 움짤

1. `POST /media/upload-url { mimeType, byteSize, width?, height?, durationMs? }` → `{ mediaId, uploadUrl, storageKey }` (Media 레코드 PENDING 생성)
2. 클라이언트가 `uploadUrl`로 직접 PUT
3. (선택) `POST /media/:id/complete` → 객체 존재 확인 후 READY. 썸네일/메타 추출(sharp/ffmpeg)은 확장 포인트로 비워 둠.
4. 메시지에 `mediaId` 첨부(본인 업로드 미디어만 허용)
5. `GET /media/:id` → 권한 검증 후 메타 + presigned 다운로드 URL

**움짤 자동재생**: 서버는 `mimeType` + `isAnimated`를 제공. `image/gif`, `image/webp`, `image/apng`, 그리고 무음 `video/*`를 자동재생 후보로 표시(`isAnimated=true`). 실제 재생/네트워크 정책(예: Wi-Fi 한정)은 클라이언트 설정.

---

## 9. 환경 변수

`.env.example` 참고. 주요 항목:

| 변수 | 설명 | 기본 |
|---|---|---|
| `DATABASE_URL`, `REDIS_URL` | 필수 연결 문자열 | — |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | JWT 시크릿(운영에서 기본값 금지) | change-me |
| `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL` | 토큰 만료(초) | 1800 / 2592000 |
| `KAKAO_REST_API_KEY` | **선택**(현재 플로우 미사용 — `/v2/user/me` Bearer 검증) | (빈값) |
| `KAKAO_USERINFO_URL` | 카카오 사용자 정보 검증 URL | `/v2/user/me` |
| `S3_*`, `CDN_BASE_URL` | 객체 스토리지/CDN | MinIO 로컬값 |
| `FCM_SERVICE_ACCOUNT_JSON` | FCM 서비스계정 경로(없으면 푸시 no-op) | `./secrets/fcm.json` |
| `ADMIN_USER_IDS` | 관리자 userId 목록(콤마구분) | (빈값) |
| `CORS_ORIGINS` | 허용 오리진 목록 | localhost |

### 합리적 기본값 (모호한 정책 — spec §12.11)

| 정책 | 기본값 | 변수 |
|---|---|---|
| 메시지 삭제(언센드) 허용 시간 | **300초(5분)**, 발신자 본인만 | `MESSAGE_UNSEND_WINDOW_SEC` |
| 미디어 최대 크기 | **50MB** | `MEDIA_MAX_BYTES` |
| presence TTL(heartbeat) | **60초** (서버가 절반 주기로 갱신) | `PRESENCE_TTL_SEC` |
| 레이트 리밋 | 전역 **60초당 120요청**, 로그인 **60초당 10요청** | `THROTTLE_TTL`, `THROTTLE_LIMIT` |
| 푸시 본문 노출 | 발신자/방 이름 + 본문 미리보기(80자) 노출. SYSTEM/뮤트/온라인 수신자는 제외 | — |
| 자동재생 | 서버는 메타만 제공, 정책은 클라이언트 | — |
| 미읽음 계산 | 본인 메시지 및 삭제 메시지 제외 | — |

---

## 10. 보안 체크리스트 매핑

- [x] 보안 헤더(`helmet`), CORS 화이트리스트(`CORS_ORIGINS`) — **운영에서 미설정 시 교차 출처 브라우저 요청 차단(fail-safe)**. TLS는 LB/인프라에서 종단.
- [x] 카카오 토큰을 서버가 카카오 API로 직접 검증(클라이언트 입력 불신뢰).
- [x] 화이트리스트 미등록자 차단(`403 NOT_ALLOWED`), `BLOCKED` 시 사용자 `SUSPENDED` + refresh 무효화 + 소켓 강제 종료.
- [x] JWT 시크릿 환경변수화, refresh **회전 + Redis 화이트리스트**(재사용 감지 시 전체 세션 폐기).
- [x] 룸 멤버만 메시지·미디어 접근(`RoomMemberGuard` = IDOR 방지). 메시지 삭제는 발신자 본인만.
- [x] 미디어는 presigned URL만 허용(버킷 직접 접근은 인프라에서 차단).
- [x] 입력 검증(`class-validator`) + 파일/페이로드 크기 제한.
- [x] 레이트 리밋(`@nestjs/throttler`) — 로그인/전역.
- [x] 그룹 권한 모델 분리(OWNER/ADMIN/MEMBER 액션 검증).
- [x] 운영 로그에서 메시지 본문·인증 헤더 마스킹(`pino` redact).
- [ ] **DB·스토리지 at-rest 암호화**: 관리형 RDS/ElastiCache/S3(SSE)에서 **인프라 설정으로 활성화**(코드 외 책임).

> **운영 인프라**: LB(WebSocket Upgrade 지원, TLS 종단, `/health` 헬스체크) → App 노드 N개(무상태, 오토스케일) → 관리형 PostgreSQL(Multi-AZ, at-rest, 읽기복제) · Redis(클러스터) · S3(SSE, presigned only) · CloudFront. 시크릿은 Secrets Manager/SSM.

---

## 11. 개발 단계 (구현 상태)

| Phase | 내용 | 상태 |
|---|---|---|
| 0 | 부트스트랩(Nest, Prisma, compose, `/health`) | ✅ |
| 1 | 인증 & 화이트리스트(F1,F2) | ✅ |
| 2 | 프로필 온보딩 & 검색(F3,F12) | ✅ |
| 3 | 방 & 메시지 이력(F4,F5,F6,F14) | ✅ |
| 4 | 실시간(F4,F5,F7,F8,F9) | ✅ |
| 5 | 미디어 & 움짤(F10) | ✅ |
| 6 | 푸시(F11) | ✅ |
| 7 | 관리자 & 하드닝(F13 + 보안) | ✅ |

---

## 12. 명령어

```bash
npm run start:dev       # 개발(watch)
npm run build           # 프로덕션 빌드
npm run start:prod      # dist 실행
npm run test            # 유닛 테스트(jest)
npm run lint            # ESLint
npm run prisma:migrate  # 마이그레이션(dev)
npm run prisma:deploy   # 마이그레이션 적용(prod)
npm run prisma:studio   # Prisma Studio
npm run db:seed         # 화이트리스트 시드
```

---

## 13. E2EE 후속 과제 메모

본 설계는 메시지/미디어 모듈 경계를 명확히 분리했습니다. E2EE 도입 시:
- `MessagesService.createMessage`의 본문 저장을 **디바이스별 암호문(envelope) + 키 교환(prekey)** 모델로 교체
- 서버 측 미리보기(`preview`)/검색을 클라이언트로 이전
- `media`의 평문 메타/썸네일 추출 제거

트랜스포트(`realtime`), 라우팅, 권한 모델은 그대로 재사용 가능합니다.

---

## 14. Railway 배포

Railway는 앱 컨테이너 + **PostgreSQL/Redis 플러그인**을 제공합니다. 객체 스토리지(S3)와 FCM은 외부 서비스를 사용합니다. 본 레포의 `railway.json`이 Dockerfile 빌드 + 마이그레이션 + 헬스체크를 자동 구성합니다.

### 14.1 한 번에 보기

```
GitHub 레포 → Railway 프로젝트 → PostgreSQL 플러그인 + Redis 플러그인 추가
   → 앱 서비스 환경변수 설정 → 배포(자동 migrate deploy) → 도메인 생성
```

### 14.2 단계

1. **레포 연결**: GitHub에 푸시 → Railway에서 *New Project → Deploy from GitHub repo*. `railway.json`이 `builder: DOCKERFILE`로 빌드를 강제하고 헬스체크는 `/health`. 시작 명령은 **Dockerfile의 `CMD ["sh","-c","npx prisma migrate deploy && node dist/main"]`** 가 담당합니다.
   > ⚠️ Railway의 `deploy.startCommand`는 **셸로 해석되지 않으므로** `&&` 체이닝을 넣으면 안 됩니다(첫 명령에 나머지가 인자로 통째로 넘어감). 셸 체이닝이 필요하면 Dockerfile CMD처럼 명시적으로 `sh -c`로 감싸야 합니다.
2. **DB/Redis 추가**: 프로젝트에 *New → Database → PostgreSQL*, *New → Database → Redis* 추가.
3. **연결 변수 와이어링** (앱 서비스 → Variables). Railway 참조 변수 문법 사용(플러그인 실제 이름에 맞게):
   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   REDIS_URL=${{Redis.REDIS_URL}}
   ```
4. **필수 환경변수** (앱 서비스 → Variables):
   ```
   NODE_ENV=production
   JWT_ACCESS_SECRET=<openssl rand -hex 32>             # 직접 생성한 랜덤 시크릿
   JWT_REFRESH_SECRET=<openssl rand -hex 32>            # 위와 다른 값
   CORS_ORIGINS=https://your-frontend.example.com      # 웹 클라이언트 도메인(모바일은 불필요)
   ADMIN_USER_IDS=<관리자 userId 콤마구분>              # 최초 로그인 후 채움
   # 객체 스토리지 = Cloudflare R2 (아래 14.3)
   S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   S3_PUBLIC_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
   S3_BUCKET=intaktok-media   S3_ACCESS_KEY=...   S3_SECRET_KEY=...   S3_REGION=auto
   S3_FORCE_PATH_STYLE=true   CDN_BASE_URL=             # 비우면 아바타도 presigned(권장)
   # 선택
   KAKAO_REST_API_KEY=                                 # 현재 플로우 미사용(선택)
   FCM_SERVICE_ACCOUNT=<service-account JSON을 base64 인코딩>   # base64 -w0 fcm.json
   ```
   > **PORT는 Railway가 자동 주입**합니다 — 직접 설정하지 마세요. 앱은 `0.0.0.0:$PORT`로 바인딩합니다.

5. **배포**: 매 배포 시 `prisma migrate deploy`가 먼저 실행되어 마이그레이션이 적용됩니다(`prisma/migrations/`의 베이스라인 포함). Prisma는 advisory lock을 사용하므로 다중 인스턴스에서도 안전합니다.
6. **도메인 생성**: 앱 서비스 → *Settings → Networking → Generate Domain*. 이후:
   - REST: `https://<domain>/api/v1`
   - Swagger: `https://<domain>/docs`
   - WebSocket: `wss://<domain>/ws`
   - Health: `https://<domain>/health`

### 14.3 객체 스토리지 — Cloudflare R2 (권장)

Railway에는 S3가 없으므로 **Cloudflare R2**를 사용합니다(S3 호환 → 코드 변경 불필요, env만 설정).

**R2 준비 (Cloudflare 대시보드)**
1. R2 → *Create bucket* → 이름 `intaktok-media`.
2. R2 → *Manage R2 API Tokens* → *Create API token* (Object Read & Write) → **Access Key ID / Secret Access Key** 발급.
3. 계정 ID 확인 → S3 엔드포인트: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.

**Railway 앱 서비스 환경변수**
```
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_PUBLIC_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_BUCKET=intaktok-media
S3_ACCESS_KEY=<R2 Access Key ID>
S3_SECRET_KEY=<R2 Secret Access Key>
S3_REGION=auto
S3_FORCE_PATH_STYLE=true
CDN_BASE_URL=                # 비움 → 아바타/썸네일도 presigned로 안전하게 서빙(권장)
```

**아바타/썸네일 서빙 동작 (코드 반영됨)**
- `CDN_BASE_URL`이 **비어 있으면**: 메시지 미디어뿐 아니라 **아바타/썸네일도 presigned GET**으로 내려갑니다 → 버킷을 **완전 private**으로 둘 수 있음(가장 안전, 기본 권장). presigned URL은 기본 1시간 만료라 목록은 클라이언트가 주기적으로 다시 받으면 됩니다.
- 공개 CDN으로 아바타를 서빙하고 싶으면: R2 *Public access(r2.dev)* 또는 커스텀 도메인을 켜고 `CDN_BASE_URL`을 그 도메인으로 설정. 단, 이 경우 버킷이 키만 알면 공개 읽기 가능해져 **메시지 미디어도 공개**되는 트레이드오프가 있습니다.

> R2는 egress 무료이고 SSE(at-rest 암호화)가 기본입니다. 웹에서 브라우저 직접 업로드(presigned PUT)를 쓰면 R2 버킷 **CORS**에 프론트 오리진을 허용하세요.

### 14.4 WebSocket / 스케일링 메모

- Railway는 WebSocket을 지원합니다(동일 포트). 단일 인스턴스(`numReplicas: 1`, 기본값)에서는 추가 설정 불필요.
- **다중 인스턴스로 확장 시**: Railway는 sticky session을 보장하지 않으므로, Socket.IO 초기 long-poll 핸드셰이크가 인스턴스 간에 깨질 수 있습니다. 클라이언트에서 `io(url, { transports: ['websocket'] })`로 **websocket 전용**을 사용하세요. 노드 간 브로드캐스트는 Redis 어댑터가 이미 처리합니다. `railway.json`의 `numReplicas`를 올려 확장합니다.

### 14.5 CLI 대안

```bash
npm i -g @railway/cli
railway login
railway link            # 기존 프로젝트 연결
railway up              # 현재 디렉터리 빌드/배포
railway variables --set NODE_ENV=production   # 변수 설정 예시
```

> **시크릿 주의**: `.env`/`secrets/`는 절대 커밋하지 않습니다(`.gitignore`/`.dockerignore`로 제외됨). 모든 비밀은 Railway Variables로 주입하세요. FCM은 파일 대신 `FCM_SERVICE_ACCOUNT`(base64)로 주입합니다.
