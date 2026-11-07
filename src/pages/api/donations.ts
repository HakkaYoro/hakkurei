import type { APIRoute } from 'astro';
import { getDonationsData, incrementDonations } from '../../lib/db';

export const prerender = false;

export const GET: APIRoute = async () => {
	const data = getDonationsData();
	return new Response(JSON.stringify({ total: data.total }), {
		status: 200,
		headers: {
			'Content-Type': 'application/json',
		},
	});
};

export const POST: APIRoute = async ({ request, clientAddress }) => {
	try {
		// Rate-limit key: the real connection IP by default. Only with TRUST_PROXY
		// set (deployment behind a reverse proxy) is x-forwarded-for honored, taking
		// the LAST entry — the one the trusted proxy appended (client-supplied
		// entries come first and are spoofable). Same logic as the guestbook endpoint.
		let ip = clientAddress || '127.0.0.1';
		if (process.env.TRUST_PROXY) {
			const lastForwarded = request.headers.get('x-forwarded-for')?.split(',').pop()?.trim();
			if (lastForwarded) ip = lastForwarded;
		}

		const result = incrementDonations(ip, 5);

		if (!result.success) {
			return new Response(JSON.stringify({ error: result.errorMsg, total: result.total }), {
				status: 429,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		return new Response(JSON.stringify({ success: true, total: result.total }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (err) {
		console.error('Error in donations POST api route:', err);
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
	}
};
