import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export interface GuestbookEntry {
	name: string;
	avatar: string;
	date: string;
	message: string;
	isCharacter?: boolean;
}

export interface DonationCheckResult {
	success: boolean;
	total: number;
	errorMsg?: string;
}

export interface RateLimitResult {
	allowed: boolean;
	errorMsg?: string;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'hakkurei.db');
const LEGACY_GUESTBOOK = path.join(DATA_DIR, 'guestbook.json');
const LEGACY_DONATIONS = path.join(DATA_DIR, 'donations.json');
const LEGACY_GUESTBOOK_LIMITS = path.join(DATA_DIR, 'guestbook_limits.json');

// Keep only the most recent 500 entries so the table cannot grow unbounded.
const MAX_GUESTBOOK_ENTRIES = 500;
const DONATIONS_IP_DAILY_MAX = 50;
const DONATIONS_GLOBAL_DAILY_MAX = 1000;

// Preseeded comments from legendary Touhou characters (used when there is no
// legacy JSON to import and the database is brand new)
const preseededEntries: GuestbookEntry[] = [
	{
		name: 'Cirno ⑨',
		avatar: 'cirno',
		date: '2026-05-18 14:09:22',
		message: "I am the strongest!!! ⑨⑨⑨ First visitor of the day! There are no frogs in Reimu's pond so I'm going to freeze the grass instead! Ze!",
		isCharacter: true,
	},
	{
		name: 'Marisa Kirisame',
		avatar: 'marisa',
		date: '2026-05-18 16:32:00',
		message: "Yo! Nice guestbook. Though the shrine is as empty as always. I'm borrowing some of your tea leaves, Reimu, and maybe a few books from the library (don't tell Patchy!). Keep it safe! ☆",
		isCharacter: true,
	},
	{
		name: 'Sakuya Izayoi',
		avatar: 'sakuya',
		date: '2026-05-19 09:12:45',
		message: 'I have left a basket of premium tea leaves and clean teacups. Reimu, please make sure you actually clean the dust from the torii gate this week. The Mistress might visit if it is clean enough.',
		isCharacter: true,
	},
	{
		name: 'Sanae Kochiya',
		avatar: 'sanae',
		date: '2026-05-19 12:45:10',
		message: "Greetings from Moriya Shrine! Our automated donation box is much more modern and gathers tons of faith, but this vintage retro wooden box here certainly has its charm! Good luck, Reimu-san! Let's both do our best!",
		isCharacter: true,
	},
	{
		name: 'Youmu Konpaku',
		avatar: 'youmu',
		date: '2026-05-20 07:20:15',
		message: 'I was sweeping the steps on my way up. It is peaceful here. Lady Yuyuko ate all the dango I prepared for our return journey, so I might need to rest under your cherry blossoms for a bit, Reimu-san...',
		isCharacter: true,
	},
];

let db: Database.Database;

function initDb(): Database.Database {
	if (db) return db;
	if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
	const fresh = !fs.existsSync(DB_PATH);
	db = new Database(DB_PATH);
	db.pragma('journal_mode = WAL');
	db.exec(`
		CREATE TABLE IF NOT EXISTS entries (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			avatar TEXT NOT NULL,
			date TEXT NOT NULL,
			message TEXT NOT NULL,
			isCharacter INTEGER NOT NULL DEFAULT 0
		);
		CREATE TABLE IF NOT EXISTS donations_totals (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			total INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS rate_limits (
			bucket TEXT NOT NULL,
			scope TEXT NOT NULL,
			key TEXT NOT NULL,
			count INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (bucket, scope, key)
		);
	`);
	if (fresh) migrateLegacyData();
	return db;
}

