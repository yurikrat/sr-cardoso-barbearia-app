type ApiError = { error?: string };

const BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') || '';

function getAdminToken() {
  try {
    return localStorage.getItem('sr_admin_token');
  } catch {
    return null;
  }
}

function setAdminToken(token: string | null) {
  try {
    if (!token) localStorage.removeItem('sr_admin_token');
    else localStorage.setItem('sr_admin_token', token);
  } catch {
    // ignore
  }

  // Notify in-app listeners (same-tab) that auth changed.
  try {
    window.dispatchEvent(new Event('sr_admin_token_changed'));
  } catch {
    // ignore
  }
}

function decodeJwtClaims(token: string | null): { role: 'master' | 'barber'; username: string; barberId?: string | null } | null {
  try {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payloadB64.padEnd(payloadB64.length + ((4 - (payloadB64.length % 4)) % 4), '=');
    const json = atob(padded);
    const payload = JSON.parse(json) as any;
    const role = payload?.role;
    const username = payload?.username;
    const barberId = payload?.barberId;
    if (role !== 'master' && role !== 'barber') return null;
    if (typeof username !== 'string' || !username) return null;
    return { role, username, barberId: typeof barberId === 'string' ? barberId : null };
  } catch {
    return null;
  }
}

async function apiFetch<T>(
  path: string,
  init?: RequestInit & { admin?: boolean }
): Promise<T> {
  const url = `${BASE}${path}`;
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');

  if (init?.admin) {
    const token = getAdminToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    if (init?.admin && res.status === 401) {
      // Token inválido/expirado -> força logout local.
      setAdminToken(null);
    }
    const msg =
      (json as ApiError | null)?.error ||
      `Erro HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}

export const api = {
  admin: {
    getToken: getAdminToken,
    setToken: setAdminToken,
    getClaims() {
      return decodeJwtClaims(getAdminToken());
    },
    async login(password: string) {
      const data = await apiFetch<{ token: string }>('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      setAdminToken(data.token);
      return data;
    },
    async loginWithUsername(username: string, password: string) {
      const data = await apiFetch<{ token: string }>('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setAdminToken(data.token);
      return data;
    },
    async listBookings(barberId: string, dateKey: string) {
      return apiFetch<{ items: unknown[] }>(
        `/api/admin/bookings?barberId=${encodeURIComponent(barberId)}&dateKey=${encodeURIComponent(
          dateKey
        )}`,
        { admin: true }
      );
    },
    async weekSummary(barberId: string, startDateKey: string, days = 6) {
      return apiFetch<{ items: Record<string, { bookings: number; blocks: number }> }>(
        `/api/admin/week-summary?barberId=${encodeURIComponent(barberId)}&startDateKey=${encodeURIComponent(
          startDateKey
        )}&days=${days}`,
        { admin: true }
      );
    },
    async cancelBooking(bookingId: string) {
      return apiFetch<{ success: boolean }>(`/api/admin/bookings/${bookingId}/cancel`, {
        method: 'POST',
        admin: true,
      });
    },
    async rescheduleBooking(bookingId: string, newSlotStart: string) {
      return apiFetch<{ success: boolean }>(`/api/admin/bookings/${bookingId}/reschedule`, {
        method: 'POST',
        admin: true,
        body: JSON.stringify({ newSlotStart }),
      });
    },
    async markWhatsappSent(bookingId: string) {
      return apiFetch<{ success: boolean }>(`/api/admin/bookings/${bookingId}/whatsapp-sent`, {
        method: 'POST',
        admin: true,
      });
    },
    async getBarberCalendarToken(barberId: string) {
      return apiFetch<{ calendarFeedToken: string | null }>(`/api/admin/barbers/${barberId}`, {
        admin: true,
      });
    },
    async listBarbers() {
      return apiFetch<{ items: Array<{ id: string; name: string; active: boolean }> }>(
        `/api/admin/barbers`,
        { admin: true }
      );
    },
    async financeSummary(payload: { startDateKey: string; endDateKey: string; barberId?: string | null }) {
      const params = new URLSearchParams({
        startDateKey: payload.startDateKey,
        endDateKey: payload.endDateKey,
      });
      if (payload.barberId) params.set('barberId', payload.barberId);
      return apiFetch<{
        startDateKey: string;
        endDateKey: string;
        barberId: string | null;
        totalBookings: number;
        revenueCents: number;
        estimatedRevenueCents?: number;
        realizedRevenueCents?: number;
        estimatedBarberCents?: number;
        estimatedShopCents?: number;
        realizedBarberCents?: number;
        realizedShopCents?: number;
        commissions?: { defaultBarberPct: number; ownerBarberPct: number };
        projectionRevenueCents?: number | null;
        countsByServiceType: Record<string, number>;
        countsByStatus: Record<string, number>;
        serviceCatalog?: Array<{ id: string; label: string; priceCents: number; active: boolean; sortOrder: number }>;
      }>(`/api/admin/finance/summary?${params.toString()}`, { admin: true });
    },

    async getFinanceConfig() {
      return apiFetch<{ config: { commissions: { defaultBarberPct: number; ownerBarberPct: number }; services: Array<{ id: string; label: string; priceCents: number; active: boolean; sortOrder: number }> } }>(
        `/api/admin/finance/config`,
        { admin: true }
      );
    },

    async saveFinanceConfig(payload: { commissions: { defaultBarberPct: number; ownerBarberPct: number }; services: Array<{ id: string; label: string; priceCents: number; active: boolean; sortOrder: number }> }) {
      return apiFetch<{ success: boolean; config: { commissions: { defaultBarberPct: number; ownerBarberPct: number }; services: Array<{ id: string; label: string; priceCents: number; active: boolean; sortOrder: number }> } }>(
        `/api/admin/finance/config`,
        { method: 'PUT', admin: true, body: JSON.stringify(payload) }
      );
    },
    async blockSlots(payload: { barberId: string; startTime: string; endTime: string; reason: string }) {
      return apiFetch<{ success: boolean }>(`/api/admin/blocks`, {
        method: 'POST',
        admin: true,
        body: JSON.stringify(payload),
      });
    },
    async listCustomers(limit = 100) {
      return apiFetch<{ items: unknown[] }>(`/api/admin/customers?limit=${limit}`, { admin: true });
    },
    async getCustomer(customerId: string) {
      return apiFetch<{ item: unknown }>(`/api/admin/customers/${encodeURIComponent(customerId)}`, { admin: true });
    },
    async listCustomerBookings(customerId: string, limit = 50) {
      return apiFetch<{ items: unknown[] }>(
        `/api/admin/customers/${encodeURIComponent(customerId)}/bookings?limit=${limit}`,
        { admin: true }
      );
    },
    async setBookingStatus(bookingId: string, status: 'confirmed' | 'completed' | 'no_show') {
      return apiFetch<{ success: boolean }>(`/api/admin/bookings/${encodeURIComponent(bookingId)}/status`, {
        method: 'POST',
        admin: true,
        body: JSON.stringify({ status }),
      });
    },
    async listAdminUsers() {
      return apiFetch<{ items: Array<{ id: string; username: string; role: 'master' | 'barber'; barberId: string | null; active: boolean; lastLoginAt: string | null }> }>(
        `/api/admin/users`,
        { admin: true }
      );
    },
    async createAdminUser(payload: { username: string; password?: string | null; role: 'master' | 'barber'; barberId?: string | null; active?: boolean }) {
      return apiFetch<{ success: boolean; password: string | null }>(`/api/admin/users`, {
        method: 'POST',
        admin: true,
        body: JSON.stringify(payload),
      });
    },
    async setAdminUserActive(username: string, active: boolean) {
      return apiFetch<{ success: boolean }>(`/api/admin/users/${encodeURIComponent(username)}/active`, {
        method: 'POST',
        admin: true,
        body: JSON.stringify({ active }),
      });
    },
    async resetAdminUserPassword(username: string, password?: string | null) {
      return apiFetch<{ success: boolean; password: string | null }>(`/api/admin/users/${encodeURIComponent(username)}/reset-password`, {
        method: 'POST',
        admin: true,
        body: JSON.stringify(password ? { password } : {}),
      });
    },

    async deleteAdminUser(username: string) {
      return apiFetch<{ success: boolean }>(`/api/admin/users/${encodeURIComponent(username)}`, {
        method: 'DELETE',
        admin: true,
      });
    },

    async createBarber(payload: { id?: string | null; name: string; active?: boolean; createLogin?: boolean }) {
      return apiFetch<{ success: boolean; id: string; username: string | null; password: string | null }>(
        `/api/admin/barbers`,
        {
          method: 'POST',
          admin: true,
          body: JSON.stringify(payload),
        }
      );
    },

    async changeMyPassword(currentPassword: string, newPassword: string) {
      return apiFetch<{ success: boolean }>(`/api/admin/me/password`, {
        method: 'POST',
        admin: true,
        body: JSON.stringify({ currentPassword, newPassword }),
      });
    },
    logout() {
      setAdminToken(null);
    },
  },

  async services() {
    return apiFetch<{ items: Array<{ id: string; label: string; priceCents: number }> }>(`/api/services`);
  },

  async availability(barberId: string, dateKey: string) {
    return apiFetch<{ bookedSlotIds: string[]; blockedSlotIds: string[] }>(
      `/api/availability?barberId=${encodeURIComponent(barberId)}&dateKey=${encodeURIComponent(
        dateKey
      )}`
    );
  },

  async lookupCustomer(phone: string) {
    return apiFetch<{
      found: boolean;
      firstName?: string;
      lastNameInitial?: string;
      hasBirthDate: boolean;
    }>(`/api/customers/lookup?phone=${encodeURIComponent(phone)}`);
  },

  async createBooking(payload: {
    barberId: string;
    serviceType: string;
    slotStart: string;
    customer: { firstName: string; lastName: string; whatsapp: string; birthDate?: string };
  }) {
    return apiFetch<{ success: boolean; bookingId: string; cancelCode?: string | null }>(`/api/bookings`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};


