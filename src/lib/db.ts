import fs from 'node:fs';
import path from 'node:path';

export interface GuestbookEntry {
	name: string;
	avatar: string;
	date: string;
	message: string;
	isCharacter?: boolean;
}

export interface DonationsData {
	total: number;
	dailyLimits: {
		[dateStr: string]: {
			globalCount: number;
			ips: {
				[ip: string]: number;
			};
		};
	};
}

const DATA_DIR = path.join(process.cwd(), 'data');
const GUESTBOOK_PATH = path.join(DATA_DIR, 'guestbook.json');
const DONATIONS_PATH = path.join(DATA_DIR, 'donations.json');
const GUESTBOOK_LIMITS_PATH = path.join(DATA_DIR, 'guestbook_limits.json');

// Preseeded comments from legendary Touhou characters
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

// Helper to ensure data directory and files exist
function ensureFilesExist() {
	if (!fs.existsSync(DATA_DIR)) {
		fs.mkdirSync(DATA_DIR, { recursive: true });
	}

	if (!fs.existsSync(GUESTBOOK_PATH)) {
		fs.writeFileSync(GUESTBOOK_PATH, JSON.stringify(preseededEntries, null, 2), 'utf-8');
	}

	if (!fs.existsSync(DONATIONS_PATH)) {
		const initialDonations: DonationsData = {
			total: 105,
			dailyLimits: {},
		};
		fs.writeFileSync(DONATIONS_PATH, JSON.stringify(initialDonations, null, 2), 'utf-8');
	}

	if (!fs.existsSync(GUESTBOOK_LIMITS_PATH)) {
		fs.writeFileSync(GUESTBOOK_LIMITS_PATH, JSON.stringify({}, null, 2), 'utf-8');
	}
}

// Guestbook operations
export function getGuestbookEntries(): GuestbookEntry[] {
	ensureFilesExist();
	try {
		const content = fs.readFileSync(GUESTBOOK_PATH, 'utf-8');
		return JSON.parse(content);
	} catch (err) {
		console.error('Error reading guestbook database file:', err);
		return preseededEntries;
	}
}

export function addGuestbookEntry(entry: GuestbookEntry): void {
	ensureFilesExist();
	try {
		const entries = getGuestbookEntries();
		entries.push(entry);
		fs.writeFileSync(GUESTBOOK_PATH, JSON.stringify(entries, null, 2), 'utf-8');
	} catch (err) {
		console.error('Error writing to guestbook database file:', err);
	}
}

// Donations operations
export function getDonationsData(): DonationsData {
	ensureFilesExist();
	try {
		const content = fs.readFileSync(DONATIONS_PATH, 'utf-8');
		return JSON.parse(content);
	} catch (err) {
		console.error('Error reading donations database file:', err);
		return { total: 105, dailyLimits: {} };
	}
}

export function saveDonationsData(data: DonationsData): void {
	ensureFilesExist();
	try {
		fs.writeFileSync(DONATIONS_PATH, JSON.stringify(data, null, 2), 'utf-8');
	} catch (err) {
		console.error('Error writing to donations database file:', err);
	}
}

export interface DonationCheckResult {
	success: boolean;
	total: number;
	errorMsg?: string;
}

export function incrementDonations(ip: string, amount: number = 5): DonationCheckResult {
	const data = getDonationsData();
	const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

	// Check if date entry exists
	if (!data.dailyLimits[today]) {
		data.dailyLimits[today] = {
			globalCount: 0,
			ips: {},
		};
	}

	const limits = data.dailyLimits[today];
	const currentIpDonations = limits.ips[ip] || 0;

	// Limit checks:
	// 1. IP limit: Max 50 yen per IP per day (10 offerings)
	const maxIpDonation = 50;
	if (currentIpDonations + amount > maxIpDonation) {
		return {
			success: false,
			total: data.total,
			errorMsg: 'Hey! Donating too much today will anger the gods... (Daily limit reached!)',
		};
	}

	// 2. Global limit: Max 1000 yen per day
	const maxGlobalDonation = 1000;
	if (limits.globalCount + amount > maxGlobalDonation) {
		return {
			success: false,
			total: data.total,
			errorMsg: 'The donation box is full for today! Please check back tomorrow.',
		};
	}

	// Increment
	limits.ips[ip] = currentIpDonations + amount;
	limits.globalCount += amount;
	data.total += amount;

	saveDonationsData(data);

	return {
		success: true,
		total: data.total,
	};
}

// Guestbook anti-spam: per-IP + global daily cap.
export interface GuestbookRateLimits {
	[dateStr: string]: {
		globalCount: number;
		ips: {
			[ip: string]: number;
		};
	};
}

export interface RateLimitResult {
	allowed: boolean;
	errorMsg?: string;
}

// ponytail: sync read-modify-write is accidentally atomic under a single Node
// process (same property incrementDonations relies on). Add locking if this ever
// runs across multiple processes/replicas.
export function checkGuestbookLimit(
	ip: string,
	maxPerIp = 5,
	maxGlobal = 50,
): RateLimitResult {
	ensureFilesExist();
	let data: GuestbookRateLimits = {};
	try {
		data = JSON.parse(fs.readFileSync(GUESTBOOK_LIMITS_PATH, 'utf-8'));
	} catch (err) {
		console.error('Error reading guestbook rate-limit file:', err);
		data = {};
	}

	const today = new Date().toISOString().split('T')[0];
	if (!data[today]) {
		data[today] = { globalCount: 0, ips: {} };
	}

	const slot = data[today];
	const ipCount = slot.ips[ip] || 0;

	if (ipCount + 1 > maxPerIp) {
		return {
			allowed: false,
			errorMsg: 'The shrine bell needs a rest — you have signed enough for today! (Daily limit reached)',
		};
	}
	if (slot.globalCount + 1 > maxGlobal) {
		return {
			allowed: false,
			errorMsg: 'The guestbook is full for today, please come back tomorrow!',
		};
	}

	slot.ips[ip] = ipCount + 1;
	slot.globalCount += 1;

	try {
		fs.writeFileSync(GUESTBOOK_LIMITS_PATH, JSON.stringify(data, null, 2), 'utf-8');
	} catch (err) {
		console.error('Error writing guestbook rate-limit file:', err);
	}

	return { allowed: true };
}
