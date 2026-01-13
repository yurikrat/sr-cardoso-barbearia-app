import { randomBytes, pbkdf2Sync, timingSafeEqual } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import type express from 'express';
import { FieldValue } from '@google-cloud/firestore';
import type { Firestore, FieldValue as FirestoreFieldValue, Timestamp as FirestoreTimestamp } from '@google-cloud/firestore';
import type { Env } from './env.js';
import { OWNER_BARBER_ID } from './finance.js';

export type AdminRole = 'master' | 'barber';
export type AdminClaims = {
  role: AdminRole;
  username: string;
  barberId?: string | null;
};

export type AdminUserDoc = {
  username: string;
  usernameLower: string;
  role: AdminRole;
  barberId?: string | null;
  phoneE164?: string | null;
  active: boolean;
  passwordHash: string;
  createdAt: FirestoreTimestamp | FirestoreFieldValue;
  updatedAt: FirestoreTimestamp | FirestoreFieldValue;
  lastLoginAt?: FirestoreTimestamp | FirestoreFieldValue;
};

export function normalizeUsername(input: string) {
  return input.trim().toLowerCase();
}

const PBKDF2_ITERS = 200_000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'sha256';

export function generatePassword(): string {
  return randomBytes(9)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 12);
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(password, salt, PBKDF2_ITERS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  return `pbkdf2$${PBKDF2_ITERS}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export function verifyPassword(password: string, passwordHash: string): boolean {
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

export async function signAdminToken(env: Env, claims: AdminClaims) {
  if (!env.ADMIN_JWT_SECRET) throw new Error('ADMIN_JWT_SECRET não configurado');
  const key = new TextEncoder().encode(env.ADMIN_JWT_SECRET);
  return new SignJWT({ role: claims.role, username: claims.username, barberId: claims.barberId ?? null })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.username)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(key);
}

export function getAdminFromReq(req: express.Request): AdminClaims {
  const anyReq = req as any;
  return anyReq.admin as AdminClaims;
}

function getAuthHeader(req: express.Request) {
  const h = req.headers.authorization;
  if (!h || typeof h !== 'string') return null;
  return h;
}

export function requireAdmin(env: Env): express.RequestHandler {
  return async (req, res, next) => {
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
      (req as any).admin = {
        role,
        username,
        barberId: typeof barberId === 'string' ? barberId : null,
      } satisfies AdminClaims;
      return next();
    } catch {
      return res.status(401).json({ error: 'Token inválido/expirado' });
    }
  };
}

export function requireMaster(): express.RequestHandler {
  return (req, res, next) => {
    const admin = getAdminFromReq(req);
    if (!admin || admin.role !== 'master') return res.status(403).json({ error: 'Acesso restrito' });
    return next();
  };
}

export async function bootstrapMasterUserIfNeeded(db: Firestore, env: Env) {
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
