import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { requireSession } from '../../../lib/admin';

export const prerender = false;

// Rewrites data/mood.json — the runtime file /api/mood serves; the public/mood.json
// seed stays untouched so rebuilds never reset the admin-set mood.
export const PATCH: APIRoute = async ({ request }) => {
	try {
		const unauthorized = requireSession(request);
		if (unauthorized) return unauthorized;

		const body: unknown = await request.json().catch(() => null);
		const text = body && typeof body === 'object' ? (body as { text?: unknown }).text : undefined;
		if (typeof text !== 'string' || text.trim().length === 0) {
			return new Response(JSON.stringify({ error: 'Mood text is required.' }), { status: 400 });
		}
		if (text.length > 200) {
			return new Response(JSON.stringify({ error: 'Mood text must be under 200 characters.' }), { status: 400 });
		}

		const moodPath = path.join(process.cwd(), 'data', 'mood.json');
		fs.mkdirSync(path.dirname(moodPath), { recursive: true });
		fs.writeFileSync(moodPath, JSON.stringify({ text: text.trim() }, null, 2) + '\n', 'utf-8');

		return new Response(JSON.stringify({ success: true, text: text.trim() }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (err) {
		console.error('Error in admin mood route:', err);
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
	}
};
