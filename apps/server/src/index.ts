import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash, randomBytes, pbkdf2Sync, timingSafeEqual } from 'crypto';
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
  ADMIN_USERNAME?: string;
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
    ADMIN_USERNAME: process.env.ADMIN_USERNAME,
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

type AdminRole = 'master' | 'barber';
type AdminClaims = {
  role: AdminRole;
  username: string;
  barberId?: string | null;
};

type AdminUserDoc = {
  username: string;
  usernameLower: string;
  role: AdminRole;
  barberId?: string | null;
  active: boolean;
  passwordHash: string;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  lastLoginAt?: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
};

const OWNER_BARBER_ID = 'sr-cardoso';

type ServiceCatalogItem = {
  id: string;
  label: string;
  priceCents: number;
  active: boolean;
  sortOrder: number;
};

type FinanceConfig = {
  commissions: {
    defaultBarberPct: number; // ex.: 0.45
    ownerBarberPct: number; // ex.: 0.00 (dono)
  };
  services: ServiceCatalogItem[];
};

const FINANCE_CONFIG_DOC_PATH = 'settings/finance';

function normalizeServiceId(input: string): string | null {
  const id = input.trim().toLowerCase();
  if (!id) return null;
  // Permitimos underscore por compat com "cabelo_barba".
  if (!/^[a-z0-9][a-z0-9_-]{0,30}$/.test(id)) return null;
  return id;
}

function clampPct(input: unknown, fallback: number): number {
  const n = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(n)) return fallback;
  // Aceita tanto 0.45 quanto 45.
  const normalized = n > 1 ? n / 100 : n;
  return Math.max(0, Math.min(1, normalized));
}

function getDefaultServicePriceCentsFromEnv(serviceId: string): number {
  const cabelo = Number(process.env.PRICE_CABELO_CENTS ?? '4500');
  const barba = Number(process.env.PRICE_BARBA_CENTS ?? '3500');
  const combo = Number(process.env.PRICE_CABELO_BARBA_CENTS ?? '7000');
  if (serviceId === 'cabelo') return Number.isFinite(cabelo) ? cabelo : 4500;
  if (serviceId === 'barba') return Number.isFinite(barba) ? barba : 3500;
  if (serviceId === 'cabelo_barba') return Number.isFinite(combo) ? combo : 7000;
  return 0;
}

function getDefaultFinanceConfig(): FinanceConfig {
  return {
    commissions: {
      defaultBarberPct: 0.45,
      ownerBarberPct: 0,
    },
    services: [
      {
        id: 'cabelo',
        label: 'Cabelo',
        priceCents: getDefaultServicePriceCentsFromEnv('cabelo'),
        active: true,
        sortOrder: 10,
      },
      {
        id: 'barba',
        label: 'Barba',
        priceCents: getDefaultServicePriceCentsFromEnv('barba'),
        active: true,
        sortOrder: 20,
      },
      {
        id: 'cabelo_barba',
        label: 'Cabelo + Barba',
        priceCents: getDefaultServicePriceCentsFromEnv('cabelo_barba'),
        active: true,
        sortOrder: 30,
      },
    ],
  };
}

function sanitizeFinanceConfig(input: unknown): FinanceConfig {
  const base = getDefaultFinanceConfig();
  const obj = (input && typeof input === 'object') ? (input as any) : {};

  const commissionsObj = (obj.commissions && typeof obj.commissions === 'object') ? obj.commissions : {};
  const defaultBarberPct = clampPct(commissionsObj.defaultBarberPct, base.commissions.defaultBarberPct);
  const ownerBarberPct = clampPct(commissionsObj.ownerBarberPct, base.commissions.ownerBarberPct);

  const servicesRaw = Array.isArray(obj.services) ? obj.services : base.services;
  const services: ServiceCatalogItem[] = [];
  const seen = new Set<string>();

  for (const it of servicesRaw) {
    const item = (it && typeof it === 'object') ? (it as any) : null;
    const id = normalizeServiceId(typeof item?.id === 'string' ? item.id : '')
      ?? normalizeServiceId(typeof item?.serviceType === 'string' ? item.serviceType : '');
    if (!id || seen.has(id)) continue;
    const label = typeof item?.label === 'string' && item.label.trim() ? item.label.trim() : id;
    const priceCents = Math.max(0, Math.round(Number(item?.priceCents ?? 0)));
    const active = typeof item?.active === 'boolean' ? item.active : true;
    const sortOrder = Number.isFinite(Number(item?.sortOrder)) ? Math.round(Number(item?.sortOrder)) : 0;
    services.push({ id, label, priceCents, active, sortOrder });
    seen.add(id);
  }

  // Garantir que pelo menos os 3 padrões existem (compat)
  for (const d of base.services) {
    if (!seen.has(d.id)) {
      services.push(d);
      seen.add(d.id);
    }
  }

  services.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.label.localeCompare(b.label, 'pt-BR');
  });

  return { commissions: { defaultBarberPct, ownerBarberPct }, services };
}

