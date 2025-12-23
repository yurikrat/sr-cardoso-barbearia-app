import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BookingProvider } from './contexts/BookingContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Toaster } from './components/ui/toaster';
import { OfflineIndicator } from './components/OfflineIndicator';
import { debugLog } from '@/utils/debugLog';
import HomePage from './pages/HomePage';
import BookingPage from './pages/BookingPage';
import SuccessPage from './pages/SuccessPage';
import LoginPage from './pages/admin/LoginPage';
import AgendaDayPage from './pages/admin/AgendaDayPage';
import AgendaWeekPage from './pages/admin/AgendaWeekPage';
import CustomersPage from './pages/admin/CustomersPage';
import SmartListsPage from './pages/admin/SmartListsPage';
import CalendarIntegrationPage from './pages/admin/CalendarIntegrationPage';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function App() {
  // #region agent log
  debugLog({
    sessionId: 'debug-session',
    runId: 'run4',
    hypothesisId: 'H5',
    location: 'apps/web/src/App.tsx:App',
    message: 'App rendered (should appear on every page load)',
    data: {},
    timestamp: Date.now(),
  });
  // #endregion

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
                  <CustomersPage />
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
            </Routes>
            <Toaster />
          </BrowserRouter>
        </BookingProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
