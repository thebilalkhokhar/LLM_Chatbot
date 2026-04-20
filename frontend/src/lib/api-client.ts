/**
 * Axios client for the Node.js gateway.
 *
 * Features
 * --------
 *   - `withCredentials: true` so the browser sends the `refreshToken`
 *     HttpOnly cookie on every call.
 *   - Injects `Authorization: Bearer <accessToken>` automatically if
 *     a token has been registered via `setAccessToken`.
 *   - 401 interceptor: on a failed request, calls `POST /auth/refresh`
 *     exactly once, updates the in-memory access token, and retries
 *     the original request. Concurrent 401s share a single refresh.
 *
 * The access token lives in-memory only — no localStorage — so an
 * XSS leak can't trivially grab it. The refresh token is HttpOnly.
 */

import axios, {
  AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from "axios";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api";

type TokenListener = (token: string | null) => void;

let accessToken: string | null = null;
const tokenListeners = new Set<TokenListener>();

/** In-flight refresh shared across concurrent 401s. */
let refreshPromise: Promise<string | null> | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  tokenListeners.forEach((fn) => fn(token));
}

export function subscribeAccessToken(fn: TokenListener): () => void {
  tokenListeners.add(fn);
  return () => {
    tokenListeners.delete(fn);
  };
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

// ------------------------------------------------------------------ //
// Request interceptor: attach Bearer token if we have one.
// ------------------------------------------------------------------ //
apiClient.interceptors.request.use((config) => {
  if (accessToken && config.headers) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// ------------------------------------------------------------------ //
// Response interceptor: on 401, refresh once and retry.
// ------------------------------------------------------------------ //
interface RetriableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

function isAuthEndpoint(url?: string): boolean {
  if (!url) return false;
  return (
    url.includes("/auth/login") ||
    url.includes("/auth/signup") ||
    url.includes("/auth/refresh") ||
    url.includes("/auth/logout")
  );
}

async function runRefresh(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const { data } = await axios.post<{ accessToken: string }>(
        `${API_BASE_URL}/auth/refresh`,
        {},
        { withCredentials: true }
      );
      const next = data?.accessToken ?? null;
      setAccessToken(next);
      return next;
    } catch {
      setAccessToken(null);
      return null;
    } finally {
      // Clear even on success so a future 401 can refresh again.
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Public refresh helper. Shares the same single-flight promise used
 * by the axios interceptor, so fetch-based streaming callers don't
 * race with concurrent axios calls.
 */
export async function refreshAccessToken(): Promise<string | null> {
  return runRefresh();
}

/** Full URL for a given relative API path. */
export function apiUrl(path: string): string {
  const base = API_BASE_URL.endsWith("/")
    ? API_BASE_URL.slice(0, -1)
    : API_BASE_URL;
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${base}${clean}`;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    const status = error.response?.status;

    if (!original || status !== 401 || original._retried || isAuthEndpoint(original.url)) {
      return Promise.reject(error);
    }

    original._retried = true;
    const fresh = await runRefresh();

    if (!fresh) {
      return Promise.reject(error);
    }

    original.headers = original.headers ?? {};
    (original.headers as Record<string, string>).Authorization = `Bearer ${fresh}`;
    return apiClient.request(original);
  }
);

/**
 * Typed helper for POSTs that return JSON. Wraps `apiClient.post` so
 * callers don't need to destructure `.data` themselves.
 */
export async function postJson<T, B = unknown>(
  url: string,
  body?: B,
  config?: AxiosRequestConfig
): Promise<T> {
  const { data } = await apiClient.post<T>(url, body, config);
  return data;
}

export async function getJson<T>(
  url: string,
  config?: AxiosRequestConfig
): Promise<T> {
  const { data } = await apiClient.get<T>(url, config);
  return data;
}