// First boot on an existing deployment: import the legacy JSON files as-is.
// Without them (fresh install), seed the character entries and the 105 total.
function migrateLegacyData(): void {
	let entries: GuestbookEntry[] | null = null;
	try {
		const parsed = JSON.parse(fs.readFileSync(LEGACY_GUESTBOOK, 'utf-8'));
		if (Array.isArray(parsed) && parsed.length) entries = parsed;
	} catch { /* no legacy file */ }
	const insertEntry = db.prepare(
		'INSERT INTO entries (name, avatar, date, message, isCharacter) VALUES (?, ?, ?, ?, ?)',
	);
	if (entries) {
		for (const e of entries) {
			insertEntry.run(e.name, e.avatar, e.date, e.message, e.isCharacter ? 1 : 0);
		}
	} else {
		for (const e of preseededEntries) {
			insertEntry.run(e.name, e.avatar, e.date, e.message, e.isCharacter ? 1 : 0);
		}
	}

	let total = 105;
	try {
		const donations = JSON.parse(fs.readFileSync(LEGACY_DONATIONS, 'utf-8'));
		if (donations && typeof donations.total === 'number') total = donations.total;
	} catch { /* no legacy file */ }
	db.prepare('INSERT INTO donations_totals (id, total) VALUES (1, ?)').run(total);

	importLegacyRateLimits(LEGACY_DONATIONS, 'donations');
	importLegacyRateLimits(LEGACY_GUESTBOOK_LIMITS, 'guestbook');
}

function importLegacyRateLimits(file: string, scope: string): void {
	let data: Record<string, { globalCount?: number; ips?: Record<string, number> }> | null = null;
	try {
		const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
		if (parsed && typeof parsed === 'object' && parsed.dailyLimits) data = parsed.dailyLimits;
		else if (parsed && typeof parsed === 'object') data = parsed;
	} catch { /* no legacy file */ }
	if (!data) return;
	const insert = db.prepare(
		'INSERT OR IGNORE INTO rate_limits (bucket, scope, key, count) VALUES (?, ?, ?, ?)',
	);
	for (const [day, slot] of Object.entries(data)) {
		if (!slot || typeof slot !== 'object') continue;
		if (typeof slot.globalCount === 'number') {
			insert.run(`d:${day}`, scope, '__global__', slot.globalCount);
		}
		if (slot.ips && typeof slot.ips === 'object') {
			for (const [ip, count] of Object.entries(slot.ips)) {
				if (typeof count === 'number') insert.run(`d:${day}`, scope, ip, count);
			}
		}
	}
}

// Rate-limit buckets: 'd:YYYY-MM-DD' for daily scopes, 'm:YYYY-MM-DDTHH:MM' for
// per-minute ones. Stale buckets are dropped on every use so the table stays tiny.
function pruneRateLimits(day: string, minute: string): void {
	db.prepare("DELETE FROM rate_limits WHERE bucket LIKE 'd:%' AND bucket != ?").run(day);
	db.prepare("DELETE FROM rate_limits WHERE bucket LIKE 'm:%' AND bucket != ?").run(minute);
}

function rateCount(bucket: string, scope: string, key: string): number {
	const row = db.prepare('SELECT count FROM rate_limits WHERE bucket = ? AND scope = ? AND key = ?')
		.get(bucket, scope, key) as { count: number } | undefined;
	return row ? row.count : 0;
}

function rateBump(bucket: string, scope: string, key: string, amount: number): void {
	db.prepare(`
		INSERT INTO rate_limits (bucket, scope, key, count) VALUES (?, ?, ?, ?)
		ON CONFLICT (bucket, scope, key) DO UPDATE SET count = count + excluded.count
	`).run(bucket, scope, key, amount);
}

// Guestbook operations
export function getGuestbookEntries(): GuestbookEntry[] {
	const rows = initDb().prepare('SELECT name, avatar, date, message, isCharacter FROM entries ORDER BY id')
		.all() as Array<{ name: string; avatar: string; date: string; message: string; isCharacter: number }>;
	return rows.map((r) => ({ ...r, isCharacter: !!r.isCharacter }));
}

