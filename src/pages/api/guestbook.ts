import type { APIRoute } from 'astro';
import { getGuestbookEntries, addGuestbookEntry, checkGuestbookLimit, type GuestbookEntry } from '../../lib/db';
import { rateLimitIp } from '../../lib/ip';

export const prerender = false;

export const GET: APIRoute = async () => {
	const entries = getGuestbookEntries();
	return new Response(JSON.stringify(entries), {
		status: 200,
		headers: {
			'Content-Type': 'application/json',
		},
	});
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
	try {
		const ip = rateLimitIp(request, clientAddress);

		// Cap the parse buffer before json(): Node imposes no default body limit.
		// Header-only check; chunked bodies bypass it at a 1:1 bandwidth cost.
		const contentLength = Number(request.headers.get('content-length'));
		if (Number.isFinite(contentLength) && contentLength > 4096) {
			return new Response(JSON.stringify({ error: 'Request body too large.' }), { status: 413 });
		}

		// Malformed bodies get a 400 before any rate-limit quota is touched
		const body: unknown = await request.json().catch(() => null);
		if (!body || typeof body !== 'object') {
			return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), { status: 400 });
		}
		const { name, avatar, message } = body as { name?: unknown; avatar?: unknown; message?: unknown };

		if (!name || typeof name !== 'string' || name.trim().length === 0) {
			return new Response(JSON.stringify({ error: 'Name handle is required.' }), { status: 400 });
		}
		if (name.length > 30) {
			return new Response(JSON.stringify({ error: 'Name must be under 30 characters.' }), { status: 400 });
		}
		if (!message || typeof message !== 'string' || message.trim().length === 0) {
			return new Response(JSON.stringify({ error: 'Prayer message is required.' }), { status: 400 });
		}
		if (message.length > 500) {
			return new Response(JSON.stringify({ error: 'Message must be under 500 characters.' }), { status: 400 });
		}

		// Anti-spam: cap accepted posts per IP and globally per day, checked after
		// validation so malformed requests can't burn the daily quota
		const limit = checkGuestbookLimit(ip);
		if (!limit.allowed) {
			return new Response(JSON.stringify({ error: limit.errorMsg }), {
				status: 429,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		const validAvatars = ['reimu', 'marisa', 'cirno', 'sakuya', 'sanae', 'youmu'];
		const selectedAvatar = typeof avatar === 'string' && validAvatars.includes(avatar) ? avatar : 'reimu';

		const newEntry: GuestbookEntry = {
			name: name.trim(),
			avatar: selectedAvatar,
			date: formatDate(new Date()),
			message: message.trim(),
			isCharacter: false,
		};

		addGuestbookEntry(newEntry);

		return new Response(JSON.stringify({ success: true, entry: newEntry }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (err) {
		console.error('Error in guestbook POST api route:', err);
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
	}
};

function formatDate(date: Date) {
	const pad = (n: number) => String(n).padStart(2, '0');
	const yyyy = date.getFullYear();
	const mm = pad(date.getMonth() + 1);
	const dd = pad(date.getDate());
	const hh = pad(date.getHours());
	const min = pad(date.getMinutes());
	const sec = pad(date.getSeconds());
	return `${yyyy}-${mm}-${dd} ${hh}:${min}:${sec}`;
}
