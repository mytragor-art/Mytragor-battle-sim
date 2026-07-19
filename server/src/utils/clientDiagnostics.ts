export type ClientDiagnostic = {
	roomId: string;
	sessionId: string;
	runId: string;
	event: string;
	receivedAt: number;
	clientTimestamp: number;
	visibility: string;
	online: boolean;
	domNodes: number;
	heapMb: number | null;
	frameGapMs: number;
	closeCode: number | null;
	detail: string;
};

const diagnostics = new Map<string, ClientDiagnostic>();
const MAX_AGE_MS = 10 * 60_000;

function key(roomId: string, sessionId: string): string {
	return `${roomId}:${sessionId}`;
}

export function recordClientDiagnostic(input: Partial<ClientDiagnostic>): ClientDiagnostic | null {
	const roomId = String(input.roomId || "").trim().slice(0, 80);
	const sessionId = String(input.sessionId || "").trim().slice(0, 80);
	if (!roomId || !sessionId) return null;
	const diagnostic: ClientDiagnostic = {
		roomId,
		sessionId,
		runId: String(input.runId || "").trim().slice(0, 80),
		event: String(input.event || "heartbeat").trim().slice(0, 40),
		receivedAt: Date.now(),
		clientTimestamp: Number(input.clientTimestamp || 0),
		visibility: String(input.visibility || "unknown").trim().slice(0, 20),
		online: input.online !== false,
		domNodes: Math.max(0, Number(input.domNodes || 0)),
		heapMb: input.heapMb != null && Number.isFinite(Number(input.heapMb)) ? Math.max(0, Number(input.heapMb)) : null,
		frameGapMs: Math.max(0, Number(input.frameGapMs || 0)),
		closeCode: input.closeCode != null && Number.isFinite(Number(input.closeCode)) ? Number(input.closeCode) : null,
		detail: String(input.detail || "").replace(/[\r\n]+/g, " ").trim().slice(0, 300)
	};
	diagnostics.set(key(roomId, sessionId), diagnostic);
	for (const [entryKey, entry] of diagnostics) {
		if (diagnostic.receivedAt - entry.receivedAt > MAX_AGE_MS) diagnostics.delete(entryKey);
	}
	return diagnostic;
}

export function describeClientDiagnostic(roomId: string, sessionId: string): string {
	const diagnostic = diagnostics.get(key(roomId, sessionId));
	if (!diagnostic) return "diag=none";
	const ageMs = Math.max(0, Date.now() - diagnostic.receivedAt);
	return [
		`diagEvent=${diagnostic.event}`,
		`diagAgeMs=${ageMs}`,
		`visibility=${diagnostic.visibility}`,
		`online=${diagnostic.online}`,
		`dom=${diagnostic.domNodes}`,
		`heapMb=${diagnostic.heapMb ?? "n/a"}`,
		`frameGapMs=${diagnostic.frameGapMs}`,
		`closeCode=${diagnostic.closeCode ?? "n/a"}`,
		`detail=${JSON.stringify(diagnostic.detail || "-")}`,
		`run=${diagnostic.runId || "-"}`
	].join(" ");
}