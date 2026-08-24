import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth, hasRole } from './lib/auth';
import { AppShell } from './components/AppShell';
import ApkDownloadBanner from './components/ApkDownloadBanner';
import { LoadingCard } from './lib/ui';

const Login = lazy(() => import('./pages/Login'));
const Monitor = lazy(() => import('./pages/Monitor'));

// Admin
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AttendanceList = lazy(() => import('./pages/admin/AttendanceList'));
const FaceRegister = lazy(() => import('./pages/admin/FaceRegister'));
const Students = lazy(() => import('./pages/admin/Students'));
const Users = lazy(() => import('./pages/admin/Users'));
const Classes = lazy(() => import('./pages/admin/Classes'));
const LeaveAdmin = lazy(() => import('./pages/admin/LeaveAdmin'));
const Reports = lazy(() => import('./pages/admin/Reports'));
const Notifications = lazy(() => import('./pages/shared/Notifications'));
const Devices = lazy(() => import('./pages/admin/Devices'));
const Audit = lazy(() => import('./pages/admin/Audit'));
const Settings = lazy(() => import('./pages/admin/Settings'));
const ImportStudents = lazy(() => import('./pages/admin/ImportStudents'));
const QrCards = lazy(() => import('./pages/admin/QrCards'));
const PklManagement = lazy(() => import('./pages/admin/PklManagement'));
const PklReports = lazy(() => import('./pages/admin/PklReports'));
const SDMSMonitor = lazy(() => import('./pages/admin/SDMSMonitor'));
const BkCounseling = lazy(() => import('./pages/admin/BkCounseling'));

// Guru / Staff / Siswa
const TeacherHome = lazy(() => import('./pages/teacher/TeacherHome'));
const Gate = lazy(() => import('./pages/teacher/Gate'));
const ClassAttendance = lazy(() => import('./pages/teacher/ClassAttendance'));
const Journal = lazy(() => import('./pages/teacher/Journal'));
const Absent = lazy(() => import('./pages/student/Absent'));
const FaceMe = lazy(() => import('./pages/student/FaceMe'));
const FaceScan = lazy(() => import('./pages/student/FaceScan'));
const QrScan = lazy(() => import('./pages/student/QrScan'));
const CardTap = lazy(() => import('./pages/student/CardTap'));
const History = lazy(() => import('./pages/shared/History'));
const Leave = lazy(() => import('./pages/shared/Leave'));
const PklAbsent = lazy(() => import('./pages/student/PklAbsent'));
const PklDashboard = lazy(() => import('./pages/teacher/PklDashboard'));

// Orang tua
const ParentHome = lazy(() => import('./pages/parent/ParentHome'));
const ParentChildren = lazy(() => import('./pages/parent/ParentChildren'));

// Bersama
const Profile = lazy(() => import('./pages/shared/Profile'));

function Page({ children }: { children: ReactNode }) {
  return <Suspense fallback={<LoadingCard />}>{children}</Suspense>;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingCard />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <>
      {/* Banner unduh APK — hanya tampil di browser Android biasa */}
      <ApkDownloadBanner />
      <Routes>
      <Route path="/login" element={<Page><Login /></Page>} />
      <Route path="/monitor" element={<Page><Monitor /></Page>} />

      <Route
        path="/app"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        {/* Admin */}
        <Route path="dashboard" element={<Page><AdminDashboard /></Page>} />
        <Route path="attendance" element={<Page><AttendanceList /></Page>} />
        <Route path="students" element={<Page><Students /></Page>} />
        <Route path="face-register" element={<Page><FaceRegister /></Page>} />
        <Route path="users" element={<Page><Users /></Page>} />
        <Route path="classes" element={<Page><Classes /></Page>} />
        <Route path="leave" element={<Page><LeaveAdmin /></Page>} />
        <Route path="reports" element={<Page><Reports /></Page>} />
        <Route path="notifications" element={<Page><Notifications /></Page>} />
        <Route path="devices" element={<Page><Devices /></Page>} />
        <Route path="audit" element={<Page><Audit /></Page>} />
        <Route path="settings" element={<Page><Settings /></Page>} />
        <Route path="import" element={<Page><ImportStudents /></Page>} />
        <Route path="qr-cards" element={<Page><QrCards /></Page>} />
        <Route path="pkl" element={<Page><PklManagement /></Page>} />
        <Route path="pkl-reports" element={<Page><PklReports /></Page>} />
        <Route path="sdms-monitor" element={<Page><SDMSMonitor /></Page>} />
        <Route path="bk" element={<Page><BkCounseling /></Page>} />

        {/* Guru / Orang tua */}
        <Route path="home" element={<HomeSwitch />} />
        <Route path="gate" element={<Page><Gate /></Page>} />
        <Route path="class/:id" element={<Page><ClassAttendance /></Page>} />
        <Route path="journal" element={<Page><Journal /></Page>} />

        {/* Siswa PKL */}
        <Route path="pkl-absent" element={<Page><PklAbsent /></Page>} />
        <Route path="pkl-monitor" element={<Page><PklDashboard /></Page>} />

        {/* Siswa */}
        <Route path="absent" element={<Page><Absent /></Page>} />
        <Route path="face-me" element={<Page><FaceMe /></Page>} />
        <Route path="absent/face" element={<Page><FaceScan /></Page>} />
        <Route path="absent/qr" element={<Page><QrScan /></Page>} />
        <Route path="absent/card" element={<Page><CardTap /></Page>} />

        {/* Bersama */}
        <Route path="history" element={<Page><History /></Page>} />
        <Route path="leave/mine" element={<Page><Leave /></Page>} />
        <Route path="profile" element={<Page><Profile /></Page>} />

        {/* Orang tua */}
        <Route path="children" element={<Page><ParentChildren /></Page>} />
        <Route path="parent-history" element={<Page><History /></Page>} />
      </Route>

      <Route path="/" element={<RootRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

function HomeSwitch() {
  const { user } = useAuth();
  if (hasRole(user, 'PARENT')) {
    return (
      <Page>
        <ParentHome />
      </Page>
    );
  }
  return (
    <Page>
      <TeacherHome />
    </Page>
  );
}

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  const roles = user.roles || [user.roleKey];
  if (roles.includes('ADMIN') || roles.includes('SUPER_ADMIN')) return <Navigate to="/app/dashboard" replace />;
  if (roles.includes('PARENT')) return <Navigate to="/app/home" replace />;
  return <Navigate to="/app/home" replace />;
}
