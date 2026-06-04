import { PrismaClient, WhitelistStatus } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Seeds a small whitelist so you can sign in during local development.
 * Replace the kakaoIds with your own Kakao member numbers, or use the admin
 * API (POST /api/v1/admin/whitelist) once an admin user exists.
 */
async function main(): Promise<void> {
  const entries = [
    { kakaoId: '1000000001', note: 'seed: admin candidate (add id to ADMIN_USER_IDS after first login)' },
    { kakaoId: '1000000002', note: 'seed: member' },
    { kakaoId: '1000000003', note: 'seed: member' },
  ];

  for (const e of entries) {
    await prisma.whitelist.upsert({
      where: { kakaoId: e.kakaoId },
      update: { note: e.note },
      create: { kakaoId: e.kakaoId, status: WhitelistStatus.INVITED, note: e.note },
    });
  }
  console.log(`Seeded ${entries.length} whitelist entries: ${entries.map((e) => e.kakaoId).join(', ')}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
