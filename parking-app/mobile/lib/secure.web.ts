// Web build is a preview/smoke target only. The browser has no keystore, so this uses sessionStorage
// (cleared when the tab closes). The production web product is parking-app/web with httpOnly cookies.
const s = () => (typeof sessionStorage === "undefined" ? null : sessionStorage);
export const secure = {
  get: async (k: string) => s()?.getItem(k) ?? null,
  set: async (k: string, v: string) => { s()?.setItem(k, v); },
  del: async (k: string) => { s()?.removeItem(k); }
};
