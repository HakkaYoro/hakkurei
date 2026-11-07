import type { APIRoute } from 'astro';
import { rateLimitIp } from '../../../lib/ip';
import { checkAdminLoginLimit } from '../../../lib/db';
import { verifyPassword, createSession, sessionCookieHeader } from '../../../lib/admin';

export const prerender = false;

export const POST: APIRoute = async ({ request, clientAddress }) => {
	try {
		const ip = rateLimitIp(request, clientAddress);

		// Cap the parse buffer before json(): Node imposes no default body limit
		// (same cap as the guestbook POST; a real password is far under 4KB).
		const contentLength = Number(request.headers.get('content-length'));
		if (Number.isFinite(contentLength) && contentLength > 4096) {
			return new Response(JSON.stringify({ error: 'Request body too large.' }), { status: 413 });
		}

		const body: unknown = await request.json().catch(() => null);
		const password = body && typeof body === 'object'
			? (body as { password?: unknown }).password
			: undefined;
		if (typeof password !== 'string' || password.length === 0) {
			return new Response(JSON.stringify({ error: 'Password is required.' }), { status: 400 });
		}

		// Brute-force guard: every attempt burns quota, valid or not
		const limit = checkAdminLoginLimit(ip);
		if (!limit.allowed) {
			return new Response(JSON.stringify({ error: limit.errorMsg }), {
				status: 429,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		if (!verifyPassword(password)) {
			return new Response(JSON.stringify({ error: 'Wrong password. The barrier repels you.' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		const token = createSession();
		return new Response(JSON.stringify({ success: true }), {
			status: 200,
			headers: {
				'Content-Type': 'application/json',
				'Set-Cookie': sessionCookieHeader(token, request),
			},
		});
	} catch (err) {
		console.error('Error in admin auth route:', err);
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
	}
};
