import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextFunction, Request, Response } from 'express';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface FirebaseClientConfig {
  projectId?: string;
  firestoreDatabaseId?: string;
}

function loadFirebaseConfig(): FirebaseClientConfig {
  try {
    const configPath = path.resolve(__dirname, '../../firebase-applet-config.json');
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw) as FirebaseClientConfig;
  } catch {
    return {};
  }
}

const FIREBASE_CONFIG = loadFirebaseConfig();
const DEFAULT_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID || FIREBASE_CONFIG.projectId || 'totemic-day-3xq1s';
const DEFAULT_DATABASE_ID =
  process.env.FIRESTORE_DATABASE_ID ||
  FIREBASE_CONFIG.firestoreDatabaseId ||
  'ai-studio-bsdatabase-50b6a983-9848-440c-a013-8832bf63f5b0';

export const ADMIN_EMAILS = new Set(['farhana.jn2000@gmail.com']);

const GOOGLE_SECURETOKEN_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

interface CertCache {
  certs: Record<string, string>;
  expiresAtMs: number;
}

let certCache: CertCache | null = null;

function decodeBase64UrlJson<T = Record<string, unknown>>(segment: string): T {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as T;
}

function decodeBase64UrlBuffer(segment: string): Buffer {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
}

async function fetchGooglePublicCerts(forceRefresh = false): Promise<Record<string, string>> {
  const now = Date.now();
  if (!forceRefresh && certCache && now < certCache.expiresAtMs) {
    return certCache.certs;
  }

  const res = await fetch(GOOGLE_SECURETOKEN_CERTS_URL, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch Firebase public certificates (HTTP ${res.status})`);
  }

  const certs = (await res.json()) as Record<string, string>;
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Math.max(60, Number(maxAgeMatch[1])) : 3600;
  certCache = {
    certs,
    expiresAtMs: now + maxAgeSec * 1000,
  };
  return certs;
}

export interface VerifiedFirebaseTokenPayload {
  uid: string;
  email: string;
  emailVerified: boolean;
  isAnonymous: boolean;
  claims: Record<string, unknown>;
}

export interface VerifyIdTokenOptions {
  projectId?: string;
  nowSeconds?: number;
  getPublicCerts?: (forceRefresh?: boolean) => Promise<Record<string, string>>;
}

export async function verifyFirebaseIdToken(
  idToken: string,
  options?: VerifyIdTokenOptions
): Promise<VerifiedFirebaseTokenPayload> {
  const token = String(idToken || '').trim();
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed Firebase ID token');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  let header: { alg?: string; kid?: string };
  let payload: Record<string, unknown>;
  try {
    header = decodeBase64UrlJson<{ alg?: string; kid?: string }>(headerB64);
    payload = decodeBase64UrlJson<Record<string, unknown>>(payloadB64);
  } catch {
    throw new Error('Invalid Firebase ID token encoding');
  }

  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    throw new Error('Unsupported Firebase ID token algorithm or missing key ID');
  }

  const projectId = options?.projectId || DEFAULT_PROJECT_ID;
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;
  const nowSec = options?.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (payload.aud !== projectId) {
    throw new Error('Firebase ID token audience mismatch');
  }
  if (payload.iss !== expectedIssuer) {
    throw new Error('Firebase ID token issuer mismatch');
  }
  if (typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 128) {
    throw new Error('Firebase ID token missing valid subject');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new Error('Firebase ID token has expired');
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    throw new Error('Firebase ID token issued-at time is invalid');
  }
  if (typeof payload.auth_time === 'number' && payload.auth_time > nowSec + 300) {
    throw new Error('Firebase ID token auth_time is invalid');
  }

  const getCerts = options?.getPublicCerts ?? fetchGooglePublicCerts;
  let certs = await getCerts(false);
  let certPem = certs[header.kid];
  if (!certPem && !options?.getPublicCerts) {
    certs = await getCerts(true);
    certPem = certs[header.kid];
  }
  if (!certPem) {
    throw new Error('Signing certificate not found for Firebase ID token');
  }

  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = decodeBase64UrlBuffer(signatureB64);
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(signingInput);
  verifier.end();

  const validSig = verifier.verify(certPem, signature);
  if (!validSig) {
    throw new Error('Invalid Firebase ID token signature');
  }

  const firebaseMeta =
    payload.firebase && typeof payload.firebase === 'object'
      ? (payload.firebase as Record<string, unknown>)
      : {};
  const signInProvider = String(firebaseMeta.sign_in_provider || '');

  return {
    uid: payload.sub,
    email: typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '',
    emailVerified: payload.email_verified === true,
    isAnonymous: signInProvider === 'anonymous',
    claims: payload,
  };
}

async function defaultCheckFirestoreAdminRecord(
  uid: string,
  rawIdToken: string,
  projectId: string,
  databaseId: string
): Promise<boolean> {
  if (!uid || !rawIdToken) return false;
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      projectId
    )}/databases/${encodeURIComponent(databaseId)}/documents/admins/${encodeURIComponent(uid)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${rawIdToken}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as {
      fields?: { role?: { stringValue?: string } };
    };
    return data?.fields?.role?.stringValue === 'admin';
  } catch {
    return false;
  }
}

export interface AdminMiddlewareOptions {
  projectId?: string;
  databaseId?: string;
  verifyToken?: (token: string) => Promise<VerifiedFirebaseTokenPayload>;
  checkFirestoreAdminRecord?: (uid: string, rawToken: string) => Promise<boolean>;
}

export interface AuthenticatedAdminRequest extends Request {
  adminUser?: VerifiedFirebaseTokenPayload;
}

export function extractBearerToken(authHeader: string | string[] | undefined): string | null {
  const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!raw || typeof raw !== 'string') return null;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Server-side middleware enforcing verified Firebase Authentication and administrator
 * authorization for all protected /api/admin/* routes.
 * Never trusts client-supplied isAdmin/role/email body or query fields.
 */
export function createRequireAdminMiddleware(options?: AdminMiddlewareOptions) {
  const projectId = options?.projectId || DEFAULT_PROJECT_ID;
  const databaseId = options?.databaseId || DEFAULT_DATABASE_ID;
  const verifyToken =
    options?.verifyToken ?? ((token: string) => verifyFirebaseIdToken(token, { projectId }));
  const checkAdminRecord =
    options?.checkFirestoreAdminRecord ??
    ((uid: string, rawToken: string) =>
      defaultCheckFirestoreAdminRecord(uid, rawToken, projectId, databaseId));

  return async function requireAdminMiddleware(
    req: AuthenticatedAdminRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      res.status(401).json({
        ok: false,
        error: 'Authentication required for admin endpoints',
      });
      return;
    }

    let verified: VerifiedFirebaseTokenPayload;
    try {
      verified = await verifyToken(token);
    } catch {
      res.status(401).json({
        ok: false,
        error: 'Invalid or expired authentication token',
      });
      return;
    }

    if (verified.isAnonymous) {
      res.status(403).json({
        ok: false,
        error: 'Forbidden: administrator privileges required',
      });
      return;
    }

    const hasAdminClaim = verified.claims?.admin === true;
    const hasVerifiedAdminEmail =
      verified.emailVerified && Boolean(verified.email) && ADMIN_EMAILS.has(verified.email);

    let isAdminAuthorized = hasAdminClaim || hasVerifiedAdminEmail;

    if (!isAdminAuthorized && verified.emailVerified) {
      isAdminAuthorized = await checkAdminRecord(verified.uid, token);
    }

    if (!isAdminAuthorized) {
      res.status(403).json({
        ok: false,
        error: 'Forbidden: administrator privileges required',
      });
      return;
    }

    req.adminUser = verified;
    next();
  };
}

export const requireAdminMiddleware = createRequireAdminMiddleware();
