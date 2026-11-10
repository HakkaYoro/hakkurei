import type { APIRoute } from 'astro';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const prerender = false;

// ponytail: daily file cache, lazy refresh on first request after TTL
const OWNERS = ['HakkaYoro', 'YuiStarLord'];
const EXCLUDED_REPOS = ['HakkaYoro/order-api', 'HakkaYoro/ts-inventory-cli'];
const TTL = 24 * 60 * 60 * 1000;
const RETRY = 60 * 60 * 1000;
const FILE = path.join(process.cwd(), 'data', 'github-stats.json');

// Shared with the projects page client script via `import type` (erased at build).
export type Repo = {
	full_name: string;
	description: string | null;
	language: string | null;
	stars: number;
	commits: number;
	url: string;
};

export type Payload = { repos: Repo[] };

let memo: { payload: Payload; until: number } | null = null;

const json = (payload: Payload) =>
	new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });

function githubHeaders(): Record<string, string> {
	const headers: Record<string, string> = { 'User-Agent': 'hakkurei.com' };
	if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
	return headers;
}

// per_page=1 makes the rel="last" page number equal the count of commits authored by the repo owner
async function commitCount(full: string, owner: string): Promise<number> {
	const res = await fetch(`https://api.github.com/repos/${full}/commits?per_page=1&author=${owner}`, { headers: githubHeaders() });
	if (!res.ok) throw new Error(`commits ${res.status}`);
	const last = (res.headers.get('Link') || '').match(/page=(\d+)>;\s*rel="last"/);
	if (last) return parseInt(last[1], 10);
	const arr = await res.json();
	return Array.isArray(arr) ? arr.length : 0;
}

async function refresh(): Promise<Payload> {
	const repos: Repo[] = [];
	for (const owner of OWNERS) {
		const res = await fetch(`https://api.github.com/users/${owner}/repos?per_page=100`, { headers: githubHeaders() });
		if (!res.ok) throw new Error(`repos ${owner}: ${res.status}`);
		// ponytail: first page only; paginate if an owner ever passes 100 public repos
		for (const repo of await res.json()) {
			if (repo.fork || EXCLUDED_REPOS.includes(repo.full_name)) continue;
			// no per-repo catch: a failed count (rate limit, outage) aborts the whole
			// refresh — a half payload must not be cached as if it were the truth
			const commits = await commitCount(repo.full_name, repo.owner.login);
			if (!commits) continue; // zero authored commits: not the owner's work
			repos.push({
				full_name: repo.full_name,
				description: repo.description ?? null,
				language: repo.language ?? null,
				stars: repo.stargazers_count || 0,
				commits,
				url: repo.html_url,
			});
		}
	}
	repos.sort((a, b) => b.commits - a.commits || b.stars - a.stars);
	return { repos };
}

function readFile(): { payload: Payload; ts: number } | null {
	try {
		const ts = statSync(FILE).mtimeMs;
		const payload = JSON.parse(readFileSync(FILE, 'utf8')) as Payload;
		if (!Array.isArray(payload.repos)) return null;
		return { payload, ts };
	} catch (_) {
		return null;
	}
}

export const GET: APIRoute = async () => {
	if (memo && Date.now() < memo.until) return json(memo.payload);

	const file = readFile();
	if (file && Date.now() - file.ts < TTL) {
		memo = { payload: file.payload, until: file.ts + TTL };
		return json(memo.payload);
	}

	try {
		const payload = await refresh();
		// data/ is root-owned in this dev machine: the write fails with EACCES and the
		// payload still gets served from memory; in prod (chowned volume) it persists
		try {
			writeFileSync(FILE, JSON.stringify(payload));
		} catch (_) {}
		memo = { payload, until: Date.now() + TTL };
	} catch (err) {
		console.error('Error in github-stats GET api route:', err);
		// stale file beats an empty grid; back off instead of retrying GitHub per request
		memo = { payload: file ? file.payload : { repos: [] }, until: Date.now() + RETRY };
	}
	return json(memo.payload);
};
