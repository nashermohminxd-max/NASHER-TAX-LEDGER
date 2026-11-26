import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from '@/lib/authContext';
import { AdminDashboardPage } from '@/pages/AdminDashboardPage';
import { ClientPortalPage } from '@/pages/ClientPortalPage';
import { LoginPage } from '@/pages/LoginPage';
import type { UserRole } from '@/types/portal';

const FullScreenLoader: React.FC = () => (
  <div className="min-h-screen bg-gradient-to-br from-[#DCEBFB] via-[#EEF5FC] to-[#F8FBFF] flex items-center justify-center p-4">
    <div className="flex items-center gap-2.5 rounded-2xl border border-white/90 bg-white/80 px-5 py-3.5 text-sm font-medium text-slate-700 shadow-sm backdrop-blur-xl">
      <Loader2 className="h-4 w-4 animate-spin text-[#0B4DA2]" />
      Verifying access session...
    </div>
  </div>
);

const RoleGuard: React.FC<{
  allowedRoles: UserRole[];
  children: React.ReactNode;
}> = ({ allowedRoles, children }) => {
  const { user, loading } = useAuth();

  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!allowedRoles.includes(user.role)) {
    return <Navigate to={user.role === 'admin' ? '/admin' : '/client'} replace />;
  }
  return <>{children}</>;
};

const LoginRoute: React.FC = () => {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (user) {
    return <Navigate to={user.role === 'admin' ? '/admin' : '/client'} replace />;
  }
  return <LoginPage />;
};

const RootRedirect: React.FC = () => {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'admin' ? '/admin' : '/client'} replace />;
};

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={<LoginRoute />} />
          <Route
            path="/admin"
            element={
              <RoleGuard allowedRoles={['admin']}>
                <AdminDashboardPage />
              </RoleGuard>
            }
          />
          <Route
            path="/admin/client/:clientId"
            element={
              <RoleGuard allowedRoles={['admin']}>
                <AdminDashboardPage />
              </RoleGuard>
            }
          />
          <Route
            path="/client"
            element={
              <RoleGuard allowedRoles={['client']}>
                <ClientPortalPage />
              </RoleGuard>
            }
          />
          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
