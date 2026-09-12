type MatchMode = "pvp" | "solo";

type VercelAnalytics = (event: "event", options: {
	name: string;
	data: { modo: MatchMode };
}) => void;

export function trackMatchStarted(mode: MatchMode) {
	const analytics = (window as Window & { va?: VercelAnalytics }).va;
	analytics?.("event", { name: "Partida iniciada", data: { modo: mode } });
}