// Admin panel view: ids + newest first
export function getGuestbookEntriesWithIds(): Array<GuestbookEntry & { id: number }> {
	const rows = initDb().prepare('SELECT id, name, avatar, date, message, isCharacter FROM entries ORDER BY id DESC')
		.all() as Array<{ id: number; name: string; avatar: string; date: string; message: string; isCharacter: number }>;
	return rows.map((r) => ({ ...r, isCharacter: !!r.isCharacter }));
}

export function addGuestbookEntry(entry: GuestbookEntry): void {
	initDb().prepare('INSERT INTO entries (name, avatar, date, message, isCharacter) VALUES (?, ?, ?, ?, ?)')
		.run(entry.name, entry.avatar, entry.date, entry.message, entry.isCharacter ? 1 : 0);
	db.prepare(`
		DELETE FROM entries WHERE id NOT IN (
			SELECT id FROM entries ORDER BY id DESC LIMIT ?
		)
	`).run(MAX_GUESTBOOK_ENTRIES);
}

// Admin panel: remove a guestbook entry by id
export function deleteGuestbookEntry(id: number): boolean {
	return initDb().prepare('DELETE FROM entries WHERE id = ?').run(id).changes > 0;
}

// Donations operations
export function getDonationsTotal(): number {
	return (initDb().prepare('SELECT total FROM donations_totals WHERE id = 1').get() as { total: number } | undefined)?.total ?? 105;
}

export function incrementDonations(ip: string, amount: number = 5): DonationCheckResult {
	const today = `d:${new Date().toISOString().split('T')[0]}`;
	initDb();
	pruneRateLimits(today, today);

	const currentIpDonations = rateCount(today, 'donations', ip);
	if (currentIpDonations + amount > DONATIONS_IP_DAILY_MAX) {
		return {
			success: false,
			total: getDonationsTotal(),
			errorMsg: 'Hey! Donating too much today will anger the gods... (Daily limit reached!)',
		};
	}
	const globalCount = rateCount(today, 'donations', '__global__');
	if (globalCount + amount > DONATIONS_GLOBAL_DAILY_MAX) {
		return {
			success: false,
			total: getDonationsTotal(),
			errorMsg: 'The donation box is full for today! Please check back tomorrow.',
		};
	}

	rateBump(today, 'donations', ip, amount);
	rateBump(today, 'donations', '__global__', amount);
	db.prepare('UPDATE donations_totals SET total = total + ? WHERE id = 1').run(amount);

	return { success: true, total: getDonationsTotal() };
}

// Guestbook anti-spam: per-IP + global daily cap.
export function checkGuestbookLimit(
	ip: string,
	maxPerIp = 5,
	maxGlobal = 50,
): RateLimitResult {
	const today = `d:${new Date().toISOString().split('T')[0]}`;
	initDb();
	pruneRateLimits(today, today);

	if (rateCount(today, 'guestbook', ip) + 1 > maxPerIp) {
		return {
			allowed: false,
			errorMsg: 'The shrine bell needs a rest — you have signed enough for today! (Daily limit reached)',
		};
	}
	if (rateCount(today, 'guestbook', '__global__') + 1 > maxGlobal) {
		return {
			allowed: false,
			errorMsg: 'The guestbook is full for today, please come back tomorrow!',
		};
	}
	rateBump(today, 'guestbook', ip, 1);
	rateBump(today, 'guestbook', '__global__', 1);
	return { allowed: true };
}

// Admin login brute-force guard: 5 attempts per minute per IP.
export function checkAdminLoginLimit(ip: string, maxPerMinute = 5): RateLimitResult {
	const minute = `m:${new Date().toISOString().slice(0, 16)}`;
	const day = `d:${new Date().toISOString().split('T')[0]}`;
	initDb();
	pruneRateLimits(day, minute);
	if (rateCount(minute, 'admin-login', ip) + 1 > maxPerMinute) {
		return {
			allowed: false,
			errorMsg: 'Too many login attempts — the barrier needs a minute to recover.',
		};
	}
	rateBump(minute, 'admin-login', ip, 1);
	return { allowed: true };
}
