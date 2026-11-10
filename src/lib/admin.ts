import crypto from 'node:crypto';

// Password-only admin auth: SHA-256 hex compare (the plaintext never lives in
// the repo), in-memory session tokens with a 1h TTL. Single-process app, so a
// Map is enough — restart logs everyone out, which is fine for this panel.
const SESSION_TTL_MS = 3600000;
const SESSION_COOKIE = 'admin_session';

// Default hash ships in code; deployments may override via ADMIN_PASSWORD_HASH
// (same format: hex sha256 of the password).
const DEFAULT_PASSWORD_HASH = '24b4cd12a3fc0e5cf5a43cd47347d60f964b669ef36a2008eb50e062d4cc47c1';

const sessions = new Map<string, number>(); // token -> expiresAt (epoch ms)

export function verifyPassword(password: string): boolean {
	const expected = process.env.ADMIN_PASSWORD_HASH || DEFAULT_PASSWORD_HASH;
	const hash = crypto.createHash('sha256').update(password).digest('hex');
	const a = Buffer.from(hash, 'hex');
	const b = Buffer.from(expected, 'hex');
	return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createSession(): string {
	const token = crypto.randomBytes(32).toString('hex');
	sessions.set(token, Date.now() + SESSION_TTL_MS);
	for (const [t, expiresAt] of sessions) {
		if (Date.now() > expiresAt) sessions.delete(t);
	}
	return token;
}

export function isSessionValid(token: string | undefined): boolean {
	if (!token) return false;
	const expiresAt = sessions.get(token);
	if (!expiresAt) return false;
	if (Date.now() > expiresAt) {
		sessions.delete(token);
		return false;
	}
	return true;
}

export function destroySession(token: string | undefined): void {
	if (token) sessions.delete(token);
}

export function sessionTokenFromRequest(request: Request): string | undefined {
	const cookie = request.headers.get('cookie');
	if (!cookie) return undefined;
	for (const part of cookie.split(';')) {
		const [name, ...rest] = part.trim().split('=');
		if (name === SESSION_COOKIE) return rest.join('=');
	}
	return undefined;
}

// Secure only when the request actually arrives over TLS — direct https, or
// (with TRUST_PROXY, cf. ip.ts) the proxy-appended x-forwarded-proto entry.
// Over plain HTTP the flag would make the browser drop the cookie and break
// admin login without protecting an already-plaintext hop.
function requestIsSecure(request: Request): boolean {
	if (process.env.TRUST_PROXY) {
		const proto = request.headers.get('x-forwarded-proto')?.split(',').pop()?.trim();
		if (proto) return proto === 'https';
	}
	return new URL(request.url).protocol === 'https:';
}

export function sessionCookieHeader(token: string, request: Request): string {
	const secure = requestIsSecure(request) ? '; Secure' : '';
	return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export function clearSessionCookieHeader(request: Request): string {
	const secure = requestIsSecure(request) ? '; Secure' : '';
	return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=0`;
}

// API-route guard: returns a 401 response when there is no valid session cookie.
export function requireSession(request: Request): Response | null {
	if (isSessionValid(sessionTokenFromRequest(request))) return null;
	return new Response(JSON.stringify({ error: 'Unauthorized.' }), {
		status: 401,
		headers: { 'Content-Type': 'application/json' },
	});
}
