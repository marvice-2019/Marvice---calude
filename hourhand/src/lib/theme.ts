/** Light, dark, or follow the device. Stored per browser; "system" stores nothing so the OS setting rules. */
export type ThemeChoice = "light" | "dark" | "system";

export const THEME_KEY = "hourhand.theme";

export function parseTheme(value: unknown): ThemeChoice {
  return value === "light" || value === "dark" ? value : "system";
}

/**
 * Runs in <head> before the first paint, so a saved choice never flashes the other theme. Kept tiny and
 * dependency-free; storage can throw (blocked cookies), in which case the OS setting applies.
 */
export const THEME_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
