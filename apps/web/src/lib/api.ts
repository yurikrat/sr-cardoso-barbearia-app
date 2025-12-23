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
    async login(password: string) {
      const data = await apiFetch<{ token: string }>('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
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
    logout() {
      setAdminToken(null);
    },
  },

  async availability(barberId: string, dateKey: string) {
    return apiFetch<{ bookedSlotIds: string[]; blockedSlotIds: string[] }>(
      `/api/availability?barberId=${encodeURIComponent(barberId)}&dateKey=${encodeURIComponent(
        dateKey
      )}`
    );
  },

  async createBooking(payload: {
    barberId: string;
    serviceType: string;
    slotStart: string;
    customer: { firstName: string; lastName: string; whatsapp: string };
  }) {
    return apiFetch<{ success: boolean; bookingId: string }>(`/api/bookings`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};


