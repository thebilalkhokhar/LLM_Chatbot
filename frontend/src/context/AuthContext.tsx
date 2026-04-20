"use client";

/**
 * AuthContext — single source of truth for the currently signed-in
 * user on the client.
 *
 * Responsibilities:
 *   - Bootstrap on mount: call `POST /auth/refresh` to see if the
 *     browser already has a valid refresh cookie. If yes → hydrate
 *     access token + user via `GET /auth/me`.
 *   - Expose `login`, `signup`, `logout` actions that drive the
 *     Node gateway and update the shared access token in the axios
 *     client (`setAccessToken`).
 *   - Expose `status` so consumers can render loading / logged-in /
 *     logged-out states explicitly.
 *
 * We deliberately keep the access token ONLY in memory (axios + this
 * context) — never in `localStorage` — so an XSS leak can't easily
 * exfiltrate it. The refresh cookie is HttpOnly on the server side.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  apiClient,
  getJson,
  postJson,
  setAccessToken,
  subscribeAccessToken,
} from "@/lib/api-client";
import type { AuthResponse, User } from "@/types";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface LoginInput {
  email: string;
  password: string;
}

export interface SignupInput {
  email: string;
  username: string;
  password: string;
}

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  accessToken: string | null;
  login: (input: LoginInput) => Promise<User>;
  signup: (input: SignupInput) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  // Keep local state mirrored with the axios token bus.
  useEffect(() => subscribeAccessToken(setToken), []);

  const bootstrap = useCallback(async () => {
    try {
      // If a refresh cookie is present we'll get a new access token.
      const { accessToken } = await postJson<{ accessToken: string }>(
        "/auth/refresh"
      );
      setAccessToken(accessToken);

      const me = await getJson<{ status: string; user: User }>("/auth/me");
      setUser(me.user);
      setStatus("authenticated");
    } catch {
      setAccessToken(null);
      setUser(null);
      setStatus("unauthenticated");
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const login = useCallback(async (input: LoginInput): Promise<User> => {
    const data = await postJson<AuthResponse>("/auth/login", input);
    setAccessToken(data.accessToken);
    setUser(data.user);
    setStatus("authenticated");
    return data.user;
  }, []);

  const signup = useCallback(async (input: SignupInput): Promise<User> => {
    const data = await postJson<AuthResponse>("/auth/signup", input);
    setAccessToken(data.accessToken);
    setUser(data.user);
    setStatus("authenticated");
    return data.user;
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await apiClient.post("/auth/logout");
    } catch {
      // Best-effort — even if the server call fails we clear local state.
    }
    setAccessToken(null);
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const { accessToken } = await postJson<{ accessToken: string }>(
        "/auth/refresh"
      );
      setAccessToken(accessToken);
      return true;
    } catch {
      setAccessToken(null);
      setUser(null);
      setStatus("unauthenticated");
      return false;
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      accessToken: token,
      login,
      signup,
      logout,
      refresh,
    }),
    [status, user, token, login, signup, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider />");
  }
  return ctx;
}
