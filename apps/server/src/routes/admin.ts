import type express from 'express';
import { DateTime } from 'luxon';
import { FieldValue, Timestamp } from '@google-cloud/firestore';
import type { Firestore } from '@google-cloud/firestore';
import { createHash } from 'crypto';
import multer from 'multer';
import sharp from 'sharp';
import {
  generateSlotId,
  getDateKey,
  isSunday,
  isValidTimeSlot,
  generateCustomerId,
  normalizeToE164,
  adminWhatsappConnectRequestSchema,
  adminWhatsappSendTestRequestSchema,
  adminWhatsappSendConfirmationRequestSchema,
  type AdminWhatsappStatusResponse,
  type BrandingSettings,
} from '@sr-cardoso/shared';
import type { Env } from '../lib/env.js';
import {
  createEvolutionClient,
  extractConnectionState,
  extractPairingCode,
  extractQrBase64,
  getEvolutionInstanceName,
  toEvolutionNumber,
  type EvolutionRequestError,
} from '../lib/evolutionApi.js';
import {
  OWNER_BARBER_ID,
  FINANCE_CONFIG_DOC_PATH,
  getBarberCommissionPct,
  getFinanceConfig,
  getServicePriceCentsFromConfig,
  sanitizeFinanceConfig,
  setFinanceConfigCache,
} from '../lib/finance.js';
import {
  BRANDING_CONFIG_DOC_PATH,
  getBrandingConfig,
  setBrandingConfigCache,
  downloadFromGCS,
  uploadToGCS,
  copyFileInGCS,
} from '../lib/branding.js';
import {
  generatePassword,
  getAdminFromReq,
  hashPassword,
  normalizeUsername,
  requireAdmin,
  requireMaster,
  signAdminToken,
  verifyPassword,
  type AdminUserDoc,
} from '../lib/adminAuth.js';
import {
  getNotificationSettings,
  saveNotificationSettings,
  processReminders,
  processMessageQueue,
  processBirthdayMessages,
  broadcastWithMedia,
} from '../services/whatsappNotifications.js';

export type AdminRouteDeps = {
  env: Env;
  db: Firestore;
};

