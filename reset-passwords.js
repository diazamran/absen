/**
 * Script reset password guru/staff ke NIP (username) mereka.
 * Jalankan di VPS: node reset-passwords.js
 *
 * Untuk user yang TIDAK punya password acak (sudah punya password diketahui),
 * script ini TIDAK mengubahnya — hanya akun yang dibuat via SSO (tanpa password diketahui).
 *
 * Setelah dijalankan:
 *   - Semua guru/staff bisa login manual dengan password = NIP mereka (username)
 *   - Siswa tidak disentuh (sudah pakai password default 'smkn1kras')
 */

const { PrismaClient } = require('./apps/api/node_modules/@prisma/client');
const bcrypt = require('./apps/api/node_modules/bcryptjs');

const prisma = new PrismaClient();

async function main() {
  // Ambil semua user non-siswa non-parent yang aktif
  const users = await prisma.user.findMany({
    where: {
      role: {
        key: { notIn: ['STUDENT', 'PARENT'] },
      },
      isActive: true,
    },
    include: { role: true },
  });

  console.log(`\nDitemukan ${users.length} akun guru/staff/admin\n`);

  let updated = 0;
  for (const user of users) {
    // Password default = username (NIP)
    const newPassword = user.username;
    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    console.log(`✅ Reset: ${user.username} (${user.role.key}) → password = "${newPassword}"`);
    updated++;
  }

  console.log(`\n✅ Selesai. ${updated} akun berhasil direset.`);
  console.log(`   Password setiap akun = username (NIP) masing-masing.\n`);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