let financeConfigCache: { value: FinanceConfig; fetchedAtMs: number } | null = null;
const FINANCE_CONFIG_TTL_MS = 30_000;

async function getFinanceConfig(): Promise<FinanceConfig> {
  const now = Date.now();
  if (financeConfigCache && now - financeConfigCache.fetchedAtMs < FINANCE_CONFIG_TTL_MS) {
    return financeConfigCache.value;
  }
  try {
    const ref = db.doc(FINANCE_CONFIG_DOC_PATH);
    const snap = await ref.get();
    const cfg = snap.exists ? sanitizeFinanceConfig(snap.data()) : getDefaultFinanceConfig();
    financeConfigCache = { value: cfg, fetchedAtMs: now };
    return cfg;
  } catch (e) {
    console.warn('[server] Failed to load finance config; using defaults:', e);
    const cfg = getDefaultFinanceConfig();
    financeConfigCache = { value: cfg, fetchedAtMs: now };
    return cfg;
  }
}

function getServiceFromConfig(config: FinanceConfig, serviceId: string): ServiceCatalogItem | null {
  const normalized = normalizeServiceId(serviceId) ?? serviceId;
  return config.services.find((s) => s.id === normalized) ?? null;
}

function getServicePriceCentsFromConfig(config: FinanceConfig, serviceId: string): number {
  const s = getServiceFromConfig(config, serviceId);
  return s ? s.priceCents : 0;
}

function getBarberCommissionPct(config: FinanceConfig, barberId: string): number {
  return barberId === OWNER_BARBER_ID ? config.commissions.ownerBarberPct : config.commissions.defaultBarberPct;
}

function normalizeUsername(input: string) {
  return input.trim().toLowerCase();
}

const PBKDF2_ITERS = 200_000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'sha256';

function generatePassword(): string {
  // Human-friendly enough, still random. Example: Kp9dQe3mN7sR
  // Length ~12 chars.
  return randomBytes(9)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 12);
}

