const API_KEY_STORAGE = "trendpublish.dashboard.apiKey";
let memoryApiKey = "";

export interface AuthStore {
  read(): string;
  write(apiKey: string): void;
  clear(): void;
}

export const sessionAuthStore: AuthStore = {
  read() {
    if (typeof sessionStorage === "undefined") return memoryApiKey;
    return sessionStorage.getItem(API_KEY_STORAGE) ?? memoryApiKey;
  },
  write(apiKey: string) {
    memoryApiKey = apiKey;
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(API_KEY_STORAGE, apiKey);
  },
  clear() {
    memoryApiKey = "";
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.removeItem(API_KEY_STORAGE);
  },
};
