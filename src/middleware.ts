import fs from 'node:fs';
import path from 'node:path';
import type { APIContext, MiddlewareNext } from 'astro';

// Serve the prerendered 404 page for unhandled on-demand-route errors, keeping the
// error's status. Semantics verified live against dist/server/entry.mjs (Astro 7.4,
// @astrojs/node standalone):
// - Unknown URLs never reach this catch: no route matches, so @astrojs/node serves the
//   prerendered dist/client/404.html directly with its real 404 status (no middleware).
// - context.rewrite('/404') THROWS in production standalone ("unable to find a component
//   instance for route /404") because prerendered routes have no SSR component instance,
//   so the prerendered HTML is read from dist/client and re-wrapped with the caught
//   status; the rewrite call stays first because it is the path that works in `astro dev`.
// - /api/* rethrows: designed JSON errors (400/413/429) pass through `next()` untouched,
//   and unhandled API throws keep Astro's own bare 500.
let cachedErrorPage: string | null = null;

function loadErrorPage(): string | null {
	if (cachedErrorPage !== null) return cachedErrorPage;
	try {
		cachedErrorPage = fs.readFileSync(path.join(process.cwd(), 'dist', 'client', '404.html'), 'utf-8');
	} catch (_) {
		cachedErrorPage = '';
	}
	return cachedErrorPage;
}

export async function onRequest(context: APIContext, next: MiddlewareNext): Promise<Response> {
	try {
		return await next();
	} catch (err) {
		if (context.url.pathname.startsWith('/api/')) throw err;
		const raw = (err as { status?: number }).status;
		const status = typeof raw === 'number' && raw >= 400 && raw < 600 ? raw : 500;
		try {
			const rewritten = await context.rewrite('/404');
			return new Response(rewritten.body, { status, headers: rewritten.headers });
		} catch (_) {
			const html = loadErrorPage();
			if (html) {
				return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
			}
			return new Response('Internal Server Error', { status: 500 });
		}
	}
}
