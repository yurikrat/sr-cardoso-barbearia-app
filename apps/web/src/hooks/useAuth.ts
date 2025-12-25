import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

type AdminUser = { role: 'master' | 'barber'; barberId?: string | null; username: string };

export function useAuth() {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const syncFromToken = () => {
      const claims = api.admin.getClaims();
      setUser(claims ? { role: claims.role, barberId: claims.barberId ?? null, username: claims.username } : null);
      setLoading(false);
    };

    syncFromToken();

    const onTokenChanged = () => syncFromToken();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'sr_admin_token') syncFromToken();
    };

    window.addEventListener('sr_admin_token_changed', onTokenChanged as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('sr_admin_token_changed', onTokenChanged as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const logout = async () => {
    api.admin.logout();
    // state will sync via sr_admin_token_changed
  };

  return { user, loading, logout };
}

