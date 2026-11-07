// Rate-limit key: the real connection IP by default. Only with TRUST_PROXY
// set (deployment behind a reverse proxy) is x-forwarded-for honored, taking
// the LAST entry — the one the trusted proxy appended (client-supplied
// entries come first and are spoofable). Shared by the guestbook and
// donations endpoints.
export function rateLimitIp(request: Request, clientAddress: string | undefined): string {
	let ip = clientAddress || '127.0.0.1';
	if (process.env.TRUST_PROXY) {
		const lastForwarded = request.headers.get('x-forwarded-for')?.split(',').pop()?.trim();
		if (lastForwarded) ip = lastForwarded;
	}
	return ip;
}
