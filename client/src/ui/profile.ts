const DISPLAY_NAME_KEY = "mytragor.displayName";

export function getDisplayName(): string {
	try {
		return localStorage.getItem(DISPLAY_NAME_KEY) || "";
	} catch {
		return "";
	}
}

export function setDisplayName(name: string): void {
	const value = String(name || "").trim();
	try {
		localStorage.setItem(DISPLAY_NAME_KEY, value);
	} catch {
		// no-op
	}
}

export function clearDisplayName(): void {
	try {
		localStorage.removeItem(DISPLAY_NAME_KEY);
	} catch {
		// no-op
	}
}
