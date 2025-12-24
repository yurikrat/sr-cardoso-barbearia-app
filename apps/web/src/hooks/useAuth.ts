import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

type AdminUser = { role: 'master' | 'barber'; barberId?: string | null; username: string };

export function useAuth() {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const claims = api.admin.getClaims();
    setUser(claims ? { role: claims.role, barberId: claims.barberId ?? null, username: claims.username } : null);
    setLoading(false);
  }, []);

  const logout = async () => {
    api.admin.logout();
    setUser(null);
  };

  return { user, loading, logout };
}

