const DEFAULT_SERVER_PORT = "2567";

function fallbackWsEndpoint() {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	const host = window.location.hostname || "localhost";
	return `${protocol}//${host}:${DEFAULT_SERVER_PORT}`;
}

export function resolveServerEndpoint(search: string = window.location.search) {
	const params = new URLSearchParams(search);
	const fromQuery = params.get("endpoint")?.trim();
	if (fromQuery) return fromQuery;

	const fromEnv = import.meta.env.VITE_SERVER_URL?.trim();
	if (fromEnv) return fromEnv;

	return fallbackWsEndpoint();
}

export function resolveHttpBase(endpoint: string) {
	try {
		const parsed = new URL(endpoint);
		return `${parsed.protocol === "wss:" ? "https:" : "http:"}//${parsed.host}`;
	} catch {
		const fallbackEndpoint = fallbackWsEndpoint();
		const parsed = new URL(fallbackEndpoint);
		return `${parsed.protocol === "wss:" ? "https:" : "http:"}//${parsed.host}`;
	}
}
