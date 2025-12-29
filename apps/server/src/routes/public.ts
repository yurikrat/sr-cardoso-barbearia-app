import type express from 'express';
import { createHash, randomBytes } from 'crypto';
import { DateTime } from 'luxon';
import { FieldValue, Timestamp } from '@google-cloud/firestore';
import type { Firestore } from '@google-cloud/firestore';
import {
  createBookingRequestSchema,
  generateCustomerId,
  generateSlotId,
  getDateKey,
  isSunday,
  isValidTimeSlot,
  normalizeToE164,
} from '@sr-cardoso/shared';
import type { Env } from '../lib/env.js';
import {
  computeServicesPopularityLast90Days,
  getFinanceConfig,
  getServiceFromConfig,
} from '../lib/finance.js';
import { getBrandingConfig } from '../lib/branding.js';
import { sendBookingConfirmation, sendCancellationConfirmation } from '../services/whatsappNotifications.js';

export type PublicRouteDeps = {
  env: Env;
  db: Firestore;
};

export function registerPublicRoutes(app: express.Express, deps: PublicRouteDeps) {
  const { env, db } = deps;

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.get('/api/branding', async (_req, res) => {
    try {
      const config = await getBrandingConfig(db);
      return res.json(config);
    } catch (e) {
      console.error('Error getting branding:', e);
      return res.status(500).json({ error: 'Erro ao carregar branding' });
    }
  });

  app.get('/api/services', async (_req, res) => {
    try {
      const config = await getFinanceConfig(db);
      const popularity = await computeServicesPopularityLast90Days(db, config);

      const items = config.services
        .filter((s) => s.active)
        .sort((a, b) => {
          if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
          return a.label.localeCompare(b.label, 'pt-BR');
        })
        .map((s) => ({
          id: s.id,
          label: s.label,
          priceCents: s.priceCents,
          popularLast90DaysCount: popularity.countsByServiceType[s.id] ?? 0,
          isMostPopular: popularity.winnerServiceId ? s.id === popularity.winnerServiceId : false,
        }));

      return res.json({ items });
    } catch (e) {
      console.error('Error listing services:', e);
      return res.status(500).json({ error: 'Erro ao listar serviços' });
    }
  });

  app.get('/api/availability', async (req, res) => {
    try {
      const barberId = typeof req.query.barberId === 'string' ? req.query.barberId : null;
      const dateKey = typeof req.query.dateKey === 'string' ? req.query.dateKey : null;
      if (!barberId || !dateKey) return res.status(400).json({ error: 'barberId e dateKey são obrigatórios' });

      const [slotsSnap, barberDoc] = await Promise.all([
        db.collection('barbers').doc(barberId).collection('slots').where('dateKey', '==', dateKey).get(),
        db.collection('barbers').doc(barberId).get()
      ]);

      const bookedSlotIds: string[] = [];
      const blockedSlotIds: string[] = [];

      slotsSnap.forEach((doc) => {
        const data = doc.data() as { kind?: unknown };
        if (data.kind === 'booking') bookedSlotIds.push(doc.id);
        if (data.kind === 'block') blockedSlotIds.push(doc.id);
      });

      const barberData = barberDoc.data() as any;
      const schedule = barberData?.schedule ?? null;

      return res.json({ bookedSlotIds, blockedSlotIds, schedule });
    } catch {
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

  function escapeICS(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  }

  function formatICSDate(date: Date): string {
    const dt = DateTime.fromJSDate(date, { zone: 'America/Sao_Paulo' });
    return dt.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
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

        const financeConfig = await getFinanceConfig(db);
        const service = getServiceFromConfig(financeConfig, booking.data.serviceType);
        const label = service?.label ?? booking.data.serviceType;
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

      const financeConfig = await getFinanceConfig(db);
      const service = getServiceFromConfig(financeConfig, booking.data.serviceType);
      const label = service?.label ?? booking.data.serviceType;
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
      const snap = await db.collection('bookings').where('cancelCodeHash', '==', cancelCodeHash).limit(1).get();

      if (snap.empty) return res.status(404).json({ error: 'Agendamento não encontrado' });

      const bookingRef = snap.docs[0].ref;
      const bookingData = snap.docs[0].data() as any;

      // Guarda dados para envio de mensagem antes de cancelar
      const customerData = {
        id: snap.docs[0].id,
        customerId: bookingData.customerId,
        barberId: bookingData.barberId,
        serviceType: bookingData.serviceType,
        slotStart: bookingData.slotStart?.toDate() || new Date(),
        customer: bookingData.customer,
      };

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

      // Envia confirmação de cancelamento via WhatsApp (em background)
      const baseUrl = env.WEB_ORIGIN || `${req.protocol}://${req.get('host')}`;
      sendCancellationConfirmation(db, env, customerData, baseUrl).catch((err) => {
        console.error('Error sending WhatsApp cancellation confirmation:', err);
      });

      return res.json({ success: true });
    } catch (e) {
      console.error('Error cancelling booking (public):', e);
      return res.status(500).json({ error: 'Erro ao cancelar agendamento' });
    }
  });

  app.get('/api/customers/lookup', async (req, res) => {
    try {
      const phone = typeof req.query.phone === 'string' ? req.query.phone : null;
      if (!phone) return res.status(400).json({ error: 'phone é obrigatório' });

      const whatsappE164 = normalizeToE164(phone);
      const customerId = generateCustomerId(whatsappE164);
      const customerDoc = await db.collection('customers').doc(customerId).get();

      if (!customerDoc.exists) {
        return res.json({ found: false, hasBirthDate: false });
      }

      const data = customerDoc.data() as any;
      const firstName = data?.identity?.firstName;
      const lastName = data?.identity?.lastName;
      const birthDate = data?.profile?.birthday;

      return res.json({
        found: true,
        firstName: firstName || undefined,
        lastNameInitial: lastName ? lastName.charAt(0).toUpperCase() : undefined,
        hasBirthDate: !!birthDate,
      });
    } catch (e) {
      console.error('Error looking up customer:', e);
      return res.status(500).json({ error: 'Erro ao buscar cliente' });
    }
  });

  app.post('/api/bookings', async (req, res) => {
    try {
      const validated = createBookingRequestSchema.parse(req.body);

      const financeConfig = await getFinanceConfig(db);
      const service = getServiceFromConfig(financeConfig, validated.serviceType);
      if (!service || !service.active) {
        return res.status(400).json({ error: 'Serviço inválido' });
      }

      const whatsappE164 = normalizeToE164(validated.customer.whatsapp);
      const slotStart = DateTime.fromISO(validated.slotStart, { zone: 'America/Sao_Paulo' });

      if (isSunday(slotStart)) return res.status(400).json({ error: 'Domingo fechado' });
      if (!isValidTimeSlot(slotStart)) {
        return res.status(400).json({ error: 'Horário inválido (deve ser múltiplo de 30min)' });
      }

      const barberRef = db.collection('barbers').doc(validated.barberId);
      const barberDoc = await barberRef.get();
      if (!barberDoc.exists) return res.status(404).json({ error: 'Barbeiro não encontrado' });
      const barberData = barberDoc.data() as { active?: unknown; schedule?: any } | undefined;
      if (!barberData?.active) return res.status(400).json({ error: 'Barbeiro indisponível' });

      // Validate against barber's schedule
      if (barberData?.schedule) {
        const dayKey = slotStart.weekday === 7 ? '0' : slotStart.weekday.toString();
        const dayConfig = barberData.schedule[dayKey];
        if (dayConfig && dayConfig.active) {
          const slotTime = slotStart.toFormat('HH:mm');
          const [startH, startM] = dayConfig.start.split(':').map(Number);
          const [endH, endM] = dayConfig.end.split(':').map(Number);
          const dayStart = slotStart.set({ hour: startH, minute: startM });
          const dayEnd = slotStart.set({ hour: endH, minute: endM });
          const lastSlotStart = dayEnd.minus({ minutes: 30 });
          
          if (slotStart < dayStart || slotStart > lastSlotStart) {
            return res.status(400).json({ error: 'Horário fora do expediente configurado' });
          }
          
          // Check if slot is within a break
          if (dayConfig.breaks && Array.isArray(dayConfig.breaks)) {
            const isInBreak = dayConfig.breaks.some((brk: any) => {
              return slotTime >= brk.start && slotTime < brk.end;
            });
            if (isInBreak) {
              return res.status(400).json({ error: 'Horário está em período de pausa' });
            }
          }
        } else {
          return res.status(400).json({ error: 'Barbeiro não atende neste dia' });
        }
      }

      const customerId = generateCustomerId(whatsappE164);
      const slotId = generateSlotId(slotStart);
      const dateKey = getDateKey(slotStart);
      const bookingId = db.collection('bookings').doc().id;

      const cancelCode = generateCancelCode();
      const cancelCodeHash = hashCancelCode(cancelCode);

      await db.runTransaction(async (tx) => {
        const slotRef = db.collection('barbers').doc(validated.barberId).collection('slots').doc(slotId);
        const customerRef = db.collection('customers').doc(customerId);
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
            profile: {
              birthday: validated.customer.birthDate || null,
            },
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
          const updates: Record<string, any> = {
            'stats.lastBookingAt': now,
            'stats.totalBookings': FieldValue.increment(1),
          };

          const isInitial = validated.customer.lastName.length === 2 && validated.customer.lastName.endsWith('.');
          if (!isInitial) {
            updates['identity.firstName'] = validated.customer.firstName;
            updates['identity.lastName'] = validated.customer.lastName;
          }

          if (validated.customer.birthDate) {
            updates['profile.birthday'] = validated.customer.birthDate;
          }
          tx.update(customerRef, updates);
        }
      });

      // Envia confirmação automática via WhatsApp (em background, não bloqueia resposta)
      const baseUrl = env.WEB_ORIGIN || `${req.protocol}://${req.get('host')}`;
      sendBookingConfirmation(
        db,
        env,
        {
          id: bookingId,
          customerId,
          barberId: validated.barberId,
          serviceType: validated.serviceType,
          slotStart: slotStart.toJSDate(),
          customer: {
            firstName: validated.customer.firstName,
            lastName: validated.customer.lastName,
            whatsappE164,
          },
        },
        cancelCode,
        baseUrl
      ).catch((err) => {
        console.error('Error sending WhatsApp confirmation:', err);
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
}
