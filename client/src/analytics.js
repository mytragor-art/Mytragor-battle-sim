export function trackMatchStarted(mode) {
    const analytics = window.va;
    analytics?.("event", { name: "Partida iniciada", data: { modo: mode } });
}
