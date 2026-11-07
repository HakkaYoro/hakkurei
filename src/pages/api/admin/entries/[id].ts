import type { APIRoute } from 'astro';
import { requireSession } from '../../../../lib/admin';
import { deleteGuestbookEntry } from '../../../../lib/db';

export const prerender = false;

export const DELETE: APIRoute = async ({ request, params }) => {
	const unauthorized = requireSession(request);
	if (unauthorized) return unauthorized;

	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) {
		return new Response(JSON.stringify({ error: 'Invalid entry id.' }), { status: 400 });
	}

	const deleted = deleteGuestbookEntry(id);
	return new Response(JSON.stringify({ success: deleted }), {
		status: deleted ? 200 : 404,
		headers: { 'Content-Type': 'application/json' },
	});
};