function normalizeBarberId(input: string) {
  const ascii = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return ascii
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function isValidBarberId(id: string) {
  // Keep it simple/consistent for URLs and doc ids.
  return /^[a-z0-9][a-z0-9-]{1,30}$/.test(id);
}

async function generateUniqueBarberIdFromName(name: string) {
  const parts = name
    .trim()
    .split(/\s+/g)
    .filter(Boolean);
  const baseSource = parts.length >= 2 ? `${parts[0]} ${parts[parts.length - 1]}` : name;
  const base = normalizeBarberId(baseSource);
  if (!base || !isValidBarberId(base)) return null;

  // Ensure it doesn't collide with existing barbers or admin usernames.
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

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(password, salt, PBKDF2_ITERS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  return `pbkdf2$${PBKDF2_ITERS}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

function verifyPassword(password: string, passwordHash: string): boolean {
  try {
    const parts = passwordHash.split('$');
    if (parts.length !== 4) return false;
    const [algo, itersStr, saltB64, hashB64] = parts;
    if (algo !== 'pbkdf2') return false;
    const iters = Number(itersStr);
    if (!Number.isFinite(iters) || iters < 10_000) return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = pbkdf2Sync(password, salt, iters, expected.length, PBKDF2_DIGEST);
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

async function signAdminToken(claims: AdminClaims) {
  if (!env.ADMIN_JWT_SECRET) throw new Error('ADMIN_JWT_SECRET não configurado');
  const key = new TextEncoder().encode(env.ADMIN_JWT_SECRET);
  return new SignJWT({ role: claims.role, username: claims.username, barberId: claims.barberId ?? null })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.username)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(key);
}

function getAdminFromReq(req: express.Request): AdminClaims {
  const anyReq = req as any;
  return anyReq.admin as AdminClaims;
}

function ensureRoleAllowed(role: AdminRole, allowed: readonly AdminRole[]) {
  return allowed.includes(role);
}

async function bootstrapMasterUserIfNeeded() {
  const username = normalizeUsername(env.ADMIN_USERNAME ?? OWNER_BARBER_ID);
  const password = env.ADMIN_PASSWORD;
  if (!username || !password) return;

  try {
    const ref = db.collection('adminUsers').doc(username);
    const snap = await ref.get();
    if (snap.exists) return;

    const now = FieldValue.serverTimestamp();
    const doc: AdminUserDoc = {
      username,
      usernameLower: username,
      role: 'master',
      barberId: null,
      active: true,
      passwordHash: hashPassword(password),
      createdAt: now,
      updatedAt: now,
    };
    await ref.set(doc);
    console.log('[server] Bootstrapped admin master user:', username);
  } catch (e) {
    console.warn('[server] Failed to bootstrap master user (continuing):', e);
  }
}

void bootstrapMasterUserIfNeeded();

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
    const verified = await jwtVerify(token, key, { algorithms: ['HS256'] });
    const payload = verified.payload as any;
    const role = payload?.role;
    const username = payload?.username;
    const barberId = payload?.barberId;
    if (role !== 'master' && role !== 'barber') return res.status(401).json({ error: 'Token inválido' });
    if (typeof username !== 'string' || !username.trim()) return res.status(401).json({ error: 'Token inválido' });
    if (role === 'barber' && (typeof barberId !== 'string' || !barberId.trim())) {
      return res.status(401).json({ error: 'Token inválido' });
    }
    (req as any).admin = { role, username, barberId: typeof barberId === 'string' ? barberId : null } satisfies AdminClaims;
    return next();
  } catch {
    return res.status(401).json({ error: 'Token inválido/expirado' });
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
      const token = await signAdminToken({ role: 'master', username: masterUsername, barberId: null });
      return res.json({ token });
    }

    const userRef = db.collection('adminUsers').doc(username);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return res.status(401).json({ error: 'Credenciais inválidas' });
    const user = userSnap.data() as AdminUserDoc;
    if (!user.active) return res.status(401).json({ error: 'Usuário desativado' });
    if (!verifyPassword(password, user.passwordHash)) return res.status(401).json({ error: 'Credenciais inválidas' });

    await userRef.update({ lastLoginAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });

    const token = await signAdminToken({
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

function requireMaster(req: express.Request, res: express.Response, next: express.NextFunction) {
  const admin = getAdminFromReq(req);
  if (!admin || admin.role !== 'master') return res.status(403).json({ error: 'Acesso restrito' });
  return next();
}

app.get('/api/admin/users', requireAdmin, requireMaster, async (_req, res) => {
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

app.post('/api/admin/users', requireAdmin, requireMaster, async (req, res) => {
  try {
    const body = req.body as { username?: unknown; password?: unknown; role?: unknown; barberId?: unknown; active?: unknown };
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

app.post('/api/admin/users/:username/reset-password', requireAdmin, requireMaster, async (req, res) => {
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

app.post('/api/admin/me/password', requireAdmin, async (req, res) => {
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

app.delete('/api/admin/users/:username', requireAdmin, requireMaster, async (req, res) => {
  try {
    const admin = getAdminFromReq(req);
    const username = normalizeUsername(req.params.username || '');
    if (!username) return res.status(400).json({ error: 'username inválido' });
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

    // If this is a barber login, also deactivate the corresponding professional so it disappears
    // from agenda tabs, while keeping booking history intact.
    if (data.role === 'barber') {
      const barberId = typeof data.barberId === 'string' ? data.barberId : null;
      if (barberId && barberId !== OWNER_BARBER_ID) {
        try {
          const barberRef = db.collection('barbers').doc(barberId);
          await barberRef.set({ active: false }, { merge: true });
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

app.post('/api/admin/barbers', requireAdmin, requireMaster, async (req, res) => {
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
      id = await generateUniqueBarberIdFromName(name);
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

app.post('/api/admin/users/:username/active', requireAdmin, requireMaster, async (req, res) => {
  try {
    const username = normalizeUsername(req.params.username || '');
    const active = (req.body as { active?: unknown })?.active;
    if (!username) return res.status(400).json({ error: 'username inválido' });
    if (typeof active !== 'boolean') return res.status(400).json({ error: 'active deve ser boolean' });
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

app.get('/api/admin/barbers', requireAdmin, async (_req, res) => {
  try {
    const admin = getAdminFromReq(_req);
    const snapshot = await db.collection('barbers').get();
    const items = snapshot.docs
      .map((doc) => {
        const data = doc.data() as { name?: unknown; active?: unknown };
        const name = typeof data?.name === 'string' && data.name.trim() ? data.name.trim() : doc.id;
        const active = typeof data?.active === 'boolean' ? data.active : true;
        return { id: doc.id, name, active };
      })
      .filter((b) => b.active);

    const scopedItems =
      admin?.role === 'barber'
        ? items.filter((b) => b.id === admin.barberId)
        : items;

    scopedItems.sort((a, b) => {
      const aIsOwner = a.id === OWNER_BARBER_ID;
      const bIsOwner = b.id === OWNER_BARBER_ID;
      if (aIsOwner && !bIsOwner) return -1;
      if (!aIsOwner && bIsOwner) return 1;
      return a.name.localeCompare(b.name, 'pt-BR');
    });
    return res.json({ items: scopedItems });
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

app.get('/api/services', async (_req, res) => {
  try {
    const config = await getFinanceConfig();
    const items = config.services
      .filter((s) => s.active)
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.label.localeCompare(b.label, 'pt-BR');
      })
      .map((s) => ({ id: s.id, label: s.label, priceCents: s.priceCents }));
    return res.json({ items });
  } catch (e) {
    console.error('Error listing services:', e);
    return res.status(500).json({ error: 'Erro ao listar serviços' });
  }
});

app.get('/api/admin/finance/config', requireAdmin, async (req, res) => {
  const admin = getAdminFromReq(req);
  if (admin.role !== 'master') return res.status(403).json({ error: 'Sem permissão' });
  try {
    const config = await getFinanceConfig();
    return res.json({ config });
  } catch (e) {
    console.error('Error loading finance config:', e);
    return res.status(500).json({ error: 'Erro ao carregar configurações' });
  }
});

app.put('/api/admin/finance/config', requireAdmin, async (req, res) => {
  const admin = getAdminFromReq(req);
  if (admin.role !== 'master') return res.status(403).json({ error: 'Sem permissão' });
  try {
    const incoming = req.body as unknown;
    const config = sanitizeFinanceConfig(incoming);
    const ref = db.doc(FINANCE_CONFIG_DOC_PATH);
    await ref.set(config, { merge: true });
    financeConfigCache = { value: config, fetchedAtMs: Date.now() };
    return res.json({ success: true, config });
  } catch (e) {
    console.error('Error saving finance config:', e);
    return res.status(500).json({ error: 'Erro ao salvar configurações' });
  }
});

app.get('/api/admin/finance/summary', requireAdmin, async (req, res) => {
  try {
    const admin = getAdminFromReq(req);
    const financeConfig = await getFinanceConfig();
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

      // Previsto: booked/confirmed. Realizado: completed. Ignora cancelled/no_show/rescheduled.
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
        const price = getServicePriceCentsFromConfig(financeConfig, serviceType);
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

      const financeConfig = await getFinanceConfig();
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

  // Sem acesso a Firestore aqui (path query) sem async; mantém fallback simples.
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

    const financeConfig = await getFinanceConfig();
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

    const financeConfig = await getFinanceConfig();
    const service = getServiceFromConfig(financeConfig, validated.serviceType);
    if (!service || !service.active) {
      return res.status(400).json({ error: 'Serviço inválido' });
    }

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

        // Only update name if it's not an initial (e.g. "S.")
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
    const admin = getAdminFromReq(req);
    const requestedBarberId = typeof req.query.barberId === 'string' ? req.query.barberId : null;
    const barberId = admin.role === 'barber' ? (admin.barberId as string) : requestedBarberId;
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

app.post('/api/admin/bookings/:bookingId/reschedule', requireAdmin, async (req, res) => {
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

app.post('/api/admin/bookings/:bookingId/status', requireAdmin, async (req, res) => {
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

app.post('/api/admin/blocks', requireAdmin, async (req, res) => {
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
    const admin = getAdminFromReq(req);
    const lim = typeof req.query.limit === 'string' ? Number(req.query.limit) : 100;
    const limitN = Number.isFinite(lim) ? Math.min(Math.max(lim, 1), 500) : 100;

    if (admin.role === 'master') {
      const snapshot = await db.collection('customers').orderBy('stats.lastBookingAt', 'desc').limit(limitN).get();
      const items = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      return res.json({ items });
    }

    const barberId = admin.barberId as string;
    // Avoid composite indexes: no orderBy in Firestore; sort in-memory.
    const bookingsSnap = await db.collection('bookings').where('barberId', '==', barberId).limit(2000).get();
    const byCustomer = new Map<string, {
      customerId: string;
      identity?: { firstName?: string; lastName?: string; whatsappE164?: string };
      totalBookings: number;
      totalCompleted: number;
      noShowCount: number;
      lastBookingAtMs: number;
    }>();

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

app.get('/api/admin/customers/:customerId', requireAdmin, async (req, res) => {
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

app.get('/api/admin/customers/:customerId/bookings', requireAdmin, async (req, res) => {
  try {
    const admin = getAdminFromReq(req);
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


