const DISPLAY_NAME_KEY = "mytragor.displayName";
const AVATAR_KEY = "mytragor.avatar";
export function getDisplayName() {
    try {
        return localStorage.getItem(DISPLAY_NAME_KEY) || "";
    }
    catch {
        return "";
    }
}
export function setDisplayName(name) {
    const value = String(name || "").trim();
    try {
        localStorage.setItem(DISPLAY_NAME_KEY, value);
    }
    catch {
        // no-op
    }
}
export function clearDisplayName() {
    try {
        localStorage.removeItem(DISPLAY_NAME_KEY);
    }
    catch {
        // no-op
    }
}
export function getAvatarId() {
    try {
        return localStorage.getItem(AVATAR_KEY) || "";
    }
    catch {
        return "";
    }
}
