import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../../components/AppShell';
import { Card, LoadingCard, EmptyState } from '../../lib/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { GraduationCap, AlertTriangle, CheckCircle, XCircle, Clock, TrendingUp, Search } from 'lucide-react';

interface ClassData {
  id: string;
  name: string;
  grade: string;
  major?: { name: string } | null;
  students: Array<{
    id: string;
    nis: string;
    user?: { fullName: string } | null;
    gender: string;
    faceRegistered: boolean;
    isActive: boolean;
  }>;
}

interface AttendanceSummary {
  date: string;
  present: number;
  late: number;
  sick: number;
  excused: number;
  absent: number;
  total: number;
}

interface StudentViolationSummary {
  studentId: string;
  name: string;
  nis: string;
  totalPoints: number;
  totalViolations: number;
}

export default function HomeroomDashboard() {
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));

  // Get my classes (as homeroom teacher)
  const myClasses = useQuery({
    queryKey: ['homeroom-classes'],
    queryFn: () =>
      api<{ success: boolean; data: ClassData[] }>('/classes?homeroomOnly=true').then((r) => r.data),
  });

  // Get attendance summary for selected date
  const attendanceSummary = useQuery({
    queryKey: ['homeroom-attendance', selectedDate],
    queryFn: () => {
      const params = new URLSearchParams({ date: selectedDate });
      return api<{ success: boolean; data: AttendanceSummary }>(`/dashboard/homeroom/attendance?${params}`).then((r) => r.data);
    },
  });

  // Get violation top students
  const violationTop = useQuery({
    queryKey: ['homeroom-violations'],
    queryFn: () =>
      api<{ success: boolean; data: StudentViolationSummary[] }>('/violations/top').then((r) => r.data),
  });

  const firstClass = myClasses.data?.[0];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        title="Dashboard Wali Kelas"
        subtitle={firstClass ? `Kelas: ${firstClass.name}${firstClass.major ? ' - ' + firstClass.major.name : ''}` : 'Ringkasan kelas bimbingan Anda'}
      />

      {/* Date picker */}
      <div className="mb-6 flex items-center gap-3">
        <label className="text-sm text-gray-500">Tanggal:</label>
        <input
          type="date"
          className="border rounded-lg px-3 py-2 text-sm"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          max={today}
        />
      </div>

      {myClasses.isLoading ? (
        <LoadingCard />
      ) : !firstClass ? (
        <EmptyState icon={GraduationCap} title="Tidak ada kelas bimbingan" description="Anda belum ditugaskan sebagai wali kelas" />
      ) : (
        <>
          {/* Stats Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
            <Card className="!p-4 text-center">
              <CheckCircle className="h-6 w-6 text-green-500 mx-auto mb-1" />
              <div className="text-2xl font-bold text-green-600">{attendanceSummary.data?.present ?? 0}</div>
              <div className="text-xs text-gray-500">Hadir</div>
            </Card>
            <Card className="!p-4 text-center">
              <Clock className="h-6 w-6 text-orange-500 mx-auto mb-1" />
              <div className="text-2xl font-bold text-orange-600">{attendanceSummary.data?.late ?? 0}</div>
              <div className="text-xs text-gray-500">Terlambat</div>
            </Card>
            <Card className="!p-4 text-center">
              <AlertTriangle className="h-6 w-6 text-blue-500 mx-auto mb-1" />
              <div className="text-2xl font-bold text-blue-600">{attendanceSummary.data?.sick ?? 0}</div>
              <div className="text-xs text-gray-500">Sakit</div>
            </Card>
            <Card className="!p-4 text-center">
              <TrendingUp className="h-6 w-6 text-purple-500 mx-auto mb-1" />
              <div className="text-2xl font-bold text-purple-600">{attendanceSummary.data?.excused ?? 0}</div>
              <div className="text-xs text-gray-500">Izin</div>
            </Card>
            <Card className="!p-4 text-center">
              <XCircle className="h-6 w-6 text-red-500 mx-auto mb-1" />
              <div className="text-2xl font-bold text-red-600">{attendanceSummary.data?.absent ?? 0}</div>
              <div className="text-xs text-gray-500">Alpha</div>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Student List */}
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-sm">Daftar Siswa ({firstClass.students.length})</h3>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">
                    Wajah terdaftar: {firstClass.students.filter((s) => s.faceRegistered).length}/{firstClass.students.length}
                  </span>
                </div>
              </div>
              <div className="max-h-[400px] overflow-y-auto">
                {firstClass.students.length === 0 ? (
                  <EmptyState icon={GraduationCap} title="Belum ada siswa" />
                ) : (
                  <div className="space-y-1">
                    {firstClass.students.map((s, i) => (
                      <div key={s.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-50 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-400 w-5 text-right">{i + 1}.</span>
                          <div>
                            <span className="font-medium">{s.user?.fullName ?? s.nis}</span>
                            <span className="text-xs text-gray-400 ml-2">{s.nis}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${s.gender === 'MALE' ? 'bg-blue-100 text-blue-600' : 'bg-pink-100 text-pink-600'}`}>
                            {s.gender === 'MALE' ? 'L' : 'P'}
                          </span>
                          {s.faceRegistered ? (
                            <span className="text-xs text-green-500" title="Wajah terdaftar">✓</span>
                          ) : (
                            <span className="text-xs text-red-400" title="Belum daftar wajah">✗</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>

            {/* Top Violations */}
            <Card>
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                <h3 className="font-semibold text-sm">Siswa dengan Pelanggaran Terbanyak</h3>
              </div>
              {(violationTop.data ?? []).length === 0 ? (
                <EmptyState icon={CheckCircle} title="Tidak ada pelanggaran" description="Semua siswa berkelakuan baik" />
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {(violationTop.data ?? []).slice(0, 10).map((v, i) => (
                    <div key={v.studentId} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                        i === 0 ? 'bg-red-100 text-red-600' :
                        i === 1 ? 'bg-orange-100 text-orange-600' :
                        i === 2 ? 'bg-yellow-100 text-yellow-600' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{v.name}</div>
                        <div className="text-xs text-gray-500">{v.nis}</div>
                      </div>
                      <div className="text-right">
                        <div className={`text-sm font-bold ${
                          v.totalPoints >= 20 ? 'text-red-600' :
                          v.totalPoints >= 10 ? 'text-orange-600' :
                          'text-yellow-600'
                        }`}>
                          {v.totalPoints} poin
                        </div>
                        <div className="text-xs text-gray-400">{v.totalViolations}x</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Quick Actions */}
          <div className="mt-6">
            <Card className="!p-4">
              <h3 className="font-semibold text-sm mb-3">Aksi Cepat</h3>
              <div className="flex flex-wrap gap-2">
                <a href="/app/attendance" className="inline-flex items-center gap-1 px-3 py-2 bg-green-50 text-green-700 rounded-lg text-sm hover:bg-green-100 transition">
                  <CheckCircle className="h-4 w-4" /> Rekap Absensi
                </a>
                <a href="/app/leave" className="inline-flex items-center gap-1 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm hover:bg-blue-100 transition">
                  <AlertTriangle className="h-4 w-4" /> Persetujuan Izin
                </a>
                <a href="/app/violations" className="inline-flex items-center gap-1 px-3 py-2 bg-red-50 text-red-700 rounded-lg text-sm hover:bg-red-100 transition">
                  <AlertTriangle className="h-4 w-4" /> Pelanggaran
                </a>
                <a href="/app/history" className="inline-flex items-center gap-1 px-3 py-2 bg-purple-50 text-purple-700 rounded-lg text-sm hover:bg-purple-100 transition">
                  <Clock className="h-4 w-4" /> Riwayat Absensi
                </a>
                <a href="/app/reports" className="inline-flex items-center gap-1 px-3 py-2 bg-orange-50 text-orange-700 rounded-lg text-sm hover:bg-orange-100 transition">
                  <TrendingUp className="h-4 w-4" /> Laporan
                </a>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