function normalizeBarberId(input: string) {
  const ascii = input.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return ascii
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function isValidBarberId(id: string) {
  return /^[a-z0-9][a-z0-9-]{1,30}$/.test(id);
}

async function generateUniqueBarberIdFromName(db: Firestore, name: string) {
  const parts = name
    .trim()
    .split(/\s+/g)
    .filter(Boolean);
  const baseSource = parts.length >= 2 ? `${parts[0]} ${parts[parts.length - 1]}` : name;
  const base = normalizeBarberId(baseSource);
  if (!base || !isValidBarberId(base)) return null;

  const exists = async (id: string) => {
    const [b, u] = await Promise.all([
      db.collection('barbers').doc(id).get(),
      db.collection('adminUsers').doc(id).get(),
    ]);
    return b.exists || u.exists;
  };

  if (!(await exists(base))) return base;
  for (let i = 2; i <= 99; i++) {
    const candidate = `${base}-${i}`;
    if (candidate.length > 31) continue;
    if (!(await exists(candidate))) return candidate;
  }
  return null;
}

export function registerAdminRoutes(app: express.Express, deps: AdminRouteDeps) {
  const { env, db } = deps;

  const requireAdminMw = requireAdmin(env);

  function mapEvolutionError(e: EvolutionRequestError): { httpStatus: number; message: string } {
    if ((e as any)?.method === 'CONFIG') {
      return { httpStatus: 500, message: e.message };
    }
    if (e.status === 401 || e.status === 403) {
      return { httpStatus: 502, message: 'Falha ao autenticar no Evolution (verifique a apikey)' };
    }
    if (e.status === 404) {
      return { httpStatus: 502, message: 'Endpoint do Evolution não encontrado (verifique baseUrl/versão)' };
    }
    if (e.status === 409) {
      return { httpStatus: 409, message: 'Operação inválida no Evolution (instância pode estar desconectada)' };
    }
    // Preserve detailed error messages from evolutionApi.ts
    if (e.status === 502 && e.message && e.message !== 'Falha ao chamar Evolution') {
      return { httpStatus: 502, message: e.message };
    }
    if (e.status >= 500) {
      return { httpStatus: 502, message: 'Evolution indisponível no momento' };
    }
    return { httpStatus: 502, message: 'Falha ao comunicar com o Evolution' };
  }

  function makeOutboundDocId(input: string) {
    return createHash('sha256').update(input).digest('hex');
  }

  function markBookingWhatsappSentTx(tx: any, bookingRef: any, customerRef: any) {
    const now = Timestamp.now();
    tx.update(bookingRef, {
      whatsappStatus: 'sent',
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (customerRef) {
      tx.update(customerRef, {
        'stats.lastContactAt': now,
      });
    }
  }

  app.post('/api/admin/login', async (req, res) => {
    try {
      const body = req.body as { username?: unknown; password?: unknown };
      const usernameRaw = typeof body.username === 'string' ? body.username : '';
      const username = normalizeUsername(usernameRaw);
      const password = typeof body.password === 'string' ? body.password : null;
      if (!password) return res.status(400).json({ error: 'password é obrigatório' });
      if (!env.ADMIN_JWT_SECRET) return res.status(500).json({ error: 'ADMIN_JWT_SECRET não configurado' });

      // Back-compat bootstrap: if username not provided, accept legacy env password as master.
      if (!username) {
        if (!env.ADMIN_PASSWORD) return res.status(500).json({ error: 'ADMIN_PASSWORD não configurado' });
        if (password !== env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Credenciais inválidas' });
        const masterUsername = normalizeUsername(env.ADMIN_USERNAME ?? OWNER_BARBER_ID);
        const token = await signAdminToken(env, { role: 'master', username: masterUsername, barberId: null });
        return res.json({ token });
      }

      const userRef = db.collection('adminUsers').doc(username);
      const userSnap = await userRef.get();
      if (!userSnap.exists) return res.status(401).json({ error: 'Credenciais inválidas' });
      const user = userSnap.data() as AdminUserDoc;
      if (!user.active) return res.status(401).json({ error: 'Usuário desativado' });
      if (!verifyPassword(password, user.passwordHash)) return res.status(401).json({ error: 'Credenciais inválidas' });

      await userRef.update({ lastLoginAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });

      const token = await signAdminToken(env, {
        role: user.role,
        username: user.usernameLower,
        barberId: user.role === 'barber' ? (user.barberId ?? null) : null,
      });

      return res.json({ token });
    } catch (e) {
      console.error('Error on admin login:', e);
      return res.status(500).json({ error: 'Erro ao fazer login' });
    }
  });

  app.get('/api/admin/users', requireAdminMw, requireMaster(), async (_req, res) => {
    try {
      const snapshot = await db.collection('adminUsers').get();
      const items = snapshot.docs
        .map((d) => {
          const data = d.data() as AdminUserDoc;
          return {
            id: d.id,
            username: data.username,
            role: data.role,
            barberId: data.barberId ?? null,
            active: data.active,
            lastLoginAt: (data as any)?.lastLoginAt?.toDate ? (data as any).lastLoginAt.toDate().toISOString() : null,
          };
        })
        .sort((a, b) => a.username.localeCompare(b.username, 'pt-BR'));
      return res.json({ items });
    } catch (e) {
      console.error('Error listing admin users:', e);
      return res.status(500).json({ error: 'Erro ao listar usuários' });
    }
  });

  app.post('/api/admin/users', requireAdminMw, requireMaster(), async (req, res) => {
    try {
      const body = req.body as {
        username?: unknown;
        password?: unknown;
        role?: unknown;
        barberId?: unknown;
        active?: unknown;
      };
      const username = typeof body.username === 'string' ? normalizeUsername(body.username) : null;
      const passwordProvided = typeof body.password === 'string' ? body.password : null;
      const role = body.role === 'master' || body.role === 'barber' ? body.role : null;
      const barberId = typeof body.barberId === 'string' ? body.barberId : null;
      const active = typeof body.active === 'boolean' ? body.active : true;
      if (!username || !role) return res.status(400).json({ error: 'username e role são obrigatórios' });
      if (role === 'barber' && !barberId) return res.status(400).json({ error: 'barberId é obrigatório para barbeiro' });

      const ref = db.collection('adminUsers').doc(username);
      const exists = await ref.get();
      if (exists.exists) return res.status(409).json({ error: 'Usuário já existe' });

      const password = passwordProvided && passwordProvided.trim() ? passwordProvided : generatePassword();

      const now = FieldValue.serverTimestamp();
      const doc: AdminUserDoc = {
        username,
        usernameLower: username,
        role,
        barberId: role === 'barber' ? barberId : null,
        active,
        passwordHash: hashPassword(password),
        createdAt: now,
        updatedAt: now,
      };
      await ref.set(doc);
      return res.json({ success: true, password: passwordProvided ? null : password });
    } catch (e) {
      console.error('Error creating admin user:', e);
      return res.status(500).json({ error: 'Erro ao criar usuário' });
    }
  });

  app.post('/api/admin/users/:username/reset-password', requireAdminMw, requireMaster(), async (req, res) => {
    try {
      const username = normalizeUsername(req.params.username || '');
      if (!username) return res.status(400).json({ error: 'username inválido' });
      const passwordProvided = (req.body as { password?: unknown })?.password;
      const password = typeof passwordProvided === 'string' && passwordProvided.trim() ? passwordProvided : generatePassword();
      const ref = db.collection('adminUsers').doc(username);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Usuário não encontrado' });
      await ref.update({ passwordHash: hashPassword(password), updatedAt: FieldValue.serverTimestamp() });
      return res.json({ success: true, password: typeof passwordProvided === 'string' && passwordProvided.trim() ? null : password });
    } catch (e) {
      console.error('Error resetting admin user password:', e);
      return res.status(500).json({ error: 'Erro ao resetar senha' });
    }
  });

  app.post('/api/admin/me/password', requireAdminMw, async (req, res) => {
    try {
      const admin = getAdminFromReq(req);
      const body = req.body as { currentPassword?: unknown; newPassword?: unknown };
      const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : null;
      const newPassword = typeof body.newPassword === 'string' ? body.newPassword : null;

      if (!currentPassword) return res.status(400).json({ error: 'currentPassword é obrigatório' });
      if (!newPassword || newPassword.trim().length < 6) {
        return res.status(400).json({ error: 'newPassword inválido (mín. 6 caracteres)' });
      }

      const username = normalizeUsername(admin.username);
      const ref = db.collection('adminUsers').doc(username);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Usuário não encontrado' });
      const user = snap.data() as AdminUserDoc;
      if (!user.active) return res.status(401).json({ error: 'Usuário desativado' });
      if (!verifyPassword(currentPassword, user.passwordHash)) {
        return res.status(401).json({ error: 'Senha atual incorreta' });
      }

      await ref.update({ passwordHash: hashPassword(newPassword.trim()), updatedAt: FieldValue.serverTimestamp() });
      return res.json({ success: true });
    } catch (e) {
      console.error('Error changing own password:', e);
      return res.status(500).json({ error: 'Erro ao alterar senha' });
    }
  });

  app.delete('/api/admin/users/:username', requireAdminMw, requireMaster(), async (req, res) => {
    try {
      const admin = getAdminFromReq(req);
      const username = normalizeUsername(req.params.username || '');
      if (!username) return res.status(400).json({ error: 'username inválido' });
      if (username === OWNER_BARBER_ID) {
        return res.status(400).json({ error: 'Não é permitido excluir o usuário master principal' });
      }
      if (username === normalizeUsername(admin.username)) {
        return res.status(400).json({ error: 'Não é possível excluir o próprio usuário' });
      }

      const ref = db.collection('adminUsers').doc(username);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Usuário não encontrado' });
      const data = snap.data() as AdminUserDoc;

      if (data.role === 'master') {
        const all = await db.collection('adminUsers').get();
        const masters = all.docs.filter((d) => (d.data() as AdminUserDoc).role === 'master');
        if (masters.length <= 1) {
          return res.status(400).json({ error: 'Não é possível excluir o último master' });
        }
      }

      if (data.role === 'barber') {
        const barberId = typeof data.barberId === 'string' ? data.barberId : null;
        if (barberId && barberId !== OWNER_BARBER_ID) {
          try {
            const barberRef = db.collection('barbers').doc(barberId);
            await barberRef.set(
              {
                active: false,
                archivedAt: FieldValue.serverTimestamp(),
                archivedBy: admin.username,
              },
              { merge: true }
            );
          } catch (e) {
            console.warn('[server] Failed to deactivate barber on user delete (continuing):', e);
          }
        }
      }

      await ref.delete();
      return res.json({ success: true });
    } catch (e) {
      console.error('Error deleting admin user:', e);
      return res.status(500).json({ error: 'Erro ao excluir usuário' });
    }
  });

  app.post('/api/admin/barbers', requireAdminMw, requireMaster(), async (req, res) => {
    try {
      const body = req.body as { id?: unknown; name?: unknown; active?: unknown; createLogin?: unknown };
      const idRaw = typeof body.id === 'string' ? body.id : '';
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
      const active = typeof body.active === 'boolean' ? body.active : true;
      const createLogin = typeof body.createLogin === 'boolean' ? body.createLogin : true;

      if (!name) return res.status(400).json({ error: 'name é obrigatório' });

      const requestedId = normalizeBarberId(idRaw);
      let id: string | null = null;

      if (requestedId) {
        if (!isValidBarberId(requestedId)) return res.status(400).json({ error: 'id inválido (use letras/números e hífen)' });
        id = requestedId;
      } else {
        id = await generateUniqueBarberIdFromName(db, name);
        if (!id) return res.status(400).json({ error: 'Não foi possível gerar um id a partir do nome' });
      }

      const barberRef = db.collection('barbers').doc(id);
      const barberSnap = await barberRef.get();
      if (barberSnap.exists) return res.status(409).json({ error: 'Barbeiro já existe' });

      if (createLogin) {
        const userRef = db.collection('adminUsers').doc(id);
        const userSnap = await userRef.get();
        if (userSnap.exists) return res.status(409).json({ error: 'Já existe um usuário com esse id' });
      }

      await barberRef.set({ name, active });

      let generatedPassword: string | null = null;
      if (createLogin) {
        const password = generatePassword();
        const now = FieldValue.serverTimestamp();
        const doc: AdminUserDoc = {
          username: id,
          usernameLower: id,
          role: 'barber',
          barberId: id,
          active: true,
          passwordHash: hashPassword(password),
          createdAt: now,
          updatedAt: now,
        };
        await db.collection('adminUsers').doc(id).set(doc);
        generatedPassword = password;
      }

      return res.json({ success: true, id, username: createLogin ? id : null, password: generatedPassword });
    } catch (e) {
      console.error('Error creating barber:', e);
      return res.status(500).json({ error: 'Erro ao criar barbeiro' });
    }
  });

  app.post('/api/admin/barbers/:barberId/create-login', requireAdminMw, requireMaster(), async (req, res) => {
    try {
      const admin = getAdminFromReq(req);
      const barberId = normalizeBarberId(req.params.barberId || '');
      if (!barberId) return res.status(400).json({ error: 'barberId inválido' });
      if (barberId === OWNER_BARBER_ID) return res.status(400).json({ error: 'Não é permitido gerar login para o barbeiro dono' });

      const barberRef = db.collection('barbers').doc(barberId);
      const barberSnap = await barberRef.get();
      if (!barberSnap.exists) return res.status(404).json({ error: 'Barbeiro não encontrado' });

      const userRef = db.collection('adminUsers').doc(barberId);
      const userSnap = await userRef.get();
      if (userSnap.exists) return res.status(409).json({ error: 'Já existe um login para esse profissional' });

      const password = generatePassword();
      const now = FieldValue.serverTimestamp();
      const doc: AdminUserDoc = {
        username: barberId,
        usernameLower: barberId,
        role: 'barber',
        barberId,
        active: true,
        passwordHash: hashPassword(password),
        createdAt: now,
        updatedAt: now,
      };
      await userRef.set(doc);

      return res.json({ success: true, username: barberId, password, createdBy: admin.username });
    } catch (e) {
      console.error('Error creating barber login:', e);
      return res.status(500).json({ error: 'Erro ao gerar login do profissional' });
    }
  });

  app.post('/api/admin/barbers/:barberId/archive', requireAdminMw, requireMaster(), async (req, res) => {
    try {
      const admin = getAdminFromReq(req);
      const barberId = normalizeBarberId(req.params.barberId || '');
      if (!barberId) return res.status(400).json({ error: 'barberId inválido' });
      if (barberId === OWNER_BARBER_ID) return res.status(400).json({ error: 'Não é permitido arquivar o barbeiro dono' });

      const barberRef = db.collection('barbers').doc(barberId);
      const barberSnap = await barberRef.get();
      if (!barberSnap.exists) return res.status(404).json({ error: 'Barbeiro não encontrado' });

      await barberRef.set(
        {
          active: false,
          archivedAt: FieldValue.serverTimestamp(),
          archivedBy: admin.username,
        },
        { merge: true }
      );

      return res.json({ success: true });
    } catch (e) {
      console.error('Error archiving barber:', e);
      return res.status(500).json({ error: 'Erro ao arquivar barbeiro' });
    }
  });

  app.delete('/api/admin/barbers/:barberId', requireAdminMw, requireMaster(), async (req, res) => {
    try {
      const barberId = normalizeBarberId(req.params.barberId || '');
      if (!barberId) return res.status(400).json({ error: 'barberId inválido' });
      if (barberId === OWNER_BARBER_ID) return res.status(400).json({ error: 'Não é permitido excluir o barbeiro dono' });

      const barberRef = db.collection('barbers').doc(barberId);
      const barberSnap = await barberRef.get();
      if (!barberSnap.exists) return res.status(404).json({ error: 'Barbeiro não encontrado' });

      // Remove barber doc
      await barberRef.delete();

      // If there is a matching admin user for this barber, delete only if it's a barber-role user.
      try {
        const userRef = db.collection('adminUsers').doc(barberId);
        const userSnap = await userRef.get();
        if (userSnap.exists) {
          const data = userSnap.data() as AdminUserDoc;
          if (data?.role === 'barber') {
            await userRef.delete();
          }
        }
      } catch (e) {
        console.warn('[server] Failed to delete matching barber admin user (continuing):', e);
      }

      return res.json({ success: true });
    } catch (e) {
      console.error('Error deleting barber:', e);
      return res.status(500).json({ error: 'Erro ao excluir barbeiro' });
    }
  });

  app.post('/api/admin/users/:username/active', requireAdminMw, requireMaster(), async (req, res) => {
    try {
      const username = normalizeUsername(req.params.username || '');
      const active = (req.body as { active?: unknown })?.active;
      if (!username) return res.status(400).json({ error: 'username inválido' });
      if (typeof active !== 'boolean') return res.status(400).json({ error: 'active deve ser boolean' });
      if (username === OWNER_BARBER_ID) {
        return res.status(400).json({ error: 'Não é permitido desativar o usuário master principal' });
      }
      const ref = db.collection('adminUsers').doc(username);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Usuário não encontrado' });
      await ref.update({ active, updatedAt: FieldValue.serverTimestamp() });
      return res.json({ success: true });
    } catch (e) {
      console.error('Error toggling admin user:', e);
      return res.status(500).json({ error: 'Erro ao atualizar usuário' });
    }
  });

  app.get('/api/admin/barbers', requireAdminMw, async (req, res) => {
    try {
      const admin = getAdminFromReq(req);
      const includeInactiveRequested = String((req.query as any)?.includeInactive ?? '').toLowerCase();
      const includeInactive = admin?.role === 'master' && (includeInactiveRequested === '1' || includeInactiveRequested === 'true');
      const snapshot = await db.collection('barbers').get();
      const items = snapshot.docs
        .map((doc) => {
          const data = doc.data() as { name?: unknown; active?: unknown; archivedAt?: any; archivedBy?: unknown };
          const name = typeof data?.name === 'string' && data.name.trim() ? data.name.trim() : doc.id;
          const active = typeof data?.active === 'boolean' ? data.active : true;
          const archivedBy = typeof data?.archivedBy === 'string' && data.archivedBy.trim() ? data.archivedBy.trim() : null;
          const archivedAt = data?.archivedAt && typeof data.archivedAt?.toDate === 'function' ? data.archivedAt.toDate().toISOString() : null;
          return { id: doc.id, name, active, archivedAt, archivedBy };
        })

      const filteredItems = includeInactive ? items : items.filter((b) => b.active);

      const scopedItems = admin?.role === 'barber' ? filteredItems.filter((b) => b.id === admin.barberId) : filteredItems;

      scopedItems.sort((a, b) => {
        const aIsOwner = a.id === OWNER_BARBER_ID;
        const bIsOwner = b.id === OWNER_BARBER_ID;
        if (aIsOwner && !bIsOwner) return -1;
        if (!aIsOwner && bIsOwner) return 1;
        if (a.active && !b.active) return -1;
        if (!a.active && b.active) return 1;
        return a.name.localeCompare(b.name, 'pt-BR');
      });
      return res.json({ items: scopedItems });
    } catch (err) {
      console.error('Error listing barbers:', err);
      return res.status(500).json({ error: 'Erro ao listar barbeiros' });
    }
  });

  app.get('/api/admin/barbers/:barberId', requireAdminMw, async (req, res) => {
    try {
      const admin = getAdminFromReq(req);
      const barberId = req.params.barberId;

      if (admin.role !== 'master' && admin.barberId !== barberId) {
        return res.status(403).json({ error: 'Acesso negado' });
      }

      const barberDoc = await db.collection('barbers').doc(barberId).get();
      if (!barberDoc.exists) return res.status(404).json({ error: 'Barbeiro não encontrado' });
      const data = barberDoc.data() as { calendarFeedToken?: unknown; schedule?: unknown };
      return res.json({ 
        calendarFeedToken: typeof data?.calendarFeedToken === 'string' ? data.calendarFeedToken : null,
        schedule: data?.schedule ?? null
      });
    } catch {
      return res.status(500).json({ error: 'Erro ao carregar barbeiro' });
    }
  });

  app.put('/api/admin/barbers/:barberId/schedule', requireAdminMw, async (req, res) => {
    try {
      const admin = getAdminFromReq(req);
      const barberId = req.params.barberId;
      
      if (admin.role !== 'master' && admin.barberId !== barberId) {
        return res.status(403).json({ error: 'Acesso negado' });
      }

      const schedule = req.body.schedule;
      await db.collection('barbers').doc(barberId).set({ schedule }, { merge: true });
      return res.json({ success: true });
    } catch (e) {
      console.error('Error updating schedule:', e);
      return res.status(500).json({ error: 'Erro ao atualizar horários' });
    }
  });

  app.get('/api/admin/finance/config', requireAdminMw, async (req, res) => {
    const admin = getAdminFromReq(req);
    if (admin.role !== 'master') return res.status(403).json({ error: 'Sem permissão' });
    try {
      const config = await getFinanceConfig(db);
      return res.json({ config });
    } catch (e) {
      console.error('Error loading finance config:', e);
      return res.status(500).json({ error: 'Erro ao carregar configurações' });
    }
  });

  app.put('/api/admin/finance/config', requireAdminMw, async (req, res) => {
    const admin = getAdminFromReq(req);
    if (admin.role !== 'master') return res.status(403).json({ error: 'Sem permissão' });
    try {
      const incoming = req.body as unknown;
      const config = sanitizeFinanceConfig(incoming);
      const ref = db.doc(FINANCE_CONFIG_DOC_PATH);
      await ref.set(config, { merge: true });
      setFinanceConfigCache(config);
      return res.json({ success: true, config });
    } catch (e) {
      console.error('Error saving finance config:', e);
      return res.status(500).json({ error: 'Erro ao salvar configurações' });
    }
  });

  app.get('/api/admin/finance/summary', requireAdminMw, async (req, res) => {
    try {
      const admin = getAdminFromReq(req);
      const financeConfig = await getFinanceConfig(db);
      const startDateKey = typeof req.query.startDateKey === 'string' ? req.query.startDateKey : null;
      const endDateKey = typeof req.query.endDateKey === 'string' ? req.query.endDateKey : null;
      const requestedBarberId = typeof req.query.barberId === 'string' ? req.query.barberId : null;
      const barberId = admin.role === 'barber' ? (admin.barberId as string) : requestedBarberId;

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
      let estimatedBarberCents = 0;
      let estimatedShopCents = 0;
      let realizedBarberCents = 0;
      let realizedShopCents = 0;

      const nowSP = DateTime.now().setZone('America/Sao_Paulo');
      const todayKey = nowSP.toFormat('yyyy-MM-dd');
      const selectedStart = DateTime.fromFormat(startDateKey, 'yyyy-MM-dd', { zone: 'America/Sao_Paulo' }).startOf('day');
      const selectedMonthKey = selectedStart.isValid ? selectedStart.toFormat('yyyy-MM') : null;
      const currentMonthKey = nowSP.toFormat('yyyy-MM');

      snap.forEach((doc) => {
        const data = doc.data() as { serviceType?: unknown; status?: unknown; barberId?: unknown };
        const serviceType = typeof data.serviceType === 'string' ? data.serviceType : 'unknown';
        const status = typeof data.status === 'string' ? data.status : 'unknown';
        const bId = typeof data.barberId === 'string' ? data.barberId : '';

        totalBookings += 1;
        countsByServiceType[serviceType] = (countsByServiceType[serviceType] ?? 0) + 1;
        countsByStatus[status] = (countsByStatus[status] ?? 0) + 1;

        const price = getServicePriceCentsFromConfig(financeConfig, serviceType);
        if (['booked', 'confirmed'].includes(status)) {
          estimatedRevenueCents += price;
          const pct = getBarberCommissionPct(financeConfig, bId);
          const barberShare = Math.round(price * pct);
          estimatedBarberCents += barberShare;
          estimatedShopCents += price - barberShare;
        }
        if (status === 'completed') {
          realizedRevenueCents += price;
          const pct = getBarberCommissionPct(financeConfig, bId);
          const barberShare = Math.round(price * pct);
          realizedBarberCents += barberShare;
          realizedShopCents += price - barberShare;
        }
      });

      async function sumCompletedRevenueByDateKeyRange(range: {
        startKey: string;
        endKey: string;
        cutoffKey?: string | null;
      }): Promise<{ total: number; toCutoff: number }> {
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
          const price = getServicePriceCentsFromConfig(financeConfig, serviceType);
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
        let cancelled = 0;
        s.forEach((d) => {
          const data = d.data() as any;
          const status = typeof data.status === 'string' ? data.status : 'unknown';
          if (status === 'completed') completed += 1;
          if (status === 'no_show') noShow += 1;
          if (status === 'cancelled') cancelled += 1;
        });

        const denom = completed + noShow + cancelled;
        // Pouca amostragem: usa um baseline conservador.
        if (denom < 10) return 0.9;
        const rate = completed / denom;
        return Math.min(0.98, Math.max(0.3, rate));
      }

      let projectionRevenueCents: number | null = null;
      if (selectedMonthKey && selectedMonthKey === currentMonthKey) {
        const showUpRate = await computeShowUpRate90d();

        let realizedToDate = 0;
        let pipelineRemaining = 0;

        snap.forEach((doc) => {
          const data = doc.data() as any;
          const status = typeof data.status === 'string' ? data.status : 'unknown';
          const serviceType = typeof data.serviceType === 'string' ? data.serviceType : 'unknown';
          const dk = typeof data.dateKey === 'string' ? data.dateKey : null;
          const price = getServicePriceCentsFromConfig(financeConfig, serviceType);
          if (!dk) return;
          if (status === 'completed' && dk <= todayKey) realizedToDate += price;
          if (['booked', 'confirmed'].includes(status) && dk > todayKey) pipelineRemaining += price;
        });

        const dayN = nowSP.day;
        const remainingSamples: number[] = [];
        for (let i = 1; i <= 3; i++) {
          const mStart = selectedStart.minus({ months: i }).startOf('month');
          const mEnd = mStart.endOf('month');
          const daysInMonth = mStart.daysInMonth ?? 31;
          const mCutoffDay = Math.max(1, Math.min(dayN, daysInMonth));
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

        const lateGap = Math.max(0, baselineRemaining - pipelineRemaining);
        const lateFillRate = 0.7;

        projectionRevenueCents = Math.round(realizedToDate + pipelineRemaining * showUpRate + lateGap * lateFillRate);
      } else if (selectedMonthKey) {
        const selectedMonthStartKey = selectedStart.startOf('month').toFormat('yyyy-MM-dd');
        const selectedMonthEndKey = selectedStart.endOf('month').toFormat('yyyy-MM-dd');
        const selectedMonthIsPast = selectedMonthEndKey < todayKey;
        if (selectedMonthIsPast) {
          projectionRevenueCents = realizedRevenueCents;
        } else {
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
        revenueCents: estimatedRevenueCents + realizedRevenueCents,
        estimatedRevenueCents,
        realizedRevenueCents,
        estimatedBarberCents,
        estimatedShopCents,
        realizedBarberCents,
        realizedShopCents,
        commissions: {
          defaultBarberPct: financeConfig.commissions.defaultBarberPct,
          ownerBarberPct: financeConfig.commissions.ownerBarberPct,
        },
        projectionRevenueCents,
        countsByServiceType,
        countsByStatus,
        serviceCatalog: financeConfig.services.map((s) => ({
          id: s.id,
          label: s.label,
          priceCents: s.priceCents,
          active: s.active,
          sortOrder: s.sortOrder,
        })),
      });
    } catch (err: any) {
      console.error('Error building finance summary:', err);
      const message = err?.message?.includes('index')
        ? 'Erro de índice no banco de dados. Verifique os logs do servidor para criar o índice necessário.'
        : 'Erro ao carregar financeiro';
      return res.status(500).json({ error: message });
    }
  });

  // --- Admin APIs (caminho B) ---
  app.get('/api/admin/bookings', requireAdminMw, async (req, res) => {
    try {
      const admin = getAdminFromReq(req);
      const requestedBarberId = typeof req.query.barberId === 'string' ? req.query.barberId : null;
      const barberId = admin.role === 'barber' ? (admin.barberId as string) : requestedBarberId;
      
      const dateKey = typeof req.query.dateKey === 'string' ? req.query.dateKey : null;
      const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : null;
      const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : null;

      if (!barberId) return res.status(400).json({ error: 'barberId é obrigatório' });

      let query = db.collection('bookings').where('barberId', '==', barberId);

      if (dateKey) {
        query = query.where('dateKey', '==', dateKey);
      } else if (startDate && endDate) {
        query = query.where('dateKey', '>=', startDate).where('dateKey', '<=', endDate);
      } else {
        return res.status(400).json({ error: 'dateKey ou (startDate e endDate) são obrigatórios' });
      }

      const snapshot = await query.get();

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
          const startA = a.slotStart || '';
          const startB = b.slotStart || '';
          return startA.localeCompare(startB);
        });

      return res.json({ items });
    } catch {
      return res.status(500).json({ error: 'Erro ao carregar bookings' });
    }
  });

  // ==========================================================================
  // Criar Agendamento (Admin)
  // ==========================================================================
  app.post('/api/admin/bookings', requireAdminMw, async (req, res) => {
    try {
      const admin = getAdminFromReq(req);
      const { barberId, serviceType, slotStart, customer } = req.body;

      if (!barberId || !serviceType || !slotStart || !customer) {
        return res.status(400).json({ error: 'Campos obrigatórios: barberId, serviceType, slotStart, customer' });
      }

      if (!customer.firstName || !customer.lastName || !customer.whatsapp) {
        return res.status(400).json({ error: 'Cliente deve ter firstName, lastName e whatsapp' });
      }

      // Verifica permissão do barbeiro
      if (admin.role === 'barber' && admin.barberId !== barberId) {
        return res.status(403).json({ error: 'Você só pode criar agendamentos para seu próprio perfil' });
      }

      // Verifica se barbeiro existe e está ativo
      const barberRef = db.collection('barbers').doc(barberId);
      const barberDoc = await barberRef.get();
      if (!barberDoc.exists) return res.status(404).json({ error: 'Barbeiro não encontrado' });
      const barberData = barberDoc.data() as { active?: unknown; schedule?: any } | undefined;
      if (!barberData?.active) return res.status(400).json({ error: 'Barbeiro indisponível' });

      const slotDateTime = DateTime.fromISO(slotStart, { zone: 'America/Sao_Paulo' });
      if (!slotDateTime.isValid) {
        return res.status(400).json({ error: 'Data/hora inválida' });
      }

      // Valida contra a agenda do barbeiro
      if (barberData?.schedule) {
        const dayKey = slotDateTime.weekday === 7 ? '0' : slotDateTime.weekday.toString();
        const dayConfig = barberData.schedule[dayKey];
        if (!dayConfig || !dayConfig.active) {
          return res.status(400).json({ error: 'Barbeiro não atende neste dia' });
        }

        const slotTime = slotDateTime.toFormat('HH:mm');
        const [startH, startM] = dayConfig.start.split(':').map(Number);
        const [endH, endM] = dayConfig.end.split(':').map(Number);
        const dayStart = slotDateTime.set({ hour: startH, minute: startM });
        const dayEnd = slotDateTime.set({ hour: endH, minute: endM });
        const lastSlotStart = dayEnd.minus({ minutes: 30 });

        if (slotDateTime < dayStart || slotDateTime > lastSlotStart) {
          return res.status(400).json({ error: 'Horário fora do expediente configurado' });
        }

        // Verifica pausas
        if (dayConfig.breaks && Array.isArray(dayConfig.breaks)) {
          const isInBreak = dayConfig.breaks.some((brk: any) => {
            return slotTime >= brk.start && slotTime < brk.end;
          });
          if (isInBreak) {
            return res.status(400).json({ error: 'Horário está em período de pausa' });
          }
        }
      }

      // Normaliza telefone usando a mesma função do fluxo público
      let whatsappE164: string;
      try {
        whatsappE164 = normalizeToE164(customer.whatsapp);
      } catch {
        return res.status(400).json({ error: 'Formato de telefone inválido' });
      }

      // Gera IDs usando as mesmas funções do fluxo público
      const customerId = generateCustomerId(whatsappE164);
      const slotId = generateSlotId(slotDateTime);
      const dateKey = getDateKey(slotDateTime);
      const bookingId = db.collection('bookings').doc().id;

      await db.runTransaction(async (tx) => {
        const slotRef = db.collection('barbers').doc(barberId).collection('slots').doc(slotId);
        const customerRef = db.collection('customers').doc(customerId);
        const [slotDoc, customerDoc] = await Promise.all([tx.get(slotRef), tx.get(customerRef)]);

        if (slotDoc.exists) {
          const err = new Error('already-exists');
          (err as any).code = 'already-exists';
          throw err;
        }

        const now = Timestamp.now();

        tx.set(slotRef, {
          slotStart: Timestamp.fromDate(slotDateTime.toJSDate()),
          dateKey,
          kind: 'booking',
          bookingId,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        const bookingRef = db.collection('bookings').doc(bookingId);
        tx.set(bookingRef, {
          customerId,
          barberId,
          serviceType,
          slotStart: Timestamp.fromDate(slotDateTime.toJSDate()),
          dateKey,
          customer: {
            firstName: customer.firstName.trim(),
            lastName: customer.lastName.trim(),
            whatsappE164,
          },
          status: 'booked',
          whatsappStatus: 'pending',
          createdBy: admin.username,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        if (!customerDoc.exists) {
          tx.set(customerRef, {
            identity: {
              firstName: customer.firstName.trim(),
              lastName: customer.lastName.trim(),
              whatsappE164,
            },
            profile: {
              birthday: customer.birthDate || null,
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
          tx.update(customerRef, updates);
        }
      });

      return res.json({ success: true, bookingId });
    } catch (e: unknown) {
      if (e && typeof e === 'object' && (e as any).code === 'already-exists') {
        return res.status(409).json({ error: 'Este horário já foi reservado. Selecione outro.' });
      }
      console.error('Error creating booking (admin):', e);
      const msg = e instanceof Error ? e.message : 'Erro desconhecido';
      return res.status(400).json({ error: `Erro ao criar reserva: ${msg}` });
    }
  });

  app.post('/api/admin/bookings/:bookingId/cancel', requireAdminMw, async (req, res) => {
    try {
      const admin = getAdminFromReq(req);
      const bookingId = req.params.bookingId;
      const bookingRef = db.collection('bookings').doc(bookingId);
      const bookingDoc = await bookingRef.get();
      if (!bookingDoc.exists) return res.status(404).json({ error: 'Reserva não encontrada' });
      const booking = bookingDoc.data() as any;
      if (admin.role === 'barber' && booking.barberId !== admin.barberId) {
        return res.status(403).json({ error: 'Acesso restrito' });
      }
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

  app.post('/api/admin/bookings/:bookingId/reschedule', requireAdminMw, async (req, res) => {
    try {
      const admin = getAdminFromReq(req);
      const bookingId = req.params.bookingId;
      const newSlotStart = (req.body as { newSlotStart?: unknown })?.newSlotStart;
      if (typeof newSlotStart !== 'string') return res.status(400).json({ error: 'newSlotStart é obrigatório (ISO)' });

      const bookingRef = db.collection('bookings').doc(bookingId);
      const bookingDoc = await bookingRef.get();
      if (!bookingDoc.exists) return res.status(404).json({ error: 'Reserva não encontrada' });
      const booking = bookingDoc.data() as any;
      if (admin.role === 'barber' && booking.barberId !== admin.barberId) {
        return res.status(403).json({ error: 'Acesso restrito' });
      }

      const newSlot = DateTime.fromISO(newSlotStart, { zone: 'America/Sao_Paulo' });
      if (isSunday(newSlot)) return res.status(400).json({ error: 'Não é possível reagendar para domingo' });
      if (!isValidTimeSlot(newSlot)) return res.status(400).json({ error: 'Horário inválido (deve ser múltiplo de 30min)' });

      const barberId = booking.barberId as string;
      
      // Validate against barber's schedule
      const barberDoc = await db.collection('barbers').doc(barberId).get();
      const barberData = barberDoc.data() as { schedule?: any } | undefined;
      if (barberData?.schedule) {
        const dayKey = newSlot.weekday === 7 ? '0' : newSlot.weekday.toString();
        const dayConfig = barberData.schedule[dayKey];
        if (dayConfig && dayConfig.active) {
          const slotTime = newSlot.toFormat('HH:mm');
          const [startH, startM] = dayConfig.start.split(':').map(Number);
          const [endH, endM] = dayConfig.end.split(':').map(Number);
          const dayStart = newSlot.set({ hour: startH, minute: startM });
          const dayEnd = newSlot.set({ hour: endH, minute: endM });
          const lastSlotStart = dayEnd.minus({ minutes: 30 });
          
          if (newSlot < dayStart || newSlot > lastSlotStart) {
            return res.status(400).json({ error: 'Horário fora do expediente configurado' });
          }
          
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

  app.post('/api/admin/bookings/:bookingId/whatsapp-sent', requireAdminMw, async (req, res) => {
    try {
      const admin = getAdminFromReq(req);
      const bookingId = req.params.bookingId;
      const bookingRef = db.collection('bookings').doc(bookingId);
      const bookingDoc = await bookingRef.get();
      if (!bookingDoc.exists) return res.status(404).json({ error: 'Reserva não encontrada' });
      const booking = bookingDoc.data() as any;
      if (admin.role === 'barber' && booking.barberId !== admin.barberId) {
        return res.status(403).json({ error: 'Acesso restrito' });
      }
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

  app.get('/api/admin/whatsapp/status', requireAdminMw, async (_req, res) => {
    try {
      const baseUrl = (env.EVOLUTION_BASE_URL ?? '').trim();
      const apiKey = (env.EVOLUTION_API_KEY ?? '').trim();
      const instanceNameEnv = (env.EVOLUTION_INSTANCE_NAME ?? '').trim();
      const instanceName = instanceNameEnv || '-';

      const missing: Array<'EVOLUTION_BASE_URL' | 'EVOLUTION_API_KEY' | 'EVOLUTION_INSTANCE_NAME'> = [];
      if (!baseUrl) missing.push('EVOLUTION_BASE_URL');
      if (!apiKey) missing.push('EVOLUTION_API_KEY');
      if (!instanceNameEnv) missing.push('EVOLUTION_INSTANCE_NAME');
      const configured = missing.length === 0;

      if (!configured) {
        const payload: AdminWhatsappStatusResponse = {
          instanceName,
          instanceExists: false,
          connectionState: null,
          checkedBy: 'unknown',
          hint: 'Configuração incompleta do Evolution no servidor.',
          configured,
          missing,
        };
        return res.json(payload);
      }

      const evo = createEvolutionClient(env);

      let checkedBy: AdminWhatsappStatusResponse['checkedBy'] = 'unknown';
      let connectionState: string | null = null;
      let instanceExists = false;

      try {
        const raw = await evo.get(`/instance/connectionState/${encodeURIComponent(instanceName)}`);
        const extracted = extractConnectionState(raw);
        if (!extracted) throw new Error('Sem connectionState no payload do Evolution');
        connectionState = extracted;
        checkedBy = 'connectionState';
        instanceExists = true;
      } catch (e: any) {
        const err = e as EvolutionRequestError;
        if (!err || typeof err.status !== 'number' || err.status !== 404) {
          // Ignora e tenta fallback
        }
      }

      if (checkedBy !== 'connectionState') {
        try {
          const raw = await evo.get('/instance/fetchInstances');
          checkedBy = 'fetchInstances';

          const obj = raw as any;
          const candidates = [obj?.instances, obj?.items, obj?.data, obj];
          const list = candidates.find((c) => Array.isArray(c)) as any[] | undefined;
          if (Array.isArray(list)) {
            const found = list.find((it) => {
              const name = it?.instanceName ?? it?.name ?? it?.instance;
              return typeof name === 'string' && name === instanceName;
            });
            instanceExists = !!found;
            if (!connectionState && found) {
              const candidate =
                found?.connectionState ??
                found?.connectionStatus ??
                found?.state ??
                found?.status ??
                found?.whatsapp?.status;
              if (typeof candidate === 'string' && candidate.trim()) connectionState = candidate.trim();
            }
          }
        } catch {
          checkedBy = 'unknown';
        }
      }

      const normalizedState = (connectionState ?? '').trim().toLowerCase();
      let hint: string | undefined;
      if (!instanceExists) {
        hint = 'Instância não encontrada no Evolution. Crie/recrie a instância e tente conectar.';
      } else if (!normalizedState) {
        hint = 'Sem estado de conexão disponível. Tente Atualizar e gerar QR/código novamente.';
      } else if (normalizedState === 'open' || normalizedState === 'connected') {
        hint = 'Conectado.';
      } else if (normalizedState === 'close' || normalizedState === 'closed' || normalizedState === 'disconnected') {
        hint = 'Desconectado. Gere QR ou código para conectar.';
      } else if (normalizedState === 'connecting') {
        hint = 'Conectando. Se ficar preso em "connecting" e o WhatsApp recusar, tente o modo Código (sem QR) e/ou reinicie a instância no Evolution.';
      }

      const payload: AdminWhatsappStatusResponse = {
        instanceName,
        instanceExists,
        connectionState,
        checkedBy,
        hint,
        configured,
        missing,
      };
      return res.json(payload);
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : 'Erro ao consultar status do WhatsApp';
      return res.status(500).json({ error: msg });
    }
  });

  app.post('/api/admin/whatsapp/disconnect', requireAdminMw, requireMaster(), async (_req, res) => {
    try {
      const instanceName = getEvolutionInstanceName(env);
      const evo = createEvolutionClient(env);

      try {
        await evo.delete(`/instance/logout/${encodeURIComponent(instanceName)}`);
      } catch (e: any) {
        const err = e as EvolutionRequestError;
        if (err && typeof err.status === 'number') {
          const normalizedMsg = String(err.message || '').toLowerCase();
          if (err.status === 400 && (normalizedMsg.includes('not connected') || normalizedMsg.includes('não conectado'))) {
            return res.json({ success: true, alreadyDisconnected: true });
          }
          const mapped = mapEvolutionError(err);
          return res.status(mapped.httpStatus).json({ error: mapped.message });
        }
        throw e;
      }

      return res.json({ success: true });
    } catch (e: any) {
      if (typeof e?.message === 'string' && e.message.includes('EVOLUTION_')) {
        return res.status(500).json({ error: e.message });
      }
      return res.status(500).json({ error: 'Erro ao desconectar WhatsApp' });
    }
  });

  // ─────────────────────────────────────────────────────────────
  // Configurações de Notificações WhatsApp
  // ─────────────────────────────────────────────────────────────

  app.get('/api/admin/whatsapp/notification-settings', requireAdminMw, requireMaster(), async (_req, res) => {
    try {
      const settings = await getNotificationSettings(db);
      return res.json(settings);
    } catch (e: any) {
      console.error('Error getting notification settings:', e);
      return res.status(500).json({ error: 'Erro ao carregar configurações de notificação' });
    }
  });

  app.put('/api/admin/whatsapp/notification-settings', requireAdminMw, requireMaster(), async (req, res) => {
    try {
      const admin = getAdminFromReq(req);
      const body = req.body || {};

      const settings = {
        confirmationEnabled: body.confirmationEnabled === true,
        confirmationMessage: String(body.confirmationMessage || '').slice(0, 500),
        reminderEnabled: body.reminderEnabled === true,
        reminderMinutesBefore: Math.max(15, Math.min(1440, Number(body.reminderMinutesBefore) || 60)),
        reminderMessage: String(body.reminderMessage || '').slice(0, 500),
        cancellationMessage: String(body.cancellationMessage || '').slice(0, 500),
        birthdayEnabled: body.birthdayEnabled === true,
        birthdayMessage: String(body.birthdayMessage || '').slice(0, 500),
      };

      await saveNotificationSettings(db, settings, admin?.username || 'unknown');
      return res.json({ success: true, settings });
    } catch (e: any) {
      console.error('Error saving notification settings:', e);
      return res.status(500).json({ error: 'Erro ao salvar configurações de notificação' });
    }
  });

  // Endpoint para processar lembretes (chamado via Cloud Scheduler ou manualmente)
  app.post('/api/admin/whatsapp/send-reminders', requireAdminMw, requireMaster(), async (_req, res) => {
    try {
      const result = await processReminders(db, env);
      return res.json({
        success: true,
        processed: result.processed,
        sent: result.sent,
        queued: result.queued,
      });
    } catch (e: any) {
      console.error('Error processing reminders:', e);
      return res.status(500).json({ error: 'Erro ao processar lembretes' });
    }
  });

  // Endpoint para processar fila de retry
  app.post('/api/admin/whatsapp/process-queue', requireAdminMw, requireMaster(), async (_req, res) => {
    try {
      const result = await processMessageQueue(db, env);
      return res.json({
        success: true,
        processed: result.processed,
        sent: result.sent,
        failed: result.failed,
      });
    } catch (e: any) {
      console.error('Error processing message queue:', e);
      return res.status(500).json({ error: 'Erro ao processar fila de mensagens' });
    }
  });

  // Endpoint para disparo em massa (broadcast) para todos os clientes
  app.post('/api/admin/whatsapp/broadcast', requireAdminMw, requireMaster(), async (req, res) => {
    try {
      const body = req.body || {};
      const message = String(body.message || '').trim();
      if (!message || message.length < 5) {
        return res.status(400).json({ error: 'Mensagem muito curta (mínimo 5 caracteres)' });
      }
      if (message.length > 1000) {
        return res.status(400).json({ error: 'Mensagem muito longa (máximo 1000 caracteres)' });
      }

      const instanceName = getEvolutionInstanceName(env);
      const evo = createEvolutionClient(env);

      // Buscar todos os clientes com whatsappE164
      const customersSnap = await db.collection('customers').get();
      const customers: Array<{ id: string; firstName: string; whatsappE164: string }> = [];
      customersSnap.forEach((d) => {
        const data = d.data() as any;
        const whatsappE164 = data.identity?.whatsappE164 || data.whatsappE164;
        const firstName = data.identity?.firstName || data.firstName || 'Cliente';
        if (whatsappE164 && typeof whatsappE164 === 'string' && whatsappE164.length > 10) {
          customers.push({ id: d.id, firstName, whatsappE164 });
        }
      });

      if (customers.length === 0) {
        return res.json({ success: true, sent: 0, failed: 0, total: 0, message: 'Nenhum cliente com WhatsApp cadastrado' });
      }

      let sent = 0;
      let failed = 0;
      const errors: Array<{ customerId: string; error: string }> = [];

      for (const customer of customers) {
        try {
          // Personalizar mensagem com nome do cliente
          const personalizedMessage = message.replace(/\{nome\}/gi, customer.firstName);

          await evo.post(`/message/sendText/${encodeURIComponent(instanceName)}`, {
            number: toEvolutionNumber(customer.whatsappE164),
            text: personalizedMessage,
          });
          sent++;

          // Pequena pausa para não sobrecarregar a API
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (e: any) {
          failed++;
          errors.push({ customerId: customer.id, error: e?.message || 'Erro desconhecido' });
        }
      }

      // Logar resultado
      console.log(`[Broadcast] Enviado: ${sent}/${customers.length}, Falhou: ${failed}`);

      return res.json({
        success: true,
        sent,
        failed,
        total: customers.length,
        errors: errors.slice(0, 10), // Retorna apenas os 10 primeiros erros
      });
    } catch (e: any) {
      console.error('Error sending broadcast:', e);
      if (typeof e?.message === 'string' && e.message.includes('EVOLUTION_')) {
        return res.status(500).json({ error: e.message });
      }
      return res.status(500).json({ error: 'Erro ao enviar mensagem em massa' });
    }
  });

  // Endpoint para disparo em massa COM IMAGEM para todos os clientes
  // Suporta tanto URL quanto base64 (upload do dispositivo)
  app.post('/api/admin/whatsapp/broadcast-media', requireAdminMw, requireMaster(), async (req, res) => {
    try {
      const body = req.body || {};
      const mediaUrlOrBase64 = String(body.mediaUrl || '').trim();
      const caption = String(body.caption || '').trim();

      if (!mediaUrlOrBase64) {
        return res.status(400).json({ error: 'Imagem é obrigatória (URL ou base64)' });
      }

      // Valida se é uma URL válida ou base64
      const isBase64 = mediaUrlOrBase64.startsWith('data:image/');
      const isUrl = mediaUrlOrBase64.startsWith('http://') || mediaUrlOrBase64.startsWith('https://');
      
      if (!isBase64 && !isUrl) {
        return res.status(400).json({ error: 'Formato de imagem inválido. Envie uma URL ou base64' });
      }

      // Valida URL se não for base64
      if (isUrl) {
        try {
          new URL(mediaUrlOrBase64);
        } catch {
          return res.status(400).json({ error: 'URL da mídia inválida' });
        }
      }

      // Valida base64 se for base64
      if (isBase64) {
        // Verifica se o base64 não é muito grande (10MB max)
        const base64Size = (mediaUrlOrBase64.length * 3) / 4;
        if (base64Size > 10 * 1024 * 1024) {
          return res.status(400).json({ error: 'Imagem muito grande (máximo 10MB)' });
        }
      }

      // Caption é opcional quando tem imagem
      if (caption && caption.length > 1000) {
        return res.status(400).json({ error: 'Legenda muito longa (máximo 1000 caracteres)' });
      }

      const result = await broadcastWithMedia(db, env, mediaUrlOrBase64, caption);

      return res.json({
        success: true,
        sent: result.sent,
        failed: result.failed,
        total: result.total,
        errors: result.errors.slice(0, 10),
      });
    } catch (e: any) {
      console.error('Error sending broadcast with media:', e);
      if (typeof e?.message === 'string' && e.message.includes('EVOLUTION_')) {
        return res.status(500).json({ error: e.message });
      }
      return res.status(500).json({ error: 'Erro ao enviar mídia em massa' });
    }
  });

  // Endpoint para processar mensagens de aniversário (chamado por cron)
  app.post('/api/admin/whatsapp/send-birthdays', requireAdminMw, requireMaster(), async (req, res) => {
    try {
      // Pega a baseUrl do header ou do env
      const origin = req.get('origin') || req.get('referer') || '';
      const baseUrl = origin ? new URL(origin).origin : (env.APP_BASE_URL || 'https://sr-cardoso.app');

      const result = await processBirthdayMessages(db, env, baseUrl);

      // Monta mensagem informativa baseada no resultado
      let message: string;
      if (result.noCustomers) {
        message = 'Nenhum cliente aniversariando hoje';
      } else if (result.sent > 0) {
        message = `${result.sent} mensagem(ns) de aniversário enviada(s)!`;
      } else if (result.skipped > 0) {
        message = 'Clientes já receberam mensagem de aniversário hoje ou não têm WhatsApp válido';
      } else {
        message = 'Nenhuma mensagem enviada';
      }

      return res.json({
        success: true,
        message,
        processed: result.processed,
        sent: result.sent,
        failed: result.failed,
        skipped: result.skipped,
        noCustomers: result.noCustomers,
      });
    } catch (e: any) {
      console.error('Error sending birthday messages:', e);
      return res.status(500).json({ error: 'Erro ao enviar mensagens de aniversário' });
    }
  });

  // Endpoint público para cron de aniversário (validado por secret header)
  app.post('/api/cron/send-birthdays', async (req, res) => {
    try {
      // Valida secret do cron (Cloud Scheduler)
      const cronSecret = req.get('x-cron-secret') || req.get('authorization');
      const expectedSecret = env.CRON_SECRET;
      
      if (expectedSecret && cronSecret !== expectedSecret && cronSecret !== `Bearer ${expectedSecret}`) {
        return res.status(401).json({ error: 'Não autorizado' });
      }

      const baseUrl = env.APP_BASE_URL || 'https://sr-cardoso.app';
      const result = await processBirthdayMessages(db, env, baseUrl);

      // Log detalhado para o Cloud Scheduler
      if (result.noCustomers) {
        console.log('[CRON Birthday] Nenhum cliente aniversariando hoje');
      } else {
        console.log(`[CRON Birthday] Processados: ${result.processed}, Enviados: ${result.sent}, Pulados: ${result.skipped}, Falhas: ${result.failed}`);
      }

      // Monta mensagem informativa baseada no resultado
      let message: string;
      if (result.noCustomers) {
        message = 'Nenhum cliente aniversariando hoje';
      } else if (result.sent > 0) {
        message = `${result.sent} mensagem(ns) de aniversário enviada(s)!`;
      } else if (result.skipped > 0) {
        message = 'Clientes já receberam mensagem de aniversário hoje ou não têm WhatsApp válido';
      } else {
        message = 'Nenhuma mensagem enviada';
      }

      return res.json({
        success: true,
        message,
        processed: result.processed,
        sent: result.sent,
        failed: result.failed,
        skipped: result.skipped,
        noCustomers: result.noCustomers,
      });
    } catch (e: any) {
      console.error('Error in birthday cron:', e);
      return res.status(500).json({ error: 'Erro ao processar aniversários' });
    }
  });

  app.post('/api/admin/whatsapp/connect', requireAdminMw, requireMaster(), async (req, res) => {
    try {
      const instanceName = getEvolutionInstanceName(env);
      const evo = createEvolutionClient(env);

      const parsed = adminWhatsappConnectRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: 'Dados inválidos' });
      const mode = parsed.data.mode ?? 'qr';

      let raw: unknown;

      if (mode === 'pairingCode') {
        const number = toEvolutionNumber(parsed.data.phoneNumber ?? '');
        // 1) Tentativa mais compatível: GET com query param `number`
        raw = await evo.get(`/instance/connect/${encodeURIComponent(instanceName)}?number=${encodeURIComponent(number)}`);

        // 2) Fallback: alguns builds aceitam POST com body
        const pairingFromGet = extractPairingCode(raw);
        if (!pairingFromGet) {
          try {
            raw = await evo.post(`/instance/connect/${encodeURIComponent(instanceName)}`, { number });
          } catch {
            // mantém resposta do GET
          }
        }
      } else {
        raw = await evo.get(`/instance/connect/${encodeURIComponent(instanceName)}`);
      }

      const qrcodeBase64 = extractQrBase64(raw);
      const pairingCode = extractPairingCode(raw);

      return res.json({ instanceName, qrcodeBase64, pairingCode });
    } catch (e: any) {
      if (typeof e?.message === 'string' && e.message.includes('EVOLUTION_')) {
        return res.status(500).json({ error: e.message });
      }
      const err = e as EvolutionRequestError;
      if (err && typeof err.status === 'number') {
        const mapped = mapEvolutionError(err);
        return res.status(mapped.httpStatus).json({ error: mapped.message });
      }
      return res.status(500).json({ error: 'Erro ao conectar WhatsApp' });
    }
  });

  app.post('/api/admin/whatsapp/send-test', requireAdminMw, requireMaster(), async (req, res) => {
    try {
      const instanceName = getEvolutionInstanceName(env);
      const evo = createEvolutionClient(env);

      const parsed = adminWhatsappSendTestRequestSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Dados inválidos' });

      const toE164 = parsed.data.toE164;
      const text = parsed.data.text;

      const outboundDocId = makeOutboundDocId(`test:${instanceName}:${toE164}:${text}`);
      const outboundRef = db.collection('whatsappOutbound').doc(outboundDocId);
      const outboundSnap = await outboundRef.get();
      if (outboundSnap.exists && (outboundSnap.data() as any)?.status === 'sent') {
        return res.json({ success: true, deduped: true });
      }

      await outboundRef.set(
        {
          kind: 'test',
          instanceName,
          toE164,
          textLen: text.length,
          status: 'pending',
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      await evo.post(`/message/sendText/${encodeURIComponent(instanceName)}`, {
        number: toEvolutionNumber(toE164),
        text,
      });

      await outboundRef.set(
        {
          status: 'sent',
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return res.json({ success: true });
    } catch (e: any) {
      if (typeof e?.message === 'string' && e.message.includes('EVOLUTION_')) {
        return res.status(500).json({ error: e.message });
      }
      const err = e as EvolutionRequestError;
      if (err && typeof err.status === 'number') {
        const mapped = mapEvolutionError(err);
        return res.status(mapped.httpStatus).json({ error: mapped.message });
      }
      return res.status(500).json({ error: 'Erro ao enviar mensagem teste' });
    }
  });

  app.post('/api/admin/bookings/:bookingId/whatsapp/send-confirmation', requireAdminMw, async (req, res) => {
    try {
      const admin = getAdminFromReq(req);
      const bookingId = req.params.bookingId;

      const instanceName = getEvolutionInstanceName(env);
      const evo = createEvolutionClient(env);

      const parsed = adminWhatsappSendConfirmationRequestSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'Dados inválidos' });

      const bookingRef = db.collection('bookings').doc(bookingId);
      const bookingDoc = await bookingRef.get();
      if (!bookingDoc.exists) return res.status(404).json({ error: 'Reserva não encontrada' });
      const booking = bookingDoc.data() as any;

      if (admin.role === 'barber' && booking.barberId !== admin.barberId) {
        return res.status(403).json({ error: 'Acesso restrito' });
      }

      const toE164 = String(booking?.customer?.whatsappE164 ?? '').trim();
      if (!toE164) return res.status(400).json({ error: 'Reserva sem WhatsApp do cliente' });

      const text = parsed.data.text;
      const outboundDocId = makeOutboundDocId(`confirmation:${bookingId}:${instanceName}:${toE164}`);
      const outboundRef = db.collection('whatsappOutbound').doc(outboundDocId);

      const outboundSnap = await outboundRef.get();
      if (outboundSnap.exists && (outboundSnap.data() as any)?.status === 'sent') {
        const customerId = typeof booking.customerId === 'string' ? booking.customerId : null;
        const customerRef = customerId ? db.collection('customers').doc(customerId) : null;
        await db.runTransaction(async (tx) => {
          markBookingWhatsappSentTx(tx, bookingRef, customerRef);
        });
        return res.json({ success: true, deduped: true });
      }

      await outboundRef.set(
        {
          kind: 'confirmation',
          bookingId,
          instanceName,
          toE164,
          textLen: text.length,
          status: 'pending',
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      await evo.post(`/message/sendText/${encodeURIComponent(instanceName)}`, {
        number: toEvolutionNumber(toE164),
        text,
      });

      const customerId = typeof booking.customerId === 'string' ? booking.customerId : null;
      const customerRef = customerId ? db.collection('customers').doc(customerId) : null;

      await db.runTransaction(async (tx) => {
        markBookingWhatsappSentTx(tx, bookingRef, customerRef);
        tx.set(
          outboundRef,
          {
            status: 'sent',
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });

      return res.json({ success: true });
    } catch (e: any) {
      if (typeof e?.message === 'string' && e.message.includes('EVOLUTION_')) {
        return res.status(500).json({ error: e.message });
      }
      const err = e as EvolutionRequestError;
      if (err && typeof err.status === 'number') {
        const mapped = mapEvolutionError(err);
        return res.status(mapped.httpStatus).json({ error: mapped.message });
      }
      return res.status(500).json({ error: 'Erro ao enviar confirmação' });
    }
  });

  app.post('/api/admin/bookings/:bookingId/status', requireAdminMw, async (req, res) => {
    try {
      const admin = getAdminFromReq(req);
      const bookingId = req.params.bookingId;
      const nextStatus = (req.body as { status?: unknown })?.status;
      if (typeof nextStatus !== 'string') return res.status(400).json({ error: 'status é obrigatório' });

      const allowed = ['confirmed', 'completed', 'no_show'] as const;
      if (!allowed.includes(nextStatus as any)) return res.status(400).json({ error: 'status inválido' });

      const bookingRef = db.collection('bookings').doc(bookingId);
      const bookingDoc = await bookingRef.get();
      if (!bookingDoc.exists) return res.status(404).json({ error: 'Reserva não encontrada' });
      const booking = bookingDoc.data() as any;
      if (admin.role === 'barber' && booking.barberId !== admin.barberId) {
        return res.status(403).json({ error: 'Acesso restrito' });
      }

      const currentStatus = typeof booking.status === 'string' ? booking.status : 'booked';
      if (['cancelled', 'rescheduled'].includes(currentStatus)) {
        return res.status(400).json({ error: 'Não é possível alterar status desta reserva' });
      }

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
        // Firestore transactions require all reads to happen before any writes.
        const customerDoc = customerRef ? await tx.get(customerRef) : null;

        const updates: Record<string, unknown> = {
          status: nextStatus,
          updatedAt: FieldValue.serverTimestamp(),
        };

        if (nextStatus === 'completed') updates.completedAt = FieldValue.serverTimestamp();
        if (nextStatus === 'no_show') updates.noShowAt = FieldValue.serverTimestamp();

        tx.update(bookingRef, updates);

        if (customerRef && customerDoc?.exists) {
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
      });

      return res.json({ success: true });
    } catch (e) {
      console.error('Error updating booking status:', e);
      return res.status(500).json({ error: 'Erro ao atualizar status' });
    }
  });

  app.get('/api/admin/week-summary', requireAdminMw, async (req, res) => {
    try {
      const admin = getAdminFromReq(req);
      const requestedBarberId = typeof req.query.barberId === 'string' ? req.query.barberId : null;
      const barberId = admin.role === 'barber' ? (admin.barberId as string) : requestedBarberId;
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

  // Endpoint para desbloquear um slot específico
  app.delete('/api/admin/blocks/:barberId/:slotId', requireAdminMw, async (req, res) => {
    try {
      const admin = getAdminFromReq(req);
      const { barberId, slotId } = req.params;

      // Validação de permissão
      if (admin.role === 'barber' && admin.barberId !== barberId) {
        return res.status(403).json({ error: 'Sem permissão para este barbeiro' });
      }

      if (!barberId || !slotId) {
        return res.status(400).json({ error: 'Parâmetros inválidos' });
      }

      const slotRef = db.collection('barbers').doc(barberId).collection('slots').doc(slotId);
      const slotDoc = await slotRef.get();

      if (!slotDoc.exists) {
        return res.status(404).json({ error: 'Slot não encontrado' });
      }

      const slotData = slotDoc.data();
      if (slotData?.kind !== 'block') {
        return res.status(400).json({ error: 'Este slot não é um bloqueio' });
      }

      await slotRef.delete();

      return res.json({ success: true, message: 'Bloqueio removido com sucesso' });
    } catch (e) {
      console.error('Error unblocking slot:', e);
      return res.status(500).json({ error: 'Erro ao remover bloqueio' });
    }
  });

  // Endpoint para desbloquear múltiplos slots de uma vez
  app.post('/api/admin/blocks/unblock', requireAdminMw, async (req, res) => {
    try {
      const admin = getAdminFromReq(req);
      const body = req.body as {
        barberId?: unknown;
        slotIds?: unknown;
      };

      const barberId = typeof body.barberId === 'string' ? body.barberId : null;
      const slotIds = Array.isArray(body.slotIds) ? body.slotIds.filter((id): id is string => typeof id === 'string') : [];

      if (!barberId || slotIds.length === 0) {
        return res.status(400).json({ error: 'Parâmetros inválidos' });
      }

      // Validação de permissão
      if (admin.role === 'barber' && admin.barberId !== barberId) {
        return res.status(403).json({ error: 'Sem permissão para este barbeiro' });
      }

      const batch = db.batch();
      let deletedCount = 0;

      for (const slotId of slotIds) {
        const slotRef = db.collection('barbers').doc(barberId).collection('slots').doc(slotId);
        const slotDoc = await slotRef.get();

        if (slotDoc.exists && slotDoc.data()?.kind === 'block') {
          batch.delete(slotRef);
          deletedCount++;
        }
      }

      await batch.commit();

      return res.json({ 
        success: true, 
        message: `${deletedCount} bloqueio(s) removido(s)`,
        deleted: deletedCount 
      });
    } catch (e) {
      console.error('Error unblocking slots:', e);
      return res.status(500).json({ error: 'Erro ao remover bloqueios' });
    }
  });

  app.post('/api/admin/blocks', requireAdminMw, async (req, res) => {
    try {
      const admin = getAdminFromReq(req);
      const body = req.body as {
        barberId?: unknown;
        startTime?: unknown;
        endTime?: unknown;
        reason?: unknown;
      };
      const requestedBarberId = typeof body.barberId === 'string' ? body.barberId : null;
      const barberId = admin.role === 'barber' ? (admin.barberId as string) : requestedBarberId;
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
        // Firestore transactions require all reads to happen before any writes.
        const planned: Array<{
          slot: DateTime;
          dateKey: string;
          ref: FirebaseFirestore.DocumentReference;
        }> = [];

        for (const slot of slots) {
          if (!isValidTimeSlot(slot) || isSunday(slot)) continue;
          const slotId = generateSlotId(slot);
          const dateKey = getDateKey(slot);
          const ref = db.collection('barbers').doc(barberId).collection('slots').doc(slotId);
          planned.push({ slot, dateKey, ref });
        }

        const existingDocs: FirebaseFirestore.DocumentSnapshot[] = [];
        for (const p of planned) {
          existingDocs.push(await tx.get(p.ref));
        }

        for (let i = 0; i < planned.length; i++) {
          if (existingDocs[i]?.exists) continue;
          const p = planned[i];
          tx.set(p.ref, {
            slotStart: Timestamp.fromDate(p.slot.toJSDate()),
            dateKey: p.dateKey,
            kind: 'block',
            reason,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      });

      return res.json({ success: true });
    } catch (e) {
      console.error('Error blocking slots:', e);
      return res.status(500).json({ error: 'Erro ao bloquear horários' });
    }
  });

  app.get('/api/admin/customers', requireAdminMw, async (req, res) => {
    try {
      const admin = getAdminFromReq(req);
      const lim = typeof req.query.limit === 'string' ? Number(req.query.limit) : 100;
      const limitN = Number.isFinite(lim) ? Math.min(Math.max(lim, 1), 500) : 100;

      if (admin.role === 'master') {
        const snapshot = await db.collection('customers').orderBy('stats.lastBookingAt', 'desc').limit(limitN).get();
        const items = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        return res.json({ items });
      }

      const barberId = admin.barberId as string;
      const bookingsSnap = await db.collection('bookings').where('barberId', '==', barberId).limit(2000).get();
      const byCustomer = new Map<
        string,
        {
          customerId: string;
          identity?: { firstName?: string; lastName?: string; whatsappE164?: string };
          totalBookings: number;
          totalCompleted: number;
          noShowCount: number;
          lastBookingAtMs: number;
        }
      >();

      bookingsSnap.forEach((d) => {
        const data = d.data() as any;
        const customerId = typeof data.customerId === 'string' ? data.customerId : null;
        if (!customerId) return;
        const status = typeof data.status === 'string' ? data.status : 'booked';
        const slotStart: Date | null = data.slotStart?.toDate ? data.slotStart.toDate() : null;
        const ms = slotStart ? slotStart.getTime() : 0;
        const cur = byCustomer.get(customerId) ?? {
          customerId,
          totalBookings: 0,
          totalCompleted: 0,
          noShowCount: 0,
          lastBookingAtMs: 0,
        };
        cur.totalBookings += 1;
        if (status === 'completed') cur.totalCompleted += 1;
        if (status === 'no_show') cur.noShowCount += 1;
        if (ms > cur.lastBookingAtMs) cur.lastBookingAtMs = ms;
        byCustomer.set(customerId, cur);
      });

      const customerIds = Array.from(byCustomer.keys())
        .sort((a, b) => (byCustomer.get(b)?.lastBookingAtMs ?? 0) - (byCustomer.get(a)?.lastBookingAtMs ?? 0))
        .slice(0, limitN);

      const refs = customerIds.map((id) => db.collection('customers').doc(id));
      const snaps = refs.length > 0 ? await db.getAll(...refs) : [];

      const items = snaps
        .filter((s) => s.exists)
        .map((s) => {
          const data = s.data() as any;
          const stats = byCustomer.get(s.id);
          return {
            id: s.id,
            identity: data?.identity ?? {},
            profile: { birthday: data?.profile?.birthday ?? undefined },
            stats: {
              totalBookings: stats?.totalBookings ?? 0,
              totalCompleted: stats?.totalCompleted ?? 0,
              noShowCount: stats?.noShowCount ?? 0,
              lastBookingAt: stats?.lastBookingAtMs ? new Date(stats.lastBookingAtMs).toISOString() : null,
            },
          };
        });

      return res.json({ items });
    } catch {
      return res.status(500).json({ error: 'Erro ao carregar clientes' });
    }
  });

  // Endpoint para atualizar dados do cliente (apenas master)
  app.patch('/api/admin/customers/:customerId', requireAdminMw, requireMaster(), async (req, res) => {
    try {
      const customerId = req.params.customerId;
      if (!customerId) return res.status(400).json({ error: 'customerId é obrigatório' });

      const customerDoc = await db.collection('customers').doc(customerId).get();
      if (!customerDoc.exists) return res.status(404).json({ error: 'Cliente não encontrado' });

      const { birthdayMmdd, notes, tags } = req.body;
      const updateData: Record<string, any> = {};

      // Atualiza data de aniversário (formato MMDD)
      if (birthdayMmdd !== undefined) {
        if (birthdayMmdd === null || birthdayMmdd === '') {
          updateData['profile.birthdayMmdd'] = null;
          updateData['profile.birthday'] = null;
        } else if (typeof birthdayMmdd === 'string' && /^\d{4}$/.test(birthdayMmdd)) {
          updateData['profile.birthdayMmdd'] = birthdayMmdd;
          // Também atualiza birthday com formato ISO para compatibilidade
          const month = parseInt(birthdayMmdd.slice(0, 2), 10);
          const day = parseInt(birthdayMmdd.slice(2, 4), 10);
          const currentYear = new Date().getFullYear();
          updateData['profile.birthday'] = new Date(currentYear, month - 1, day).toISOString().split('T')[0];
        } else {
          return res.status(400).json({ error: 'Formato de data inválido. Use MMDD (ex: 0110 para 10/Jan)' });
        }
      }

      // Atualiza notas
      if (notes !== undefined) {
        updateData['profile.notes'] = notes || null;
      }

      // Atualiza tags
      if (tags !== undefined) {
        updateData['profile.tags'] = Array.isArray(tags) ? tags : [];
      }

      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: 'Nenhum dado para atualizar' });
      }

      await db.collection('customers').doc(customerId).update(updateData);

      const updated = await db.collection('customers').doc(customerId).get();
      return res.json({ success: true, item: { id: updated.id, ...updated.data() } });
    } catch (e) {
      console.error('Error updating customer:', e);
      return res.status(500).json({ error: 'Erro ao atualizar cliente' });
    }
  });

  app.get('/api/admin/customers/:customerId', requireAdminMw, async (req, res) => {
    try {
      const admin = getAdminFromReq(req);
      const customerId = req.params.customerId;
      if (!customerId) return res.status(400).json({ error: 'customerId é obrigatório' });

      if (admin.role === 'barber') {
        const snap = await db.collection('bookings').where('customerId', '==', customerId).limit(50).get();
        const ok = snap.docs.some((d) => (d.data() as any)?.barberId === admin.barberId);
        if (!ok) return res.status(404).json({ error: 'Cliente não encontrado' });
      }

      const customerDoc = await db.collection('customers').doc(customerId).get();
      if (!customerDoc.exists) return res.status(404).json({ error: 'Cliente não encontrado' });

      const data = customerDoc.data() as any;
      if (admin.role === 'master') {
        return res.json({ item: { id: customerDoc.id, ...data } });
      }

      return res.json({
        item: {
          id: customerDoc.id,
          identity: data?.identity ?? {},
          profile: { birthday: data?.profile?.birthday ?? undefined },
          stats: data?.stats ?? {},
        },
      });
    } catch {
      return res.status(500).json({ error: 'Erro ao carregar cliente' });
    }
  });

  app.get('/api/admin/customers/:customerId/bookings', requireAdminMw, async (req, res) => {
    try {
      const admin = getAdminFromReq(req);
      const customerId = req.params.customerId;
      if (!customerId) return res.status(400).json({ error: 'customerId é obrigatório' });

      const lim = typeof req.query.limit === 'string' ? Number(req.query.limit) : 50;
      const limitN = Number.isFinite(lim) ? Math.min(Math.max(lim, 1), 200) : 50;

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
        .filter((b) => (admin.role === 'barber' ? b.barberId === admin.barberId : true))
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

  // Legacy /ical feed
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

  // --- Branding Routes ---
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  });

  app.get('/api/admin/branding', requireAdminMw, async (_req, res) => {
    try {
      const config = await getBrandingConfig(db);
      return res.json(config);
    } catch (e) {
      return res.status(500).json({ error: 'Erro ao carregar branding' });
    }
  });

  app.patch('/api/admin/branding', requireAdminMw, requireMaster(), async (req, res) => {
    try {
      const body = req.body as Partial<BrandingSettings> & { commitLogo?: boolean };
      const { commitLogo, ...settings } = body;

      if (commitLogo) {
        try {
          await copyFileInGCS(env, 'logo-draft.png', 'logo.png');
        } catch (err) {
          console.error('Error promoting logo draft:', err);
        }
      }

      const current = await getBrandingConfig(db);

      const updated: BrandingSettings = {
        ...current,
        ...settings,
        updatedAt: new Date().toISOString(),
      };

      if (commitLogo) {
        updated.logoUrl = '/api/public/branding/logo';
      }

      await db.doc(BRANDING_CONFIG_DOC_PATH).set(updated, { merge: true });
      setBrandingConfigCache(updated);

      return res.json({ success: true, config: updated });
    } catch (e) {
      return res.status(500).json({ error: 'Erro ao atualizar branding' });
    }
  });

  // Public: serve current branding logo (kept in private GCS bucket)
  app.get('/api/public/branding/logo', async (_req, res) => {
    try {
      // If storage isn't configured yet, let the web fallback to /logo.png
      if (!env.GCP_STORAGE_BUCKET) return res.status(404).end();

      const { buffer, contentType, etag } = await downloadFromGCS(env, 'branding/logo.png');
      res.setHeader('Content-Type', contentType ?? 'image/png');
      // Cache 1h, allow stale while revalidating for 24h. Frontend uses ?v=timestamp for cache busting on updates.
      res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
      if (etag) res.setHeader('ETag', etag);
      return res.status(200).send(buffer);
    } catch (e: any) {
      // Not found (no logo uploaded yet)
      const msg = String(e?.message ?? '');
      if (e?.code === 404 || msg.includes('No such object') || msg.includes('Not Found')) {
        return res.status(404).end();
      }
      console.error('Error serving branding logo:', e);
      return res.status(500).end();
    }
  });

  app.get('/api/public/branding/logo-preview', async (_req, res) => {
    try {
      if (!env.GCP_STORAGE_BUCKET) return res.status(404).end();
      const { buffer, contentType } = await downloadFromGCS(env, 'branding/logo-draft.png');
      res.setHeader('Content-Type', contentType ?? 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(buffer);
    } catch (e: any) {
      return res.status(404).end();
    }
  });

  app.post(
    '/api/admin/branding/upload',
    requireAdminMw,
    requireMaster(),
    upload.single('file') as any,
    async (req, res) => {
      try {
        const type = req.query.type as string;
        if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        if (type !== 'logo') {
          return res.status(400).json({ error: 'Tipo inválido (apenas logo é suportado)' });
        }

        // Process logo: resize and normalize to PNG for a stable object path.
        let image = sharp(req.file.buffer);
        const metadata = await image.metadata();
        if (metadata.width && metadata.width > 1200) {
          image = image.resize(1200);
        }

        const buffer = await image.png().toBuffer();
        const contentType = 'image/png';
        const filename = 'logo-draft.png';

        await uploadToGCS(env, filename, buffer, contentType);

        const url = `/api/public/branding/logo-preview?v=${Date.now()}`;
        return res.json({ success: true, url, preview: true });
      } catch (e: any) {
        console.error('Upload error:', e);
        return res.status(500).json({ error: e.message || 'Erro no upload' });
      }
    }
  );
}

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
