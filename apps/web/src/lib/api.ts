import type { BrandingSettings } from '@sr-cardoso/shared';

type AdminWhatsappStatusResponse = {
  instanceName: string;
  instanceExists: boolean;
  connectionState: string | null;
  checkedBy: 'connectionState' | 'fetchInstances' | 'unknown';
  hint?: string;
  configured?: boolean;
  missing?: Array<'EVOLUTION_BASE_URL' | 'EVOLUTION_API_KEY' | 'EVOLUTION_INSTANCE_NAME'>;
};

type AdminWhatsappConnectResponse = {
  instanceName: string;
  qrcodeBase64: string | null;
  pairingCode?: string | null;
};

type AdminWhatsappConnectRequest = {
  mode?: 'qr' | 'pairingCode';
  phoneNumber?: string;
};

type AdminWhatsappSendTestResponse = { success: boolean; deduped?: boolean };
type AdminWhatsappSendConfirmationResponse = { success: boolean; deduped?: boolean };
type AdminWhatsappDisconnectResponse = { success: boolean; alreadyDisconnected?: boolean };

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
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
  }

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
    async listBookings(barberId: string, dateKey?: string, range?: { start: string; end: string }) {
      const params = new URLSearchParams();
      params.set('barberId', barberId);
      if (dateKey) params.set('dateKey', dateKey);
      if (range) {
        params.set('startDate', range.start);
        params.set('endDate', range.end);
      }
      return apiFetch<{ items: unknown[] }>(
        `/api/admin/bookings?${params.toString()}`,
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
    async createBooking(payload: {
      barberId: string;
      serviceType: string;
      slotStart: string;
      customer: {
        firstName: string;
        lastName: string;
        whatsapp: string;
        birthDate?: string;
      };
    }) {
      return apiFetch<{ success: boolean; bookingId: string }>(`/api/admin/bookings`, {
        method: 'POST',
        admin: true,
        body: JSON.stringify(payload),
      });
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

    async whatsappStatus() {
      return apiFetch<AdminWhatsappStatusResponse>(`/api/admin/whatsapp/status`, { admin: true });
    },

    async whatsappConnect(payload?: AdminWhatsappConnectRequest) {
      return apiFetch<AdminWhatsappConnectResponse>(`/api/admin/whatsapp/connect`, {
        method: 'POST',
        admin: true,
        body: JSON.stringify(payload ?? {}),
      });
    },

    async whatsappDisconnect() {
      return apiFetch<AdminWhatsappDisconnectResponse>(`/api/admin/whatsapp/disconnect`, {
        method: 'POST',
        admin: true,
      });
    },

    async whatsappSendTest(payload: { toE164: string; text: string }) {
      return apiFetch<AdminWhatsappSendTestResponse>(`/api/admin/whatsapp/send-test`, {
        method: 'POST',
        admin: true,
        body: JSON.stringify(payload),
      });
    },

    async whatsappGetNotificationSettings() {
      return apiFetch<{
        confirmationEnabled: boolean;
        confirmationMessage: string;
        reminderEnabled: boolean;
        reminderMinutesBefore: number;
        reminderMessage: string;
        cancellationMessage: string;
        birthdayEnabled: boolean;
        birthdayMessage: string;
      }>(`/api/admin/whatsapp/notification-settings`, { admin: true });
    },

    async whatsappSaveNotificationSettings(settings: {
      confirmationEnabled: boolean;
      confirmationMessage: string;
      reminderEnabled: boolean;
      reminderMinutesBefore: number;
      reminderMessage: string;
      cancellationMessage: string;
      birthdayEnabled: boolean;
      birthdayMessage: string;
    }) {
      return apiFetch<{ success: boolean }>(`/api/admin/whatsapp/notification-settings`, {
        method: 'PUT',
        admin: true,
        body: JSON.stringify(settings),
      });
    },

    async whatsappSendReminders() {
      return apiFetch<{ success: boolean; processed: number; sent: number; queued: number }>(
        `/api/admin/whatsapp/send-reminders`,
        { method: 'POST', admin: true }
      );
    },

    async whatsappProcessQueue() {
      return apiFetch<{ success: boolean; processed: number; sent: number; failed: number }>(
        `/api/admin/whatsapp/process-queue`,
        { method: 'POST', admin: true }
      );
    },

    async whatsappBroadcast(message: string) {
      return apiFetch<{
        success: boolean;
        sent: number;
        failed: number;
        total: number;
        errors?: Array<{ customerId: string; error: string }>;
        message?: string;
      }>(`/api/admin/whatsapp/broadcast`, {
        method: 'POST',
        admin: true,
        body: JSON.stringify({ message }),
      });
    },

    async whatsappBroadcastMedia(mediaUrl: string, caption: string) {
      return apiFetch<{
        success: boolean;
        sent: number;
        failed: number;
        total: number;
        errors?: Array<{ customerId: string; error: string }>;
      }>(`/api/admin/whatsapp/broadcast-media`, {
        method: 'POST',
        admin: true,
        body: JSON.stringify({ mediaUrl, caption }),
      });
    },

    async whatsappSendBirthdays() {
      return apiFetch<{
        success: boolean;
        processed: number;
        sent: number;
        failed: number;
        skipped: number;
      }>(`/api/admin/whatsapp/send-birthdays`, {
        method: 'POST',
        admin: true,
      });
    },

    async sendBookingWhatsappConfirmation(bookingId: string, payload: { text: string }) {
      return apiFetch<AdminWhatsappSendConfirmationResponse>(
        `/api/admin/bookings/${encodeURIComponent(bookingId)}/whatsapp/send-confirmation`,
        {
          method: 'POST',
          admin: true,
          body: JSON.stringify(payload),
        }
      );
    },
    async getBarberCalendarToken(barberId: string) {
      return apiFetch<{ calendarFeedToken: string | null }>(`/api/admin/barbers/${barberId}`, {
        admin: true,
      });
    },
    async getBarber(barberId: string) {
      return apiFetch<{ calendarFeedToken: string | null; schedule: any }>(`/api/admin/barbers/${barberId}`, {
        admin: true,
      });
    },
    async updateBarberSchedule(barberId: string, schedule: any) {
      return apiFetch<{ success: boolean }>(`/api/admin/barbers/${barberId}/schedule`, {
        method: 'PUT',
        admin: true,
        body: JSON.stringify({ schedule }),
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
    async unblockSlot(barberId: string, slotId: string) {
      return apiFetch<{ success: boolean; message: string }>(`/api/admin/blocks/${encodeURIComponent(barberId)}/${encodeURIComponent(slotId)}`, {
        method: 'DELETE',
        admin: true,
      });
    },
    async unblockSlots(barberId: string, slotIds: string[]) {
      return apiFetch<{ success: boolean; message: string; deleted: number }>(`/api/admin/blocks/unblock`, {
        method: 'POST',
        admin: true,
        body: JSON.stringify({ barberId, slotIds }),
      });
    },
    async listCustomers(limit = 100) {
      return apiFetch<{ items: unknown[] }>(`/api/admin/customers?limit=${limit}`, { admin: true });
    },
    async getCustomer(customerId: string) {
      return apiFetch<{ item: unknown }>(`/api/admin/customers/${encodeURIComponent(customerId)}`, { admin: true });
    },
    async updateCustomer(customerId: string, data: { birthdayMmdd?: string | null; notes?: string | null; tags?: string[] }) {
      return apiFetch<{ success: boolean; item: unknown }>(`/api/admin/customers/${encodeURIComponent(customerId)}`, {
        method: 'PATCH',
        admin: true,
        body: JSON.stringify(data),
      });
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

    async getBranding() {
      return apiFetch<BrandingSettings>(`/api/admin/branding`, { admin: true });
    },

    async updateBranding(payload: Partial<BrandingSettings>) {
      return apiFetch<{ success: boolean; config: BrandingSettings }>(`/api/admin/branding`, {
        method: 'PATCH',
        admin: true,
        body: JSON.stringify(payload),
      });
    },

    async uploadBrandingAsset(file: File, type: 'logo') {
      const formData = new FormData();
      formData.append('file', file);

      const url = `${BASE}/api/admin/branding/upload?type=${type}`;
      const token = getAdminToken();
      const headers = new Headers();
      if (token) headers.set('Authorization', `Bearer ${token}`);

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: formData,
      });

      if (!res.ok) {
        const text = await res.text();
        let msg: string | null = null;
        if (text) {
          try {
            const parsed = JSON.parse(text) as ApiError;
            msg = parsed?.error ?? null;
          } catch {
            // ignore (likely HTML error page)
          }
        }
        if (!msg && res.status === 413) msg = 'Arquivo muito grande. Tente uma imagem menor.';
        throw new Error(msg || `Erro HTTP ${res.status}`);
      }

      const text = await res.text();
      try {
        const parsed = JSON.parse(text) as any;
        return parsed as { success: boolean; url: string; config?: BrandingSettings };
      } catch {
        throw new Error('Resposta inválida do servidor no upload');
      }
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
    return apiFetch<{
      items: Array<{
        id: string;
        label: string;
        priceCents: number;
        popularLast90DaysCount?: number;
        isMostPopular?: boolean;
      }>;
    }>(`/api/services`);
  },

  async getBranding() {
    return apiFetch<BrandingSettings>(`/api/branding`);
  },

  async availability(barberId: string, dateKey: string) {
    return apiFetch<{ bookedSlotIds: string[]; blockedSlotIds: string[]; schedule: any }>(
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


