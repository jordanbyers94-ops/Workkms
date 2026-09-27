import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { API_URL } from "../config";

export type Profile = { id: string; full_name: string; staff_code: string; role: "tech" | "admin"; active: boolean };
export type Vehicle = { id: string; name: string; rego: string | null };

const TOKEN_KEY = "workkms.token";
const PROFILE_KEY = "profile:v1";

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export const isOffline = (e: unknown) => e instanceof ApiError && e.status === 0;

const listeners = new Set<() => void>();
/** Called when the server says the session is no longer valid (expired, PIN reset, deactivated). */
export const onSignedOut = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

export const getToken = () => SecureStore.getItemAsync(TOKEN_KEY);

export async function getCachedProfile(): Promise<Profile | null> {
  try { const raw = await AsyncStorage.getItem(PROFILE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await getToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method: init.method ?? "GET",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError("No signal. Trips are saved on your phone and will upload when you're back online.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/auth/login") {
    // Keep the trips on the phone; just ask them to sign in again.
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    listeners.forEach((fn) => fn());
  }
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Server error (${res.status}).`, res.status);
  return data as T;
}

export async function signIn(staffCode: string, secret: string): Promise<Profile> {
  const { token, profile } = await api<{ token: string; profile: Profile }>("/auth/login", {
    method: "POST",
    body: { staff_code: staffCode.trim().toLowerCase(), secret },
  });
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  return profile;
}

export async function refreshProfile(): Promise<Profile | null> {
  try {
    const { profile } = await api<{ profile: Profile }>("/me");
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    return profile;
  } catch {
    return null;
  }
}

export async function signOutLocal() {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await AsyncStorage.removeItem(PROFILE_KEY);
}
