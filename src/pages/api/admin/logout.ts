import type { APIRoute } from 'astro';
import { destroySession, sessionTokenFromRequest, clearSessionCookieHeader } from '../../../lib/admin';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	destroySession(sessionTokenFromRequest(request));
	return new Response(JSON.stringify({ success: true }), {
		status: 200,
		headers: {
			'Content-Type': 'application/json',
			'Set-Cookie': clearSessionCookieHeader(request),
		},
	});
};
