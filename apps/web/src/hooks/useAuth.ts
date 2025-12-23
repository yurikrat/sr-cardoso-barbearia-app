import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

type AdminUser = { role: 'admin' };

export function useAuth() {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = api.admin.getToken();
    setUser(token ? { role: 'admin' } : null);
    setLoading(false);
  }, []);

  const logout = async () => {
    api.admin.logout();
    setUser(null);
  };

  return { user, loading, logout };
}

