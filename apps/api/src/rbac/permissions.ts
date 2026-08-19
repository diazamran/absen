/**
 * RBAC - daftar permission per role.
 * Penerapan ganda:
 *  1. Middleware: memeriksa permission key pada route.
 *  2. Service layer: membatasi scope baris (mis. guru hanya kelasnya sendiri).
 * SUPER_ADMIN melewati semua pemeriksaan.
 */

export const PERMISSION_KEYS = {
  dashboardView: 'dashboard:view',
  studentsRead: 'students:read',
  studentsCreate: 'students:create',
  studentsUpdate: 'students:update',
  studentsDelete: 'students:delete',
  studentsImport: 'students:import',
  usersRead: 'users:read',
  usersCreate: 'users:create',
  usersUpdate: 'users:update',
  usersDelete: 'users:delete',
  parentsRead: 'parents:read',
  classesManage: 'classes:manage',
  scheduleRead: 'schedule:read',
  scheduleManage: 'schedule:manage',
  attendanceCreate: 'attendance:create',
  attendanceManage: 'attendance:manage',
  attendanceRead: 'attendance:read',
  leaveCreate: 'leave:create',
  leaveApprove: 'leave:approve',
  leaveRead: 'leave:read',
  leaveDelete: 'leave:delete',
  journalCreate: 'journal:create',
  journalRead: 'journal:read',
  reportsRead: 'reports:read',
  exportCreate: 'export:create',
  notificationsRead: 'notifications:read',
  notificationsSend: 'notifications:send',
  devicesManage: 'devices:manage',
  auditRead: 'audit:read',
  settingsManage: 'settings:manage',
  faceRegister: 'face:register',
  faceApprove: 'face:approve',
  faceDelete: 'face:delete',
  monitorView: 'monitor:view',
} as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[keyof typeof PERMISSION_KEYS];

export const ROLE_KEYS = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  HEADMASTER: 'HEADMASTER',
  HOMEROOM_TEACHER: 'HOMEROOM_TEACHER',
  TEACHER: 'TEACHER',
  STAFF: 'STAFF',
  PIKET: 'PIKET',
  STUDENT: 'STUDENT',
  PARENT: 'PARENT',
} as const;

export type RoleKey = (typeof ROLE_KEYS)[keyof typeof ROLE_KEYS];

const ALL = Object.values(PERMISSION_KEYS);

const ROLE_PERMISSIONS: Record<RoleKey, PermissionKey[]> = {
  SUPER_ADMIN: [...ALL],
  ADMIN: [...ALL],
  HEADMASTER: [
    PERMISSION_KEYS.dashboardView,
    PERMISSION_KEYS.studentsRead,
    PERMISSION_KEYS.usersRead,
    PERMISSION_KEYS.scheduleRead,
    PERMISSION_KEYS.attendanceRead,
    PERMISSION_KEYS.leaveRead,
    PERMISSION_KEYS.journalRead,
    PERMISSION_KEYS.reportsRead,
    PERMISSION_KEYS.exportCreate,
    PERMISSION_KEYS.notificationsRead,
    PERMISSION_KEYS.auditRead,
    PERMISSION_KEYS.monitorView,
  ],
  HOMEROOM_TEACHER: [
    PERMISSION_KEYS.dashboardView,
    PERMISSION_KEYS.studentsRead,
    PERMISSION_KEYS.scheduleRead,
    PERMISSION_KEYS.attendanceRead,
    PERMISSION_KEYS.attendanceManage,
    PERMISSION_KEYS.leaveRead,
    PERMISSION_KEYS.leaveApprove,
    PERMISSION_KEYS.journalCreate,
    PERMISSION_KEYS.journalRead,
    PERMISSION_KEYS.reportsRead,
    PERMISSION_KEYS.exportCreate,
    PERMISSION_KEYS.notificationsRead,
    PERMISSION_KEYS.faceRegister,
    PERMISSION_KEYS.monitorView,
  ],
  TEACHER: [
    PERMISSION_KEYS.dashboardView,
    PERMISSION_KEYS.studentsRead,
    PERMISSION_KEYS.scheduleRead,
    PERMISSION_KEYS.attendanceCreate,
    PERMISSION_KEYS.attendanceRead,
    PERMISSION_KEYS.leaveCreate,
    PERMISSION_KEYS.journalCreate,
    PERMISSION_KEYS.journalRead,
    PERMISSION_KEYS.notificationsRead,
    PERMISSION_KEYS.faceRegister,
    PERMISSION_KEYS.monitorView,
  ],
  STAFF: [
    PERMISSION_KEYS.dashboardView,
    PERMISSION_KEYS.attendanceCreate,
    PERMISSION_KEYS.leaveCreate,
    PERMISSION_KEYS.notificationsRead,
    PERMISSION_KEYS.faceRegister,
  ],
  PIKET: [
    // Petugas Piket: menjaga gerbang (absen siswa wajah/QR/kartu), absen manual & koreksi absen siswa, cetak laporan, approve izin
    PERMISSION_KEYS.dashboardView,
    PERMISSION_KEYS.studentsRead,
    PERMISSION_KEYS.scheduleRead,
    PERMISSION_KEYS.attendanceCreate,
    PERMISSION_KEYS.attendanceManage,
    PERMISSION_KEYS.attendanceRead,
    PERMISSION_KEYS.leaveCreate,
    PERMISSION_KEYS.leaveRead,
    PERMISSION_KEYS.leaveApprove,
    PERMISSION_KEYS.reportsRead,
    PERMISSION_KEYS.exportCreate,
    PERMISSION_KEYS.notificationsRead,
    PERMISSION_KEYS.faceRegister,
    PERMISSION_KEYS.monitorView,
  ],
  STUDENT: [
    PERMISSION_KEYS.dashboardView,
    PERMISSION_KEYS.attendanceCreate,
    PERMISSION_KEYS.leaveCreate,
    PERMISSION_KEYS.scheduleRead,
    PERMISSION_KEYS.notificationsRead,
    PERMISSION_KEYS.faceRegister,
  ],
  PARENT: [
    PERMISSION_KEYS.dashboardView,
    PERMISSION_KEYS.attendanceRead,
    PERMISSION_KEYS.notificationsRead,
  ],
};

export function roleHasPermission(roleKey: string, permission: PermissionKey): boolean {
  if (roleKey === ROLE_KEYS.SUPER_ADMIN) return true;
  const perms = ROLE_PERMISSIONS[roleKey as RoleKey];
  return !!perms && perms.includes(permission);
}

/** Daftar permission untuk seed tabel Permission/RolePermission. */
export function seedPermissionEntries() {
  return Object.entries(PERMISSION_KEYS).map(([name, key]) => ({
    key,
    name,
    module: key.split(':')[0],
  }));
}

export function rolePermissionKeys(roleKey: string): PermissionKey[] {
  if (roleKey === ROLE_KEYS.SUPER_ADMIN) return [...ALL];
  return ROLE_PERMISSIONS[roleKey as RoleKey] ?? [];
}

/** Nama role dalam Bahasa Indonesia untuk tampilan. */
export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  HEADMASTER: 'Kepala Sekolah',
  HOMEROOM_TEACHER: 'Wali Kelas',
  TEACHER: 'Guru',
  STAFF: 'Staff',
  PIKET: 'Petugas Piket',
  STUDENT: 'Siswa',
  PARENT: 'Orang Tua',
};
