import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './lib/auth';
import { Spinner } from './components/ui';
import { AppLayout } from './components/AppLayout';
import { GroupLayout } from './components/GroupLayout';
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage, VerifyEmailPage } from './pages/AuthPages';
import { InvitationPage } from './pages/InvitationPage';
import { AccountSettingsPage } from './pages/AccountSettingsPage';
import { GroupsPage } from './pages/GroupsPage';
import { CreateGroupPage } from './pages/CreateGroupPage';
import { DashboardPage } from './pages/DashboardPage';
import { MembersPage } from './pages/MembersPage';
import { RulesPage } from './pages/RulesPage';
import { RoundsPage } from './pages/RoundsPage';
import { RoundDetailPage } from './pages/RoundDetailPage';
import { LedgerPage } from './pages/LedgerPage';
import { ReportsPage } from './pages/ReportsPage';
import { AuditPage } from './pages/AuditPage';
import { SettingsPage } from './pages/SettingsPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { PrivacyPage } from './pages/PrivacyPage';

function Protected({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/invite/:token" element={<InvitationPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route element={<Protected><AppLayout /></Protected>}>
        <Route path="/" element={<GroupsPage />} />
        <Route path="/groups/new" element={<CreateGroupPage />} />
        <Route path="/account" element={<AccountSettingsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/groups/:groupId" element={<GroupLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="members" element={<MembersPage />} />
          <Route path="rules" element={<RulesPage />} />
          <Route path="rounds" element={<RoundsPage />} />
          <Route path="rounds/:roundId" element={<RoundDetailPage />} />
          <Route path="ledger" element={<LedgerPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
