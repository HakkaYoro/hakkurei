import type { APIRoute } from 'astro';

export const prerender = false;

// Same repos as the baked cards in src/pages/projects/index.astro
const REPOS = [
	'YuiStarLord/app-bcv',
	'HakkaYoro/Hakkurin',
	'HakkaYoro/HakkuAuto',
	'HakkaYoro/SpotiLinkConv',
	'HakkaYoro/AutoHMWRK',
	'HakkaYoro/order-api',
];

const TTL = 60 * 60 * 1000;
// ponytail: in-memory cache (the standalone adapter is one process); Redis if this ever grows
let cache: { ts: number; data: Record<string, { stars: number; commits: number }> } | null = null;

function githubHeaders(): Record<string, string> {
	const headers: Record<string, string> = { 'User-Agent': 'hakkurei.com' };
	if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
	return headers;
}

// per_page=1 makes the rel="last" page number equal the total commit count
async function commitCount(full: string): Promise<number> {
	const res = await fetch(`https://api.github.com/repos/${full}/commits?per_page=1`, { headers: githubHeaders() });
	if (!res.ok) throw new Error(`commits ${res.status}`);
	const last = (res.headers.get('Link') || '').match(/page=(\d+)>;\s*rel="last"/);
	if (last) return parseInt(last[1], 10);
	const arr = await res.json();
	return Array.isArray(arr) ? arr.length : 0;
}

export const GET: APIRoute = async () => {
	if (cache && Date.now() - cache.ts < TTL) {
		return new Response(JSON.stringify(cache.data), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	try {
		const data: Record<string, { stars: number; commits: number }> = {};
		await Promise.all(REPOS.map(async (full) => {
		try {
			const res = await fetch(`https://api.github.com/repos/${full}`, { headers: githubHeaders() });
			if (res.status === 404) {
				// dead/private repo: the card stays, with zeroed stats
				data[full] = { stars: 0, commits: 0 };
				return;
			}
			if (!res.ok) throw new Error(`repo ${res.status}`);
			const repo = await res.json();
			const commits = await commitCount(full);
			data[full] = { stars: repo.stargazers_count || 0, commits };
		} catch (_) {} // one flaky repo must not sink the rest
		}));

		// Only complete sets are served/cached: a partial payload would make the
		// client reorder blindly. On failure, serve whatever cache (or {}) exists.
		const complete = REPOS.every((full) => full in data);
		if (complete) {
			cache = { ts: Date.now(), data };
			return new Response(JSON.stringify(data), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		}
	} catch (_) {}

	return new Response(JSON.stringify(cache?.data ?? {}), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
};
