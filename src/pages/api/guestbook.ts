import type { APIRoute } from 'astro';
import { getGuestbookEntries, addGuestbookEntry, checkGuestbookLimit, type GuestbookEntry } from '../../lib/db';

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
		// Proxy-aware IP, same logic as the donations endpoint
		const forwardedFor = request.headers.get('x-forwarded-for');
		const ip = forwardedFor ? forwardedFor.split(',')[0].trim() : (clientAddress || '127.0.0.1');

		// Anti-spam: cap posts per IP and globally per day
		const limit = checkGuestbookLimit(ip);
		if (!limit.allowed) {
			return new Response(JSON.stringify({ error: limit.errorMsg }), {
				status: 429,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		const body = await request.json();
		const { name, avatar, message } = body;

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

		const validAvatars = ['reimu', 'marisa', 'cirno', 'sakuya', 'sanae', 'youmu'];
		const selectedAvatar = validAvatars.includes(avatar) ? avatar : 'reimu';

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
