import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash, randomBytes } from 'crypto';
import { DateTime } from 'luxon';
import { Firestore, FieldValue, Timestamp } from '@google-cloud/firestore';
import { SignJWT, jwtVerify } from 'jose';
import {
  createBookingRequestSchema,
  generateCustomerId,
  generateSlotId,
  getDateKey,
  isSunday,
  isValidTimeSlot,
  normalizeToE164,
} from '@sr-cardoso/shared';

type Env = {
  PORT: string;
  GCP_PROJECT_ID?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_JWT_SECRET?: string;
  WEB_ORIGIN?: string;
  STATIC_DIR?: string;
  CANCEL_LINK_PEPPER?: string;
};

function getEnv(): Env {
  return {
    PORT: process.env.PORT ?? '8080',
    GCP_PROJECT_ID: process.env.GCP_PROJECT_ID,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    ADMIN_JWT_SECRET: process.env.ADMIN_JWT_SECRET,
    WEB_ORIGIN: process.env.WEB_ORIGIN,
    STATIC_DIR: process.env.STATIC_DIR,
    CANCEL_LINK_PEPPER: process.env.CANCEL_LINK_PEPPER,
  };
}

const env = getEnv();

console.log('[server] Starting up...');
console.log('[server] Environment:', {
  PORT: env.PORT,
  GCP_PROJECT_ID: env.GCP_PROJECT_ID,
  NODE_ENV: process.env.NODE_ENV,
});

const db = new Firestore(
  env.GCP_PROJECT_ID
    ? { projectId: env.GCP_PROJECT_ID }
    : undefined
);

const app = express();
app.use(helmet());
app.use(
  cors({
    origin: env.WEB_ORIGIN ? [env.WEB_ORIGIN] : true,
    credentials: false,
  })
);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

function getAuthHeader(req: express.Request) {
  const h = req.headers.authorization;
  if (!h || typeof h !== 'string') return null;
  return h;
}

async function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const secret = env.ADMIN_JWT_SECRET;
    if (!secret) return res.status(500).json({ error: 'ADMIN_JWT_SECRET não configurado' });
    const auth = getAuthHeader(req);
    if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Não autenticado' });

    const token = auth.slice('Bearer '.length);
    const key = new TextEncoder().encode(secret);
    await jwtVerify(token, key, { algorithms: ['HS256'] });
    return next();
  } catch {
    return res.status(401).json({ error: 'Token inválido/expirado' });
  }
}

