import * as SecureStore from "expo-secure-store";

// Session tokens live in the Keychain / Android Keystore, never in plain storage.
export const secure = {
  get: (k: string) => SecureStore.getItemAsync(k),
  set: (k: string, v: string) => SecureStore.setItemAsync(k, v),
  del: (k: string) => SecureStore.deleteItemAsync(k)
};
