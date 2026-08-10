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
		// Fallback to headers if clientAddress is undefined or localhost
		const forwardedFor = request.headers.get('x-forwarded-for');
		const ip = forwardedFor ? forwardedFor.split(',')[0].trim() : (clientAddress || '127.0.0.1');

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
