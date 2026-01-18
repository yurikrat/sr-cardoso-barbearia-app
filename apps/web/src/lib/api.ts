import type { BrandingSettings } from '@sr-cardoso/shared';

export type BarberScheduleBreak = { start: string; end: string };
export type BarberScheduleDayConfig = {
  active: boolean;
  start: string;
  end: string;
  breaks?: BarberScheduleBreak[];
};
export type BarberSchedule = Record<string, BarberScheduleDayConfig | undefined>;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

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
    const parsed: unknown = JSON.parse(json);
    if (!isRecord(parsed)) return null;
    const role = parsed['role'];
    const username = parsed['username'];
    const barberId = parsed['barberId'];
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

  const method = (init?.method || 'GET').toUpperCase();

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

  // Notify in-app listeners that some admin data may have changed.
  // This enables auto-refresh in the admin UI without requiring manual F5.
  if (init?.admin && method !== 'GET') {
    try {
      window.dispatchEvent(
        new CustomEvent('sr_admin_data_changed', {
          detail: { path, method, at: Date.now() },
        })
      );
    } catch {
      // ignore
    }
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
      allowEncaixe?: boolean;
      customer: {
        firstName: string;
        lastName: string;
        whatsapp?: string;
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
    async updateBookingService(bookingId: string, serviceType: string) {
      return apiFetch<{ success: boolean; serviceType: string }>(
        `/api/admin/bookings/${encodeURIComponent(bookingId)}/service`,
        {
          method: 'POST',
          admin: true,
          body: JSON.stringify({ serviceType }),
        }
      );
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
      return apiFetch<{ calendarFeedToken: string | null; schedule: BarberSchedule | null }>(
        `/api/admin/barbers/${barberId}`,
        {
        admin: true,
        }
      );
    },
    async updateBarberSchedule(barberId: string, schedule: BarberSchedule | null) {
      return apiFetch<{ success: boolean }>(`/api/admin/barbers/${barberId}/schedule`, {
        method: 'PUT',
        admin: true,
        body: JSON.stringify({ schedule }),
      });
    },
    async listBarbers(opts?: { includeInactive?: boolean }) {
      const params = new URLSearchParams();
      if (opts?.includeInactive) params.set('includeInactive', '1');
      const qs = params.toString();
      return apiFetch<{ items: Array<{ id: string; name: string; active: boolean; archivedAt?: string | null; archivedBy?: string | null }> }>(
        `/api/admin/barbers${qs ? `?${qs}` : ''}`,
        { admin: true }
      );
    },

    async archiveBarber(barberId: string) {
      return apiFetch<{ success: boolean }>(`/api/admin/barbers/${encodeURIComponent(barberId)}/archive`, {
        method: 'POST',
        admin: true,
      });
    },

    async createBarberLogin(barberId: string) {
      return apiFetch<{ success: boolean; username: string; password: string }>(
        `/api/admin/barbers/${encodeURIComponent(barberId)}/create-login`,
        {
          method: 'POST',
          admin: true,
        }
      );
    },

    async deleteBarber(barberId: string) {
      return apiFetch<{ success: boolean }>(`/api/admin/barbers/${encodeURIComponent(barberId)}`, {
        method: 'DELETE',
        admin: true,
      });
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
        countsByPaymentMethod?: Record<string, number>;
        revenueByPaymentMethod?: Record<string, number>;
        serviceCatalog?: Array<{ id: string; label: string; priceCents: number; active: boolean; sortOrder: number }>;
      }>(`/api/admin/finance/summary?${params.toString()}`, { admin: true });
    },

    async getFinanceConfig() {
      return apiFetch<{ config: { commissions: { defaultBarberPct: number; ownerBarberPct: number }; services: Array<{ id: string; label: string; priceCents: number; active: boolean; sortOrder: number }>; barberServicePrices?: Record<string, Array<{ serviceId: string; priceCents: number }>> } }>(
        `/api/admin/finance/config`,
        { admin: true }
      );
    },

    async saveFinanceConfig(payload: { commissions: { defaultBarberPct: number; ownerBarberPct: number }; services: Array<{ id: string; label: string; priceCents: number; active: boolean; sortOrder: number }>; barberServicePrices?: Record<string, Array<{ serviceId: string; priceCents: number }>> }) {
      return apiFetch<{ success: boolean; config: { commissions: { defaultBarberPct: number; ownerBarberPct: number }; services: Array<{ id: string; label: string; priceCents: number; active: boolean; sortOrder: number }>; barberServicePrices?: Record<string, Array<{ serviceId: string; priceCents: number }>> } }>(
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
    async updateCustomer(
      customerId: string,
      data: {
        firstName?: string;
        lastName?: string;
        whatsappE164?: string | null;
        birthdayMmdd?: string | null;
        notes?: string | null;
        tags?: string[];
      }
    ) {
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
      async setBookingStatus(
        bookingId: string,
        status: 'confirmed' | 'completed' | 'no_show',
        paymentMethod?: 'credit' | 'debit' | 'cash' | 'pix',
        paymentMethods?: Array<{ method: 'credit' | 'debit' | 'cash' | 'pix'; amountCents: number }>,
        productsPurchased?: boolean,
        discountPct?: number
      ) {
        const payload = {
          status,
          ...(paymentMethods && paymentMethods.length > 0
            ? { paymentMethods }
            : paymentMethod
              ? { paymentMethod }
              : {}),
          ...(typeof productsPurchased === 'boolean' ? { productsPurchased } : {}),
          ...(typeof discountPct === 'number' && discountPct > 0 ? { discountPct } : {}),
        };
        return apiFetch<{ success: boolean }>(`/api/admin/bookings/${encodeURIComponent(bookingId)}/status`, {
          method: 'POST',
          admin: true,
          body: JSON.stringify(payload),
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

    async updateBranding(payload: Partial<BrandingSettings> & { commitLogo?: boolean }) {
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
        const parsed: unknown = JSON.parse(text);
        if (!isRecord(parsed)) throw new Error('Resposta inválida do servidor no upload');
        const success = parsed['success'];
        const url = parsed['url'];
        const config = parsed['config'];
        if (typeof success !== 'boolean' || typeof url !== 'string') {
          throw new Error('Resposta inválida do servidor no upload');
        }
        return {
          success,
          url,
          config: isRecord(config) ? (config as unknown as BrandingSettings) : undefined,
        };
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

    // ============================================================
    // PRODUTOS
    // ============================================================

    async getProductsConfig() {
      return apiFetch<{
        defaultCommissionPct: number;
        lowStockAlertEnabled: boolean;
        lowStockWhatsappEnabled: boolean;
        blockSaleOnZeroStock: boolean;
      }>(`/api/admin/products/config`, { admin: true });
    },

    async updateProductsConfig(payload: {
      defaultCommissionPct?: number;
      lowStockAlertEnabled?: boolean;
      lowStockWhatsappEnabled?: boolean;
      blockSaleOnZeroStock?: boolean;
    }) {
      return apiFetch<{
        defaultCommissionPct: number;
        lowStockAlertEnabled: boolean;
        lowStockWhatsappEnabled: boolean;
        blockSaleOnZeroStock: boolean;
      }>(`/api/admin/products/config`, {
        method: 'PUT',
        admin: true,
        body: JSON.stringify(payload),
      });
    },

    async listProductCategories() {
      return apiFetch<Array<{
        id: string;
        name: string;
        sortOrder: number;
        active: boolean;
        createdAt: string;
        updatedAt: string;
      }>>(`/api/admin/products/categories`, { admin: true });
    },

    async createProductCategory(payload: { name: string; sortOrder?: number; active?: boolean }) {
      return apiFetch<{
        id: string;
        name: string;
        sortOrder: number;
        active: boolean;
      }>(`/api/admin/products/categories`, {
        method: 'POST',
        admin: true,
        body: JSON.stringify(payload),
      });
    },

    async updateProductCategory(id: string, payload: { name?: string; sortOrder?: number; active?: boolean }) {
      return apiFetch<{
        id: string;
        name: string;
        sortOrder: number;
        active: boolean;
      }>(`/api/admin/products/categories/${encodeURIComponent(id)}`, {
        method: 'PUT',
        admin: true,
        body: JSON.stringify(payload),
      });
    },

    async deleteProductCategory(id: string) {
      return apiFetch<{ success: boolean }>(`/api/admin/products/categories/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        admin: true,
      });
    },

    async listProducts(options?: { categoryId?: string; activeOnly?: boolean }) {
      const params = new URLSearchParams();
      if (options?.categoryId) params.set('categoryId', options.categoryId);
      if (options?.activeOnly) params.set('activeOnly', 'true');
      const qs = params.toString();
      return apiFetch<Array<{
        id: string;
        name: string;
        description?: string;
        categoryId: string;
        priceCents: number;
        costCents?: number;
        sku?: string;
        stockQuantity: number;
        minStockAlert: number;
        commissionPct: number;
        active: boolean;
        imageUrl?: string;
        createdAt: string;
        updatedAt: string;
      }>>(`/api/admin/products${qs ? `?${qs}` : ''}`, { admin: true });
    },

    async getProduct(id: string) {
      return apiFetch<{
        id: string;
        name: string;
        description?: string;
        categoryId: string;
        priceCents: number;
        costCents?: number;
        stockQuantity: number;
        minStockAlert: number;
        commissionPct: number;
        active: boolean;
      }>(`/api/admin/products/${encodeURIComponent(id)}`, { admin: true });
    },

    async createProduct(payload: {
      name: string;
      description?: string;
      categoryId: string;
      priceCents: number;
      costCents?: number;
      stockQuantity?: number;
      minStockAlert?: number;
      commissionPct?: number;
      active?: boolean;
    }) {
      return apiFetch<{
        id: string;
        name: string;
        categoryId: string;
        priceCents: number;
        stockQuantity: number;
        commissionPct: number;
        active: boolean;
      }>(`/api/admin/products`, {
        method: 'POST',
        admin: true,
        body: JSON.stringify(payload),
      });
    },

    async updateProduct(id: string, payload: {
      name?: string;
      description?: string;
      categoryId?: string;
      priceCents?: number;
      costCents?: number;
      stockQuantity?: number;
      minStockAlert?: number;
      commissionPct?: number;
      active?: boolean;
    }) {
      return apiFetch<{
        id: string;
        name: string;
        categoryId: string;
        priceCents: number;
        stockQuantity: number;
        commissionPct: number;
        active: boolean;
      }>(`/api/admin/products/${encodeURIComponent(id)}`, {
        method: 'PUT',
        admin: true,
        body: JSON.stringify(payload),
      });
    },

    async deleteProduct(id: string) {
      return apiFetch<{ success: boolean }>(`/api/admin/products/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        admin: true,
      });
    },

    // ============================================================
    // VENDAS DE PRODUTOS
    // ============================================================

    async listSales(options?: {
      barberId?: string;
      dateKey?: string;
      startDate?: string;
      endDate?: string;
      origin?: 'standalone' | 'booking';
      productId?: string;
    }) {
      const params = new URLSearchParams();
      if (options?.barberId) params.set('barberId', options.barberId);
      if (options?.dateKey) params.set('dateKey', options.dateKey);
      if (options?.startDate) params.set('startDate', options.startDate);
      if (options?.endDate) params.set('endDate', options.endDate);
      if (options?.origin) params.set('origin', options.origin);
      if (options?.productId) params.set('productId', options.productId);
      const qs = params.toString();
      return apiFetch<Array<{
        id: string;
        customerId?: string;
        customerName?: string;
        barberId: string;
        barberName?: string;
        items: Array<{
          productId: string;
          productName: string;
          quantity: number;
          unitPriceCents: number;
          commissionPct: number;
        }>;
        totalCents: number;
        commissionCents: number;
        paymentMethod: 'credit' | 'debit' | 'cash' | 'pix';
        origin: 'standalone' | 'booking';
        bookingId?: string;
        dateKey: string;
        createdAt: string;
        completedAt?: string;
      }>>(`/api/admin/sales${qs ? `?${qs}` : ''}`, { admin: true });
    },

    async deleteSale(id: string) {
      return apiFetch<{ success: boolean }>(`/api/admin/sales/${id}`, {
        admin: true,
        method: 'DELETE',
      });
    },

    async getSale(id: string) {
      return apiFetch<{
        id: string;
        customerId?: string;
        customerName?: string;
        barberId: string;
        barberName?: string;
        items: Array<{
          productId: string;
          productName: string;
          quantity: number;
          unitPriceCents: number;
        }>;
        totalCents: number;
        commissionCents: number;
        paymentMethod: 'credit' | 'debit' | 'cash' | 'pix';
        origin: 'standalone' | 'booking';
        bookingId?: string;
        dateKey: string;
        createdAt: string;
      }>(`/api/admin/sales/${encodeURIComponent(id)}`, { admin: true });
    },

    async createSale(payload: {
      customerId?: string;
      customerName?: string;
      barberId: string;
      items: Array<{ productId: string; quantity: number }>;
      paymentMethod: 'credit' | 'debit' | 'cash' | 'pix';
      origin?: 'standalone' | 'booking';
      bookingId?: string;
    }) {
      return apiFetch<{
        id: string;
        totalCents: number;
        commissionCents: number;
      }>(`/api/admin/sales`, {
        method: 'POST',
        admin: true,
        body: JSON.stringify(payload),
      });
    },

    // ============================================================
    // ESTOQUE
    // ============================================================

    async listStockMovements(options?: { productId?: string; limit?: number }) {
      const params = new URLSearchParams();
      if (options?.productId) params.set('productId', options.productId);
      if (options?.limit) params.set('limit', String(options.limit));
      const qs = params.toString();
      return apiFetch<Array<{
        id: string;
        productId: string;
        productName: string;
        type: 'in' | 'out' | 'adjustment' | 'sale';
        quantity: number;
        previousQuantity: number;
        newQuantity: number;
        reason: string;
        saleId?: string;
        createdBy: string;
        createdAt: string;
      }>>(`/api/admin/stock/movements${qs ? `?${qs}` : ''}`, { admin: true });
    },

    async createStockMovement(payload: {
      productId: string;
      type: 'in' | 'out' | 'adjustment';
      quantity: number;
      reason: string;
    }) {
      return apiFetch<{
        id: string;
        productId: string;
        type: string;
        quantity: number;
        previousQuantity: number;
        newQuantity: number;
      }>(`/api/admin/stock/movements`, {
        method: 'POST',
        admin: true,
        body: JSON.stringify(payload),
      });
    },

    async getStockAlerts() {
      return apiFetch<Array<{
        productId: string;
        productName: string;
        categoryName: string;
        currentStock: number;
        minStock: number;
        status: 'low' | 'out';
        notifiedAt?: string;
      }>>(`/api/admin/stock/alerts`, { admin: true });
    },

    async getProductsSummary(options?: { startDate?: string; endDate?: string; barberId?: string }) {
      const params = new URLSearchParams();
      if (options?.startDate) params.set('startDate', options.startDate);
      if (options?.endDate) params.set('endDate', options.endDate);
      if (options?.barberId) params.set('barberId', options.barberId);
      const qs = params.toString();
      return apiFetch<{
        totalSales: number;
        totalRevenueCents: number;
        totalCommissionCents: number;
        totalItemsSold: number;
        byCategory: Array<{
          categoryId: string;
          categoryName: string;
          revenueCents: number;
          itemsSold: number;
        }>;
        byProduct: Array<{
          productId: string;
          productName: string;
          revenueCents: number;
          quantitySold: number;
        }>;
        byPaymentMethod: Array<{
          method: 'credit' | 'debit' | 'cash' | 'pix';
          revenueCents: number;
          count: number;
        }>;
        byBarber: Array<{
          barberId: string;
          barberName: string;
          revenueCents: number;
          commissionCents: number;
          salesCount: number;
          itemsSold: number;
        }>;
      }>(`/api/admin/products/summary${qs ? `?${qs}` : ''}`, { admin: true });
    },

    logout() {
      setAdminToken(null);
    },
  },

  async services(barberId?: string) {
    const qs = barberId ? `?barberId=${encodeURIComponent(barberId)}` : '';
    return apiFetch<{
      items: Array<{
        id: string;
        label: string;
        priceCents: number;
        popularLast90DaysCount?: number;
        isMostPopular?: boolean;
      }>;
    }>(`/api/services${qs}`);
  },

  async getBranding() {
    return apiFetch<BrandingSettings>(`/api/branding`);
  },

  async availability(barberId: string, dateKey: string) {
    return apiFetch<{ bookedSlotIds: string[]; blockedSlotIds: string[]; blockReasons?: Record<string, string>; schedule: BarberSchedule | null }>(
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


