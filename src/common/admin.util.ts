/**
 * Single source of truth for admin-console RBAC.
 *
 * A principal is an admin when their userId OR kakaoId appears in
 * ADMIN_USER_IDS (config `admin.userIds`). Accepting kakaoId avoids the
 * bootstrap chicken-and-egg (a userId only exists after first login).
 *
 * Shared by AdminGuard (route protection) and GET /auth/me (so the frontend
 * gates its admin UI with the exact rule the backend enforces — no drift).
 */
export function isAdminIdentity(
  adminIds: string[],
  userId: string,
  kakaoId?: string | null,
): boolean {
  if (!adminIds.length || !userId) return false;
  if (adminIds.includes(userId)) return true;
  return !!kakaoId && adminIds.includes(kakaoId);
}