app.post('/api/admin/login', async (req, res) => {
  const password = (req.body as { password?: unknown })?.password;
  if (typeof password !== 'string') return res.status(400).json({ error: 'password é obrigatório' });

  if (!env.ADMIN_PASSWORD) return res.status(500).json({ error: 'ADMIN_PASSWORD não configurado' });
  if (!env.ADMIN_JWT_SECRET) return res.status(500).json({ error: 'ADMIN_JWT_SECRET não configurado' });

  if (password !== env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Credenciais inválidas' });

  const key = new TextEncoder().encode(env.ADMIN_JWT_SECRET);
  const token = await new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(key);

  return res.json({ token });
});

app.get('/api/admin/barbers', requireAdmin, async (_req, res) => {
  try {
    const snapshot = await db.collection('barbers').get();
    const items = snapshot.docs
      .map((doc) => {
        const data = doc.data() as { name?: unknown; active?: unknown };
        const name = typeof data?.name === 'string' && data.name.trim() ? data.name.trim() : doc.id;
        const active = typeof data?.active === 'boolean' ? data.active : true;
        return { id: doc.id, name, active };
      })
      .filter((b) => b.active);

    items.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    return res.json({ items });
  } catch (err) {
    console.error('Error listing barbers:', err);
    return res.status(500).json({ error: 'Erro ao listar barbeiros' });
  }
});

app.get('/api/admin/barbers/:barberId', requireAdmin, async (req, res) => {
  try {
    const barberId = req.params.barberId;
    const barberDoc = await db.collection('barbers').doc(barberId).get();
    if (!barberDoc.exists) return res.status(404).json({ error: 'Barbeiro não encontrado' });
    const data = barberDoc.data() as any;
    return res.json({ calendarFeedToken: (data?.calendarFeedToken as string | undefined) ?? null });
  } catch {
    return res.status(500).json({ error: 'Erro ao carregar barbeiro' });
  }
});

function getServicePriceCents(serviceType: string): number {
  const cabelo = Number(process.env.PRICE_CABELO_CENTS ?? '4500');
  const barba = Number(process.env.PRICE_BARBA_CENTS ?? '3500');
  const combo = Number(process.env.PRICE_CABELO_BARBA_CENTS ?? '7000');
  if (serviceType === 'cabelo') return Number.isFinite(cabelo) ? cabelo : 4500;
  if (serviceType === 'barba') return Number.isFinite(barba) ? barba : 3500;
  if (serviceType === 'cabelo_barba') return Number.isFinite(combo) ? combo : 7000;
  return 0;
}

app.get('/api/admin/finance/summary', requireAdmin, async (req, res) => {
  try {
    const startDateKey = typeof req.query.startDateKey === 'string' ? req.query.startDateKey : null;
    const endDateKey = typeof req.query.endDateKey === 'string' ? req.query.endDateKey : null;
    const barberId = typeof req.query.barberId === 'string' ? req.query.barberId : null;

    if (!startDateKey || !endDateKey) {
      return res.status(400).json({ error: 'startDateKey e endDateKey são obrigatórios' });
    }

    let q: FirebaseFirestore.Query = db
      .collection('bookings')
      .where('dateKey', '>=', startDateKey)
      .where('dateKey', '<=', endDateKey);

    if (barberId) q = q.where('barberId', '==', barberId);

    const snap = await q.get();

    const countsByServiceType: Record<string, number> = {};
    const countsByStatus: Record<string, number> = {};
    let totalBookings = 0;
    let estimatedRevenueCents = 0;
    let realizedRevenueCents = 0;

    const nowSP = DateTime.now().setZone('America/Sao_Paulo');
    const todayKey = nowSP.toFormat('yyyy-MM-dd');
    const selectedStart = DateTime.fromFormat(startDateKey, 'yyyy-MM-dd', { zone: 'America/Sao_Paulo' }).startOf('day');
    const selectedMonthKey = selectedStart.isValid ? selectedStart.toFormat('yyyy-MM') : null;
    const currentMonthKey = nowSP.toFormat('yyyy-MM');

    snap.forEach((doc) => {
      const data = doc.data() as { serviceType?: unknown; status?: unknown };
      const serviceType = typeof data.serviceType === 'string' ? data.serviceType : 'unknown';
      const status = typeof data.status === 'string' ? data.status : 'unknown';

      totalBookings += 1;
      countsByServiceType[serviceType] = (countsByServiceType[serviceType] ?? 0) + 1;
      countsByStatus[status] = (countsByStatus[status] ?? 0) + 1;

      // Previsto: booked/confirmed. Realizado: completed. Ignora cancelled/no_show/rescheduled.
      if (['booked', 'confirmed'].includes(status)) estimatedRevenueCents += getServicePriceCents(serviceType);
      if (status === 'completed') realizedRevenueCents += getServicePriceCents(serviceType);
    });

    async function sumCompletedRevenueByDateKeyRange(range: {
      startKey: string;
      endKey: string;
      cutoffKey?: string | null;
    }): Promise<{ total: number; toCutoff: number }>{
      let qq: FirebaseFirestore.Query = db
        .collection('bookings')
        .where('dateKey', '>=', range.startKey)
        .where('dateKey', '<=', range.endKey);
      if (barberId) qq = qq.where('barberId', '==', barberId);

      const s = await qq.get();
      let total = 0;
      let toCutoff = 0;
      s.forEach((d) => {
        const data = d.data() as any;
        const status = typeof data.status === 'string' ? data.status : 'unknown';
        if (status !== 'completed') return;
        const serviceType = typeof data.serviceType === 'string' ? data.serviceType : 'unknown';
        const price = getServicePriceCents(serviceType);
        total += price;
        const dk = typeof data.dateKey === 'string' ? data.dateKey : null;
        if (range.cutoffKey && dk && dk <= range.cutoffKey) toCutoff += price;
      });
      return { total, toCutoff };
    }

    async function computeShowUpRate90d(): Promise<number> {
      const start = nowSP.minus({ days: 90 }).toFormat('yyyy-MM-dd');
      const end = todayKey;
      let qq: FirebaseFirestore.Query = db
        .collection('bookings')
        .where('dateKey', '>=', start)
        .where('dateKey', '<=', end);
      if (barberId) qq = qq.where('barberId', '==', barberId);
      const s = await qq.get();
      let completed = 0;
      let noShow = 0;
      s.forEach((d) => {
        const data = d.data() as any;
        const status = typeof data.status === 'string' ? data.status : 'unknown';
        if (status === 'completed') completed += 1;
        if (status === 'no_show') noShow += 1;
      });
      const denom = completed + noShow;
      if (denom <= 0) return 0.9;
      const rate = completed / denom;
      // Conservative clamp to avoid extreme swings when data is sparse.
      return Math.min(0.98, Math.max(0.5, rate));
    }

    let projectionRevenueCents: number | null = null;
    if (selectedMonthKey && selectedMonthKey === currentMonthKey) {
      // Current-month forecast: pace model = realized-to-date + booked-remaining * showUpRate + late-booking baseline.
      const showUpRate = await computeShowUpRate90d();

      let realizedToDate = 0;
      let pipelineRemaining = 0;

      snap.forEach((doc) => {
        const data = doc.data() as any;
        const status = typeof data.status === 'string' ? data.status : 'unknown';
        const serviceType = typeof data.serviceType === 'string' ? data.serviceType : 'unknown';
        const dk = typeof data.dateKey === 'string' ? data.dateKey : null;
        const price = getServicePriceCents(serviceType);
        if (!dk) return;
        if (status === 'completed' && dk <= todayKey) realizedToDate += price;
        if (['booked', 'confirmed'].includes(status) && dk > todayKey) pipelineRemaining += price;
      });

      // Baseline for the remaining part of the month from last 3 months at the same day-of-month.
      const dayN = nowSP.day;
      const remainingSamples: number[] = [];
      for (let i = 1; i <= 3; i++) {
        const mStart = selectedStart.minus({ months: i }).startOf('month');
        const mEnd = mStart.endOf('month');
        const mCutoffDay = Math.min(dayN, mStart.daysInMonth);
        const cutoffKey = mStart.plus({ days: mCutoffDay - 1 }).toFormat('yyyy-MM-dd');

        const hist = await sumCompletedRevenueByDateKeyRange({
          startKey: mStart.toFormat('yyyy-MM-dd'),
          endKey: mEnd.toFormat('yyyy-MM-dd'),
          cutoffKey,
        });
        if (hist.total > 0) remainingSamples.push(Math.max(0, hist.total - hist.toCutoff));
      }

      const baselineRemaining =
        remainingSamples.length > 0
          ? Math.round(remainingSamples.reduce((a, b) => a + b, 0) / remainingSamples.length)
          : 0;

      // Portion not yet visible in pipeline tends to come from late bookings/walk-ins.
      const lateGap = Math.max(0, baselineRemaining - pipelineRemaining);
      const lateFillRate = 0.7;

      projectionRevenueCents = Math.round(
        realizedToDate + pipelineRemaining * showUpRate + lateGap * lateFillRate
      );
    } else if (selectedMonthKey) {
      // If month is in the past: projection equals realized.
      const selectedMonthStartKey = selectedStart.startOf('month').toFormat('yyyy-MM-dd');
      const selectedMonthEndKey = selectedStart.endOf('month').toFormat('yyyy-MM-dd');
      const selectedMonthIsPast = selectedMonthEndKey < todayKey;
      if (selectedMonthIsPast) {
        projectionRevenueCents = realizedRevenueCents;
      } else {
        // Future-month forecast: blend of EWMA trend (last 6 months) + seasonal naive (same month last year).
        const totals: number[] = [];
        for (let i = 6; i >= 1; i--) {
          const mStart = selectedStart.minus({ months: i }).startOf('month');
          const mEnd = mStart.endOf('month');
          const hist = await sumCompletedRevenueByDateKeyRange({
            startKey: mStart.toFormat('yyyy-MM-dd'),
            endKey: mEnd.toFormat('yyyy-MM-dd'),
          });
          totals.push(hist.total);
        }

        let ewma = totals.length ? totals[0] : 0;
        const alpha = 0.35;
        for (let i = 1; i < totals.length; i++) ewma = Math.round(alpha * totals[i] + (1 - alpha) * ewma);

        const lastYearStart = selectedStart.minus({ years: 1 }).startOf('month');
        const lastYearEnd = lastYearStart.endOf('month');
        const seasonal = await sumCompletedRevenueByDateKeyRange({
          startKey: lastYearStart.toFormat('yyyy-MM-dd'),
          endKey: lastYearEnd.toFormat('yyyy-MM-dd'),
        });

        const seasonalValue = seasonal.total;
        const avg3 = totals.slice(-3).reduce((a, b) => a + b, 0) / Math.max(1, totals.slice(-3).length);

        const trendForecast = ewma || Math.round(avg3);
        const seasonalForecast = seasonalValue || Math.round(avg3);

        projectionRevenueCents = Math.round(0.6 * trendForecast + 0.4 * seasonalForecast);
      }
    }

    return res.json({
      startDateKey,
      endDateKey,
      barberId,
      totalBookings,
      // Backwards-compat: total (previsto + realizado)
      revenueCents: estimatedRevenueCents + realizedRevenueCents,
      estimatedRevenueCents,
      realizedRevenueCents,
      projectionRevenueCents,
      countsByServiceType,
      countsByStatus,
      pricingCents: {
        cabelo: getServicePriceCents('cabelo'),
        barba: getServicePriceCents('barba'),
        cabelo_barba: getServicePriceCents('cabelo_barba'),
      },
    });
  } catch (err) {
    console.error('Error building finance summary:', err);
    return res.status(500).json({ error: 'Erro ao carregar financeiro' });
  }
});

app.get('/api/availability', async (req, res) => {
  try {
    const barberId = typeof req.query.barberId === 'string' ? req.query.barberId : null;
    const dateKey = typeof req.query.dateKey === 'string' ? req.query.dateKey : null;
    if (!barberId || !dateKey) return res.status(400).json({ error: 'barberId e dateKey são obrigatórios' });

    const slotsRef = db.collection('barbers').doc(barberId).collection('slots');
    const snapshot = await slotsRef.where('dateKey', '==', dateKey).get();
    const bookedSlotIds: string[] = [];
    const blockedSlotIds: string[] = [];

    snapshot.forEach((doc) => {
      const data = doc.data() as { kind?: unknown };
      if (data.kind === 'booking') bookedSlotIds.push(doc.id);
      if (data.kind === 'block') blockedSlotIds.push(doc.id);
    });

    return res.json({ bookedSlotIds, blockedSlotIds });
  } catch (e) {
    return res.status(500).json({ error: 'Erro ao carregar disponibilidade' });
  }
});

function getCancelLinkPepper(): string {
  const pepper = env.CANCEL_LINK_PEPPER ?? env.ADMIN_JWT_SECRET ?? env.GCP_PROJECT_ID;
  if (!pepper) {
    console.warn('[server] WARNING: CANCEL_LINK_PEPPER not set; using insecure dev fallback');
    return 'dev-pepper';
  }
  return pepper;
}

function hashCancelCode(cancelCode: string): string {
  const pepper = getCancelLinkPepper();
  return createHash('sha256').update(`${pepper}:${cancelCode}`).digest('hex');
}

function generateCancelCode(): string {
  // 16 bytes -> ~22 chars base64url (curto e difícil de adivinhar)
  return randomBytes(16).toString('base64url');
}

type BookingDoc = {
  barberId: string;
  serviceType: string;
  slotStart: Timestamp;
  status?: string;
  customer?: {
    firstName?: string;
    lastName?: string;
    whatsappE164?: string;
  };
};

async function getBookingById(bookingId: string): Promise<{ id: string; data: BookingDoc } | null> {
  const bookingRef = db.collection('bookings').doc(bookingId);
  const bookingDoc = await bookingRef.get();
  if (!bookingDoc.exists) return null;
  return { id: bookingDoc.id, data: bookingDoc.data() as BookingDoc };
}

async function getBarberName(barberId: string): Promise<string> {
  const barberDoc = await db.collection('barbers').doc(barberId).get();
  if (!barberDoc.exists) return barberId;
  const data = barberDoc.data() as { name?: unknown } | undefined;
  return typeof data?.name === 'string' && data.name.trim() ? data.name.trim() : barberId;
}

app.get('/api/calendar/booking.ics', (req, res) => {
  const bookingId = typeof req.query.bookingId === 'string' ? req.query.bookingId : null;
  if (bookingId) {
    void (async () => {
      const booking = await getBookingById(bookingId);
      if (!booking) return res.status(404).send('Agendamento não encontrado');

      const status = booking.data.status;
      if (status && !['booked', 'confirmed'].includes(status)) {
        return res.status(410).send('Agendamento cancelado/indisponível');
      }

      const SERVICE_LABELS: Record<string, string> = {
        cabelo: 'Corte de Cabelo',
        barba: 'Barba',
        cabelo_barba: 'Corte de Cabelo + Barba',
      };

      const label = SERVICE_LABELS[booking.data.serviceType] ?? booking.data.serviceType;
      const barberName = await getBarberName(booking.data.barberId);
      const customerName = `${booking.data.customer?.firstName ?? ''} ${booking.data.customer?.lastName ?? ''}`.trim();
      const customerWhatsApp = booking.data.customer?.whatsappE164 ?? '';

      const start = DateTime.fromJSDate(booking.data.slotStart.toDate(), { zone: 'America/Sao_Paulo' });
      const end = start.plus({ minutes: 30 });

      const summary = `${label}${barberName ? ` - ${barberName}` : ''}`;
      const descriptionLines = [
        'Agendamento na Barbearia Sr. Cardoso',
        '',
        `Serviço: ${label}`,
        barberName ? `Barbeiro: ${barberName}` : null,
        customerName ? `Cliente: ${customerName}` : null,
        customerWhatsApp ? `WhatsApp: ${customerWhatsApp}` : null,
      ].filter(Boolean) as string[];

      const icsLines: string[] = [];
      icsLines.push('BEGIN:VCALENDAR');
      icsLines.push('VERSION:2.0');
      icsLines.push('PRODID:-//Sr Cardoso Barbearia//Booking System//PT');
      icsLines.push('CALSCALE:GREGORIAN');
      icsLines.push('METHOD:PUBLISH');
      icsLines.push('BEGIN:VEVENT');
      icsLines.push(`UID:${bookingId}@sr-cardoso.com`);
      icsLines.push(`DTSTAMP:${DateTime.now().toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}`);
      icsLines.push(`DTSTART:${start.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}`);
      icsLines.push(`DTEND:${end.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}`);
      icsLines.push(`SUMMARY:${escapeICS(summary)}`);
      icsLines.push(`DESCRIPTION:${escapeICS(descriptionLines.join('\n'))}`);
      icsLines.push(`LOCATION:${escapeICS('Barbearia Sr. Cardoso')}`);
      icsLines.push('STATUS:CONFIRMED');
      icsLines.push('SEQUENCE:0');
      icsLines.push('END:VEVENT');
      icsLines.push('END:VCALENDAR');

      const icsContent = icsLines.join('\r\n');
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="agendamento-sr-cardoso.ics"');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.status(200).send(icsContent);
    })().catch((err) => {
      console.error('Error generating booking ICS (by bookingId):', err);
      return res.status(500).send('Erro ao gerar calendário');
    });
    return;
  }

  const serviceType = typeof req.query.serviceType === 'string' ? req.query.serviceType : null;
  const barberName = typeof req.query.barberName === 'string' ? req.query.barberName : '';
  const customerName = typeof req.query.customerName === 'string' ? req.query.customerName : '';
  const slotStartIso = typeof req.query.slotStart === 'string' ? req.query.slotStart : null;

  if (!serviceType || !slotStartIso) {
    return res.status(400).send('serviceType e slotStart são obrigatórios');
  }

  const SERVICE_LABELS: Record<string, string> = {
    cabelo: 'Corte de Cabelo',
    barba: 'Barba',
    cabelo_barba: 'Corte de Cabelo + Barba',
  };

  const label = SERVICE_LABELS[serviceType] ?? serviceType;

  const parsed = DateTime.fromISO(slotStartIso, { setZone: true });
  const start = parsed.isValid ? parsed : DateTime.fromISO(slotStartIso, { zone: 'America/Sao_Paulo' });
  if (!start.isValid) return res.status(400).send('slotStart inválido');

  const end = start.plus({ minutes: 30 });

  const summary = `${label}${barberName ? ` - ${barberName}` : ''}`;
  const descriptionLines = [
    'Agendamento na Barbearia Sr. Cardoso',
    '',
    `Serviço: ${label}`,
    barberName ? `Barbeiro: ${barberName}` : null,
    customerName ? `Cliente: ${customerName}` : null,
  ].filter(Boolean) as string[];

  const icsLines: string[] = [];
  icsLines.push('BEGIN:VCALENDAR');
  icsLines.push('VERSION:2.0');
  icsLines.push('PRODID:-//Sr Cardoso Barbearia//Booking System//PT');
  icsLines.push('CALSCALE:GREGORIAN');
  icsLines.push('METHOD:PUBLISH');
  icsLines.push('BEGIN:VEVENT');
  icsLines.push(
    `UID:${start.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}-${Math.random().toString(36).slice(2)}@sr-cardoso.com`
  );
  icsLines.push(`DTSTAMP:${DateTime.now().toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}`);
  icsLines.push(`DTSTART:${start.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}`);
  icsLines.push(`DTEND:${end.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}`);
  icsLines.push(`SUMMARY:${escapeICS(summary)}`);
  icsLines.push(`DESCRIPTION:${escapeICS(descriptionLines.join('\n'))}`);
  icsLines.push(`LOCATION:${escapeICS('Barbearia Sr. Cardoso')}`);
  icsLines.push('STATUS:CONFIRMED');
  icsLines.push('SEQUENCE:0');
  icsLines.push('END:VEVENT');
  icsLines.push('END:VCALENDAR');

  const icsContent = icsLines.join('\r\n');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="agendamento-sr-cardoso.ics"');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(200).send(icsContent);
});

app.get('/api/calendar/google', (req, res) => {
  const bookingId = typeof req.query.bookingId === 'string' ? req.query.bookingId : null;
  if (!bookingId) return res.status(400).json({ error: 'bookingId é obrigatório' });

  void (async () => {
    const booking = await getBookingById(bookingId);
    if (!booking) return res.status(404).json({ error: 'Agendamento não encontrado' });

    const status = booking.data.status;
    if (status && !['booked', 'confirmed'].includes(status)) {
      return res.status(410).json({ error: 'Agendamento cancelado/indisponível' });
    }

    const SERVICE_LABELS: Record<string, string> = {
      cabelo: 'Corte de Cabelo',
      barba: 'Barba',
      cabelo_barba: 'Corte de Cabelo + Barba',
    };

    const label = SERVICE_LABELS[booking.data.serviceType] ?? booking.data.serviceType;
    const barberName = await getBarberName(booking.data.barberId);
    const customerName = `${booking.data.customer?.firstName ?? ''} ${booking.data.customer?.lastName ?? ''}`.trim();
    const start = DateTime.fromJSDate(booking.data.slotStart.toDate(), { zone: 'America/Sao_Paulo' });
    const end = start.plus({ minutes: 30 });

    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: `${label} - ${barberName}`,
      dates: `${start.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}/${end.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}`,
      details: `Agendamento na Barbearia Sr. Cardoso\n\nServiço: ${label}\nBarbeiro: ${barberName}\nCliente: ${customerName}`,
      location: 'Barbearia Sr. Cardoso',
    });

    const url = `https://calendar.google.com/calendar/render?${params.toString()}`;
    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(302, url);
  })().catch((err) => {
    console.error('Error generating Google calendar redirect:', err);
    return res.status(500).json({ error: 'Erro ao gerar link do Google Agenda' });
  });
});

