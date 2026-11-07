import type { APIRoute } from 'astro';
import { incrementDonations } from '../../lib/db';
import { rateLimitIp } from '../../lib/ip';

export const prerender = false;

export const POST: APIRoute = async ({ request, clientAddress }) => {
	try {
		const ip = rateLimitIp(request, clientAddress);

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
