import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BookingProvider } from './contexts/BookingContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Toaster } from './components/ui/toaster';
import { OfflineIndicator } from './components/OfflineIndicator';
import { debugLog } from '@/utils/debugLog';
import { api } from '@/lib/api';
import { useBranding } from '@/hooks/useBranding';
import HomePage from './pages/HomePage';
import BookingPage from './pages/BookingPage';
import SuccessPage from './pages/SuccessPage';
import CancelBookingPage from './pages/CancelBookingPage';
import LoginPage from './pages/admin/LoginPage';
import AgendaDayPage from './pages/admin/AgendaDayPage';
import AgendaWeekPage from './pages/admin/AgendaWeekPage';
import CustomerDetailPage from './pages/admin/CustomerDetailPage';
import SmartListsPage from './pages/admin/SmartListsPage';
import CalendarIntegrationPage from './pages/admin/CalendarIntegrationPage';
import FinancePage from './pages/admin/FinancePage';
import UsersPage from './pages/admin/UsersPage';
import ChangePasswordPage from './pages/admin/ChangePasswordPage';
import ScheduleConfigPage from './pages/admin/ScheduleConfigPage';
import BrandingPage from './pages/admin/BrandingPage';
import WhatsappPage from './pages/admin/WhatsappPage';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function AdminEntryRedirect() {
  const claims = api.admin.getClaims();
  if (!claims) return <Navigate to="/admin/login" replace />;
  return <Navigate to="/admin/agenda" replace />;
}

function MasterOnlyRoute({ children }: { children: React.ReactNode }) {
  const claims = api.admin.getClaims();
  if (!claims) return <Navigate to="/admin/login" replace />;
  if (claims.role !== 'master') return <Navigate to="/admin/agenda" replace />;
  return <>{children}</>;
}

function App() {
  const { branding } = useBranding();

  useEffect(() => {
    // Keep reference so branding stays warm in memory; favicon is static.
    void branding;
  }, [branding]);

  useEffect(() => {
    // #region agent log
    debugLog({
      sessionId: 'debug-session',
      runId: 'run4',
      hypothesisId: 'H5',
      location: 'apps/web/src/App.tsx:App',
      message: 'App mounted (should appear on every full page load)',
      data: {},
      timestamp: Date.now(),
    });
    // #endregion
  }, []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BookingProvider>
          <BrowserRouter>
            <OfflineIndicator />
            <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/agendar" element={<BookingPage />} />
            <Route path="/sucesso" element={<SuccessPage />} />
            <Route
              path="/admin/senha"
              element={
                <ProtectedRoute>
                  <ChangePasswordPage />
                </ProtectedRoute>
              }
            />
            <Route path="/cancelar/:cancelCode" element={<CancelBookingPage />} />
            <Route path="/admin" element={<AdminEntryRedirect />} />
            <Route path="/admin/" element={<AdminEntryRedirect />} />
            <Route path="/admin/login" element={<LoginPage />} />
            <Route
              path="/admin/agenda"
              element={
                <ProtectedRoute>
                  <AgendaDayPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/agenda/semana"
              element={
                <ProtectedRoute>
                  <AgendaWeekPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/clientes"
              element={
                <ProtectedRoute>
                  <SmartListsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/clientes/:customerId"
              element={
                <ProtectedRoute>
                  <CustomerDetailPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/financeiro"
              element={
                <ProtectedRoute>
                  <FinancePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/usuarios"
              element={
                <ProtectedRoute>
                  <MasterOnlyRoute>
                    <UsersPage />
                  </MasterOnlyRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/branding"
              element={
                <ProtectedRoute>
                  <MasterOnlyRoute>
                    <BrandingPage />
                  </MasterOnlyRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/whatsapp"
              element={
                <ProtectedRoute>
                  <MasterOnlyRoute>
                    <WhatsappPage />
                  </MasterOnlyRoute>
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/listas"
              element={
                <ProtectedRoute>
                  <SmartListsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/calendario"
              element={
                <ProtectedRoute>
                  <CalendarIntegrationPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/horarios"
              element={
                <ProtectedRoute>
                  <ScheduleConfigPage />
                </ProtectedRoute>
              }
            />
            </Routes>
            <Toaster />
          </BrowserRouter>
        </BookingProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