app.post('/api/public/cancel/:cancelCode', async (req, res) => {
  try {
    const cancelCode = req.params.cancelCode;
    if (!cancelCode || cancelCode.length < 8 || cancelCode.length > 128) {
      return res.status(400).json({ error: 'Código inválido' });
    }

    const cancelCodeHash = hashCancelCode(cancelCode);
    const snap = await db
      .collection('bookings')
      .where('cancelCodeHash', '==', cancelCodeHash)
      .limit(1)
      .get();

    if (snap.empty) return res.status(404).json({ error: 'Agendamento não encontrado' });

    const bookingRef = snap.docs[0].ref;

    await db.runTransaction(async (tx) => {
      const bookingDoc = await tx.get(bookingRef);
      if (!bookingDoc.exists) return;
      const booking = bookingDoc.data() as any;

      if (booking.status === 'cancelled') return;
      if (booking.status && !['booked', 'confirmed'].includes(booking.status)) return;

      const slotStartTs: Timestamp | undefined = booking.slotStart;
      const barberId: string | undefined = booking.barberId;
      if (slotStartTs && barberId) {
        const slotStart = DateTime.fromJSDate(slotStartTs.toDate(), { zone: 'America/Sao_Paulo' });
        const slotId = generateSlotId(slotStart);
        const slotRef = db.collection('barbers').doc(barberId).collection('slots').doc(slotId);
        const slotDoc = await tx.get(slotRef);
        if (slotDoc.exists) tx.delete(slotRef);
      }

      tx.update(bookingRef, {
        status: 'cancelled',
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledReason: 'customer',
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return res.json({ success: true });
  } catch (e) {
    console.error('Error cancelling booking (public):', e);
    return res.status(500).json({ error: 'Erro ao cancelar agendamento' });
  }
});

app.post('/api/bookings', async (req, res) => {
  try {
    const validated = createBookingRequestSchema.parse(req.body);

    const whatsappE164 = normalizeToE164(validated.customer.whatsapp);
    const slotStart = DateTime.fromISO(validated.slotStart, { zone: 'America/Sao_Paulo' });

    if (isSunday(slotStart)) return res.status(400).json({ error: 'Domingo fechado' });
    if (!isValidTimeSlot(slotStart))
      return res.status(400).json({ error: 'Horário inválido (08:00–18:30, 30min)' });

    const barberRef = db.collection('barbers').doc(validated.barberId);
    const barberDoc = await barberRef.get();
    if (!barberDoc.exists) return res.status(404).json({ error: 'Barbeiro não encontrado' });
    const barberData = barberDoc.data() as { active?: unknown } | undefined;
    if (!barberData?.active) return res.status(400).json({ error: 'Barbeiro indisponível' });

    const customerId = generateCustomerId(whatsappE164);
    const slotId = generateSlotId(slotStart);
    const dateKey = getDateKey(slotStart);
    const bookingId = db.collection('bookings').doc().id;

    const cancelCode = generateCancelCode();
    const cancelCodeHash = hashCancelCode(cancelCode);

    await db.runTransaction(async (tx) => {
      const slotRef = db.collection('barbers').doc(validated.barberId).collection('slots').doc(slotId);
      const customerRef = db.collection('customers').doc(customerId);
      // Firestore transactions require ALL reads to happen before ANY writes.
      const [slotDoc, customerDoc] = await Promise.all([tx.get(slotRef), tx.get(customerRef)]);

      if (slotDoc.exists) {
        const err = new Error('already-exists');
        (err as any).code = 'already-exists';
        throw err;
      }

      const now = Timestamp.now();

      tx.set(slotRef, {
        slotStart: Timestamp.fromDate(slotStart.toJSDate()),
        dateKey,
        kind: 'booking',
        bookingId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      const bookingRef = db.collection('bookings').doc(bookingId);
      tx.set(bookingRef, {
        customerId,
        barberId: validated.barberId,
        serviceType: validated.serviceType,
        slotStart: Timestamp.fromDate(slotStart.toJSDate()),
        dateKey,
        cancelCodeHash,
        customer: {
          firstName: validated.customer.firstName,
          lastName: validated.customer.lastName,
          whatsappE164,
        },
        status: 'booked',
        whatsappStatus: 'pending',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      if (!customerDoc.exists) {
        tx.set(customerRef, {
          identity: {
            firstName: validated.customer.firstName,
            lastName: validated.customer.lastName,
            whatsappE164,
          },
          profile: {},
          consent: { marketingOptIn: false },
          stats: {
            firstBookingAt: now,
            lastBookingAt: now,
            totalBookings: 1,
            totalCompleted: 0,
            noShowCount: 0,
          },
        });
      } else {
        tx.update(customerRef, {
          'identity.firstName': validated.customer.firstName,
          'identity.lastName': validated.customer.lastName,
          'stats.lastBookingAt': now,
          'stats.totalBookings': FieldValue.increment(1),
        });
      }
    });

    return res.json({ success: true, bookingId, cancelCode });
  } catch (e: unknown) {
    if (e && typeof e === 'object' && (e as any).code === 'already-exists') {
      return res.status(409).json({ error: 'Este horário já foi reservado. Selecione outro.' });
    }
    console.error('Error creating booking:', e);
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return res.status(400).json({ error: `Erro ao criar reserva: ${msg}` });
  }
});

// --- Admin APIs (caminho B) ---
app.get('/api/admin/bookings', requireAdmin, async (req, res) => {
  try {
    const barberId = typeof req.query.barberId === 'string' ? req.query.barberId : null;
    const dateKey = typeof req.query.dateKey === 'string' ? req.query.dateKey : null;
    if (!barberId || !dateKey) return res.status(400).json({ error: 'barberId e dateKey são obrigatórios' });

    const snapshot = await db
      .collection('bookings')
      .where('barberId', '==', barberId)
      .where('dateKey', '==', dateKey)
      .orderBy('slotStart', 'asc')
      .get();

    const items = snapshot.docs.map((d) => {
      const data = d.data() as any;
      return {
        id: d.id,
        ...data,
        slotStart: data.slotStart?.toDate ? data.slotStart.toDate().toISOString() : null,
      };
    });

    return res.json({ items });
  } catch {
    return res.status(500).json({ error: 'Erro ao carregar bookings' });
  }
});

app.post('/api/admin/bookings/:bookingId/cancel', requireAdmin, async (req, res) => {
  try {
    const bookingId = req.params.bookingId;
    const bookingRef = db.collection('bookings').doc(bookingId);
    const bookingDoc = await bookingRef.get();
    if (!bookingDoc.exists) return res.status(404).json({ error: 'Reserva não encontrada' });
    const booking = bookingDoc.data() as any;
    const slotStartDate: Date | null = booking.slotStart?.toDate ? booking.slotStart.toDate() : null;
    if (!slotStartDate) return res.status(400).json({ error: 'slotStart inválido' });

    const barberId = booking.barberId as string;
    const oldSlotId = generateSlotId(slotStartDate);
    const oldSlotRef = db.collection('barbers').doc(barberId).collection('slots').doc(oldSlotId);

    await db.runTransaction(async (tx) => {
      tx.delete(oldSlotRef);
      tx.update(bookingRef, {
        status: 'cancelled',
        updatedAt: FieldValue.serverTimestamp(),
        cancelledAt: FieldValue.serverTimestamp(),
      });
    });
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Erro ao cancelar' });
  }
});

app.post('/api/admin/bookings/:bookingId/reschedule', requireAdmin, async (req, res) => {
  try {
    const bookingId = req.params.bookingId;
    const newSlotStart = (req.body as { newSlotStart?: unknown })?.newSlotStart;
    if (typeof newSlotStart !== 'string') return res.status(400).json({ error: 'newSlotStart é obrigatório (ISO)' });

    const bookingRef = db.collection('bookings').doc(bookingId);
    const bookingDoc = await bookingRef.get();
    if (!bookingDoc.exists) return res.status(404).json({ error: 'Reserva não encontrada' });
    const booking = bookingDoc.data() as any;

    const newSlot = DateTime.fromISO(newSlotStart, { zone: 'America/Sao_Paulo' });
    if (isSunday(newSlot)) return res.status(400).json({ error: 'Não é possível reagendar para domingo' });
    if (!isValidTimeSlot(newSlot)) return res.status(400).json({ error: 'Horário inválido' });

    const barberId = booking.barberId as string;
    const newSlotId = generateSlotId(newSlot);
    const newDateKey = getDateKey(newSlot);
    const oldSlotDate: Date | null = booking.slotStart?.toDate ? booking.slotStart.toDate() : null;
    if (!oldSlotDate) return res.status(400).json({ error: 'slotStart inválido' });
    const oldSlotId = generateSlotId(oldSlotDate);

    await db.runTransaction(async (tx) => {
      const newSlotRef = db.collection('barbers').doc(barberId).collection('slots').doc(newSlotId);
      const exists = await tx.get(newSlotRef);
      if (exists.exists) {
        const err = new Error('already-exists');
        (err as any).code = 'already-exists';
        throw err;
      }

      tx.set(newSlotRef, {
        slotStart: Timestamp.fromDate(newSlot.toJSDate()),
        dateKey: newDateKey,
        kind: 'booking',
        bookingId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      const oldSlotRef = db.collection('barbers').doc(barberId).collection('slots').doc(oldSlotId);
      tx.delete(oldSlotRef);
      tx.update(bookingRef, {
        slotStart: Timestamp.fromDate(newSlot.toJSDate()),
        dateKey: newDateKey,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return res.json({ success: true });
  } catch (e: unknown) {
    if (e && typeof e === 'object' && (e as any).code === 'already-exists') {
      return res.status(409).json({ error: 'Este horário já está ocupado' });
    }
    return res.status(500).json({ error: 'Erro ao reagendar' });
  }
});

app.post('/api/admin/bookings/:bookingId/whatsapp-sent', requireAdmin, async (req, res) => {
  try {
    const bookingId = req.params.bookingId;
    const bookingRef = db.collection('bookings').doc(bookingId);
    const bookingDoc = await bookingRef.get();
    if (!bookingDoc.exists) return res.status(404).json({ error: 'Reserva não encontrada' });
    const booking = bookingDoc.data() as any;
    const customerId = booking.customerId as string | undefined;
    const customerRef = customerId ? db.collection('customers').doc(customerId) : null;
    const now = Timestamp.now();

    await db.runTransaction(async (tx) => {
      tx.update(bookingRef, {
        whatsappStatus: 'sent',
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (customerRef) {
        tx.update(customerRef, {
          'stats.lastContactAt': now,
        });
      }
    });
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Erro ao marcar WhatsApp enviado' });
  }
});

app.post('/api/admin/bookings/:bookingId/status', requireAdmin, async (req, res) => {
  try {
    const bookingId = req.params.bookingId;
    const nextStatus = (req.body as { status?: unknown })?.status;
    if (typeof nextStatus !== 'string') return res.status(400).json({ error: 'status é obrigatório' });

    const allowed = ['confirmed', 'completed', 'no_show'] as const;
    if (!allowed.includes(nextStatus as any)) return res.status(400).json({ error: 'status inválido' });

    const bookingRef = db.collection('bookings').doc(bookingId);
    const bookingDoc = await bookingRef.get();
    if (!bookingDoc.exists) return res.status(404).json({ error: 'Reserva não encontrada' });
    const booking = bookingDoc.data() as any;

    const currentStatus = typeof booking.status === 'string' ? booking.status : 'booked';
    if (['cancelled', 'rescheduled'].includes(currentStatus)) {
      return res.status(400).json({ error: 'Não é possível alterar status desta reserva' });
    }

    // Simple, safe transitions (no toggling/backwards).
    if (nextStatus === 'confirmed') {
      if (currentStatus !== 'booked') return res.status(400).json({ error: 'Reserva já não está em booked' });
    }
    if (nextStatus === 'completed' || nextStatus === 'no_show') {
      if (!['booked', 'confirmed'].includes(currentStatus)) {
        return res.status(400).json({ error: 'Reserva não pode ser finalizada neste status' });
      }
    }

    const customerId = typeof booking.customerId === 'string' ? booking.customerId : null;
    const customerRef = customerId ? db.collection('customers').doc(customerId) : null;

    await db.runTransaction(async (tx) => {
      const updates: Record<string, unknown> = {
        status: nextStatus,
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (nextStatus === 'completed') updates.completedAt = FieldValue.serverTimestamp();
      if (nextStatus === 'no_show') updates.noShowAt = FieldValue.serverTimestamp();

      tx.update(bookingRef, updates);

      if (customerRef) {
        const customerDoc = await tx.get(customerRef);
        if (customerDoc.exists) {
          if (nextStatus === 'completed') {
            tx.update(customerRef, {
              'stats.totalCompleted': FieldValue.increment(1),
            });
          }
          if (nextStatus === 'no_show') {
            tx.update(customerRef, {
              'stats.noShowCount': FieldValue.increment(1),
            });
          }
        }
      }
    });

    return res.json({ success: true });
  } catch (e) {
    console.error('Error updating booking status:', e);
    return res.status(500).json({ error: 'Erro ao atualizar status' });
  }
});

app.get('/api/admin/week-summary', requireAdmin, async (req, res) => {
  try {
    const barberId = typeof req.query.barberId === 'string' ? req.query.barberId : null;
    const startDateKey = typeof req.query.startDateKey === 'string' ? req.query.startDateKey : null;
    const days = typeof req.query.days === 'string' ? Number(req.query.days) : 6;
    const daysN = Number.isFinite(days) ? Math.min(Math.max(days, 1), 14) : 6;
    if (!barberId || !startDateKey) return res.status(400).json({ error: 'barberId e startDateKey são obrigatórios' });

    const start = DateTime.fromFormat(startDateKey, 'yyyy-MM-dd', { zone: 'America/Sao_Paulo' });
    if (!start.isValid) return res.status(400).json({ error: 'startDateKey inválido' });
    const endKey = start.plus({ days: daysN - 1 }).toFormat('yyyy-MM-dd');

    const items: Record<string, { bookings: number; blocks: number }> = {};
    for (let i = 0; i < daysN; i++) {
      const key = start.plus({ days: i }).toFormat('yyyy-MM-dd');
      items[key] = { bookings: 0, blocks: 0 };
    }

    const bookingsSnap = await db
      .collection('bookings')
      .where('barberId', '==', barberId)
      .where('dateKey', '>=', startDateKey)
      .where('dateKey', '<=', endKey)
      .get();
    bookingsSnap.forEach((d) => {
      const data = d.data() as any;
      const dk = data.dateKey as string | undefined;
      if (dk && items[dk]) items[dk].bookings++;
    });

    const slotsSnap = await db
      .collection('barbers')
      .doc(barberId)
      .collection('slots')
      .where('dateKey', '>=', startDateKey)
      .where('dateKey', '<=', endKey)
      .get();
    slotsSnap.forEach((d) => {
      const data = d.data() as any;
      const dk = data.dateKey as string | undefined;
      if (data.kind === 'block' && dk && items[dk]) items[dk].blocks++;
    });

    return res.json({ items });
  } catch {
    return res.status(500).json({ error: 'Erro ao carregar resumo da semana' });
  }
});

app.post('/api/admin/blocks', requireAdmin, async (req, res) => {
  try {
    const body = req.body as {
      barberId?: unknown;
      startTime?: unknown;
      endTime?: unknown;
      reason?: unknown;
    };
    const barberId = typeof body.barberId === 'string' ? body.barberId : null;
    const startTime = typeof body.startTime === 'string' ? body.startTime : null;
    const endTime = typeof body.endTime === 'string' ? body.endTime : null;
    const reason = typeof body.reason === 'string' ? body.reason : 'Horário bloqueado';
    if (!barberId || !startTime || !endTime) return res.status(400).json({ error: 'Parâmetros inválidos' });

    const start = DateTime.fromISO(startTime, { zone: 'America/Sao_Paulo' });
    const end = DateTime.fromISO(endTime, { zone: 'America/Sao_Paulo' });
    if (!start.isValid || !end.isValid || end <= start) return res.status(400).json({ error: 'Intervalo inválido' });

    const slots: DateTime[] = [];
    let cur = start;
    while (cur < end) {
      slots.push(cur);
      cur = cur.plus({ minutes: 30 });
    }

    await db.runTransaction(async (tx) => {
      for (const slot of slots) {
        if (!isValidTimeSlot(slot) || isSunday(slot)) continue;
        const slotId = generateSlotId(slot);
        const dateKey = getDateKey(slot);
        const slotRef = db.collection('barbers').doc(barberId).collection('slots').doc(slotId);
        const existing = await tx.get(slotRef);
        if (existing.exists) continue;
        tx.set(slotRef, {
          slotStart: Timestamp.fromDate(slot.toJSDate()),
          dateKey,
          kind: 'block',
          reason,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });

    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Erro ao bloquear horários' });
  }
});

app.get('/api/admin/customers', requireAdmin, async (req, res) => {
  try {
    const lim = typeof req.query.limit === 'string' ? Number(req.query.limit) : 100;
    const limitN = Number.isFinite(lim) ? Math.min(Math.max(lim, 1), 500) : 100;
    const snapshot = await db.collection('customers').orderBy('stats.lastBookingAt', 'desc').limit(limitN).get();
    const items = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    return res.json({ items });
  } catch {
    return res.status(500).json({ error: 'Erro ao carregar clientes' });
  }
});

app.get('/api/admin/customers/:customerId', requireAdmin, async (req, res) => {
  try {
    const customerId = req.params.customerId;
    if (!customerId) return res.status(400).json({ error: 'customerId é obrigatório' });

    const customerDoc = await db.collection('customers').doc(customerId).get();
    if (!customerDoc.exists) return res.status(404).json({ error: 'Cliente não encontrado' });

    return res.json({
      item: {
        id: customerDoc.id,
        ...(customerDoc.data() as any),
      },
    });
  } catch {
    return res.status(500).json({ error: 'Erro ao carregar cliente' });
  }
});

app.get('/api/admin/customers/:customerId/bookings', requireAdmin, async (req, res) => {
  try {
    const customerId = req.params.customerId;
    if (!customerId) return res.status(400).json({ error: 'customerId é obrigatório' });

    const lim = typeof req.query.limit === 'string' ? Number(req.query.limit) : 50;
    const limitN = Number.isFinite(lim) ? Math.min(Math.max(lim, 1), 200) : 50;

    // Important: avoid composite index requirements by not ordering in Firestore.
    const snapshot = await db.collection('bookings').where('customerId', '==', customerId).limit(limitN).get();

    const items = snapshot.docs
      .map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          ...data,
          slotStart: data.slotStart?.toDate ? data.slotStart.toDate().toISOString() : null,
        };
      })
      .sort((a, b) => {
        const aMs = typeof a.slotStart === 'string' ? Date.parse(a.slotStart) : 0;
        const bMs = typeof b.slotStart === 'string' ? Date.parse(b.slotStart) : 0;
        return bMs - aMs;
      });

    return res.json({ items });
  } catch {
    return res.status(500).json({ error: 'Erro ao carregar histórico' });
  }
});

app.get('/ical/barber/:barberId/:token.ics', async (req, res) => {
  try {
    const barberId = req.params.barberId;
    const token = req.params.token;
    const barberRef = db.collection('barbers').doc(barberId);
    const barberDoc = await barberRef.get();
    if (!barberDoc.exists) return res.status(404).send('Barbeiro não encontrado');
    const barber = barberDoc.data() as any;
    if (barber.calendarFeedToken !== token) return res.status(403).send('Token inválido');

    const now = Timestamp.now();
    const bookingsSnapshot = await db
      .collection('bookings')
      .where('barberId', '==', barberId)
      .where('slotStart', '>=', now)
      .where('status', 'in', ['booked', 'confirmed'])
      .orderBy('slotStart', 'asc')
      .get();

    const icsLines: string[] = [];
    icsLines.push('BEGIN:VCALENDAR');
    icsLines.push('VERSION:2.0');
    icsLines.push('PRODID:-//Sr Cardoso Barbearia//Agenda//PT');
    icsLines.push('CALSCALE:GREGORIAN');
    icsLines.push('METHOD:PUBLISH');

    bookingsSnapshot.forEach((doc) => {
      const booking = doc.data() as any;
      const slotStart: Date = booking.slotStart.toDate();
      const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);
      const dtStart = formatICSDate(slotStart);
      const dtEnd = formatICSDate(slotEnd);
      const summary = `Atendimento - 30min`;

      icsLines.push('BEGIN:VEVENT');
      icsLines.push(`UID:${doc.id}@sr-cardoso-barbearia`);
      icsLines.push(`DTSTART:${dtStart}`);
      icsLines.push(`DTEND:${dtEnd}`);
      icsLines.push(`SUMMARY:${escapeICS(summary)}`);
      icsLines.push(`DESCRIPTION:${escapeICS(`Serviço: ${booking.serviceType}`)}`);
      icsLines.push('STATUS:CONFIRMED');
      icsLines.push('END:VEVENT');
    });

    icsLines.push('END:VCALENDAR');
    const icsContent = icsLines.join('\r\n');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).send(icsContent);
  } catch {
    return res.status(500).send('Erro ao gerar calendário');
  }
});

function formatICSDate(date: Date): string {
  const dt = DateTime.fromJSDate(date, { zone: 'America/Sao_Paulo' });
  return dt.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
}

function escapeICS(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

// Optional: serve static build (Cloud Run single-service mode)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultStaticDir = path.resolve(__dirname, '../../web/dist');
const staticDir = env.STATIC_DIR ? path.resolve(env.STATIC_DIR) : defaultStaticDir;

app.use(express.static(staticDir));
app.get('*', (_req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

app.listen(Number(env.PORT), '0.0.0.0', () => {
  console.log(`[server] listening on 0.0.0.0:${env.PORT}`);
});

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[server] Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});


