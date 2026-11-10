import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';

export const prerender = false;

export const GET: APIRoute = async () => {
	try {
		let text: unknown;
		try {
			text = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'mood.json'), 'utf-8')).text;
		} catch {
			text = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'mood.json'), 'utf-8')).text;
		}
		return new Response(JSON.stringify({ text: typeof text === 'string' ? text : '' }), {
			status: 200,
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
		});
	} catch (err) {
		console.error('Error in mood GET api route:', err);
		return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
	}
};
