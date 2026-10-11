import Storage from "expo-sqlite/kv-store";

// Local SQLite key-value store: passes survive restarts and open with no signal at a basement gate.
export const kv = {
  get: (k: string) => Storage.getItem(k),
  set: (k: string, v: string) => Storage.setItem(k, v),
  del: (k: string) => Storage.removeItem(k)
};
