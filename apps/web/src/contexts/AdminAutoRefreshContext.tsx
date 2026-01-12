import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

const ADMIN_REFRESH_EVENT = 'sr_admin_data_changed';

type AdminAutoRefreshContextValue = {
  refreshToken: number;
};

const AdminAutoRefreshContext = createContext<AdminAutoRefreshContextValue | null>(null);

export function AdminAutoRefreshProvider({
  children,
  pollIntervalMs = 2_000,
}: {
  children: React.ReactNode;
  pollIntervalMs?: number;
}) {
  const queryClient = useQueryClient();
  const [refreshToken, setRefreshToken] = useState(0);

  const lastRefreshAtRef = useRef<number>(0);

  const bump = useCallback(
    () => {
      const now = Date.now();
      // Simple throttle so we don't refetch multiple times in quick bursts
      // (e.g., focus + visibilitychange + mutation).
      if (now - lastRefreshAtRef.current < 250) return;
      lastRefreshAtRef.current = now;

      setRefreshToken((t) => t + 1);
      // Only refetch queries that are currently active (mounted).
      void queryClient.refetchQueries({ type: 'active' });
    },
    [queryClient]
  );

  useEffect(() => {
    const onChanged = () => bump();
    const onFocus = () => bump();
    const onOnline = () => bump();
    const onVisibility = () => {
      if (!document.hidden) bump();
    };

    window.addEventListener(ADMIN_REFRESH_EVENT, onChanged as EventListener);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);

    const id = window.setInterval(() => {
      if (document.hidden) return;
      bump();
    }, pollIntervalMs);

    return () => {
      window.removeEventListener(ADMIN_REFRESH_EVENT, onChanged as EventListener);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(id);
    };
  }, [bump, pollIntervalMs]);

  const value = useMemo(() => ({ refreshToken }), [refreshToken]);

  return <AdminAutoRefreshContext.Provider value={value}>{children}</AdminAutoRefreshContext.Provider>;
}

export function useAdminAutoRefreshToken(): number {
  const ctx = useContext(AdminAutoRefreshContext);
  if (!ctx) return 0;
  return ctx.refreshToken;
}

export function emitAdminDataChanged() {
  try {
    window.dispatchEvent(new Event(ADMIN_REFRESH_EVENT));
  } catch {
    // ignore
  }
}
