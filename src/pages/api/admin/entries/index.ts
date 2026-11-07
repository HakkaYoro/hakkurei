import type { APIRoute } from 'astro';
import { requireSession } from '../../../../lib/admin';
import { getGuestbookEntriesWithIds } from '../../../../lib/db';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
	const unauthorized = requireSession(request);
	if (unauthorized) return unauthorized;

	return new Response(JSON.stringify(getGuestbookEntriesWithIds()), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
