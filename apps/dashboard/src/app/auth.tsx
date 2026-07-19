import React, { createContext, useContext, useMemo, useState } from "react";
import { sessionAuthStore } from "../platform/storage/session-auth-store.ts";

interface AuthContextValue {
  apiKey: string;
  isAuthenticated: boolean;
  login: (apiKey: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [apiKey, setApiKey] = useState(() => sessionAuthStore.read());
  const value = useMemo<AuthContextValue>(
    () => ({
      apiKey,
      isAuthenticated: Boolean(apiKey),
      login: (nextApiKey: string) => {
        const trimmed = nextApiKey.trim();
        if (!trimmed) return;
        sessionAuthStore.write(trimmed);
        setApiKey(trimmed);
      },
      logout: () => {
        sessionAuthStore.clear();
        setApiKey("");
      },
    }),
    [apiKey],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
