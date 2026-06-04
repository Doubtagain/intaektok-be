/** Authenticated principal attached to requests / sockets after JWT verification. */
export interface AuthUser {
  userId: string;
}

/** JWT access-token payload. */
export interface AccessTokenPayload {
  sub: string;
  type: 'access';
}

/** JWT refresh-token payload. */
export interface RefreshTokenPayload {
  sub: string;
  type: 'refresh';
  jti: string;
}
