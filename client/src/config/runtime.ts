const DEFAULT_SERVER_PORT = "2567";

function sanitizeEndpoint(rawValue: string): string {
	const trimmed = String(rawValue || "").trim();
	if (!trimmed) return "";
	try {
		const parsed = new URL(trimmed);
		parsed.hostname = parsed.hostname.replace(/\.+$/, "");
		return parsed.toString().replace(/\/$/, "");
	} catch {
		return trimmed.replace(/\.+$/, "").replace(/\/$/, "");
	}
}

function fallbackWsEndpoint() {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	const host = window.location.hostname || "localhost";
	const currentPort = window.location.port;
	const isVitePort = currentPort === "5173" || currentPort === "4173";
	const port = isVitePort ? currentPort : DEFAULT_SERVER_PORT;
	const path = isVitePort ? "/colyseus" : "";
	return sanitizeEndpoint(`${protocol}//${host}:${port}${path}`);
}

export function resolveServerEndpoint(search: string = window.location.search) {
	const params = new URLSearchParams(search);
	const fromQuery = sanitizeEndpoint(params.get("endpoint") || "");
	if (fromQuery) return fromQuery;

	const fromEnv = sanitizeEndpoint(import.meta.env.VITE_SERVER_URL || "");
	if (fromEnv) return fromEnv;

	return fallbackWsEndpoint();
}

export function resolveHttpBase(endpoint: string) {
	try {
		const parsed = new URL(sanitizeEndpoint(endpoint));
		const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
		return `${parsed.protocol === "wss:" ? "https:" : "http:"}//${parsed.host}${path}`;
	} catch {
		const fallbackEndpoint = fallbackWsEndpoint();
		const parsed = new URL(fallbackEndpoint);
		const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
		return `${parsed.protocol === "wss:" ? "https:" : "http:"}//${parsed.host}${path}`;
	}
}
