// expo-sqlite on web needs COOP/COEP headers; the web preview uses localStorage instead.
const ls = () => (typeof localStorage === "undefined" ? null : localStorage);
export const kv = {
  get: async (k: string) => ls()?.getItem(k) ?? null,
  set: async (k: string, v: string) => { ls()?.setItem(k, v); },
  del: async (k: string) => { ls()?.removeItem(k); }
};
