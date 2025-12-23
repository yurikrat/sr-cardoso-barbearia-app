import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
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
};

function getEnv(): Env {
  return {
    PORT: process.env.PORT ?? '8080',
    GCP_PROJECT_ID: process.env.GCP_PROJECT_ID,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    ADMIN_JWT_SECRET: process.env.ADMIN_JWT_SECRET,
    WEB_ORIGIN: process.env.WEB_ORIGIN,
    STATIC_DIR: process.env.STATIC_DIR,
  };
}

const env = getEnv();

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

    await db.runTransaction(async (tx) => {
      const slotRef = db.collection('barbers').doc(validated.barberId).collection('slots').doc(slotId);
      const slotDoc = await tx.get(slotRef);
      if (slotDoc.exists) {
        const err = new Error('already-exists');
        (err as any).code = 'already-exists';
        throw err;
      }

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

      const customerRef = db.collection('customers').doc(customerId);
      const customerDoc = await tx.get(customerRef);
      const now = Timestamp.now();

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

    return res.json({ success: true, bookingId });
  } catch (e: unknown) {
    if (e && typeof e === 'object' && (e as any).code === 'already-exists') {
      return res.status(409).json({ error: 'Este horário já foi reservado. Selecione outro.' });
    }
    return res.status(400).json({ error: 'Dados inválidos ou erro ao criar reserva' });
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

app.listen(Number(env.PORT), () => {
  console.log(`[server] listening on :${env.PORT}`);
});


