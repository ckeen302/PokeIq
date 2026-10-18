"use client";

import { useSyncExternalStore } from "react";
import { getProgress, onProgressChange, replaceProgress, resetProgress, type Progress } from "./progress";
import { mergeProgress, normalizeProgress } from "./progress-merge";

/**
 * Client side of trainer accounts. Progress stays local-first (play without
 * signing up); once signed in, the device's progress is merged with the
 * account's copy and every change is pushed back, so it follows the trainer
 * across devices.
 */

export interface AccountUser {
  id: string;
  username: string;
  createdAt: string;
}

export interface AccountState {
  status: "loading" | "ready";
  enabled: boolean;
  user: AccountUser | null;
}

let state: AccountState = { status: "loading", enabled: true, user: null };
const listeners = new Set<() => void>();
let started = false;
let stopSync: (() => void) | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

function set(next: Partial<AccountState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function useAccount(): AccountState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state
  );
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

async function pushProgress(progress: Progress): Promise<void> {
  await api("/api/progress", { method: "PUT", body: JSON.stringify({ progress }), keepalive: true });
}

function schedulePush(progress: Progress) {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushProgress(progress).catch(() => undefined);
  }, 1500);
}

/** Merges this device's progress with the account copy, then keeps the account up to date. */
async function startSync(user: AccountUser, remoteRaw: unknown) {
  stopSync?.();
  const local = getProgress();
  const remote = normalizeProgress(remoteRaw);
  const merged = remote ? mergeProgress(local, remote) : local;
  if (!merged.name) merged.name = user.username;
  replaceProgress(merged);
  await pushProgress(merged).catch(() => undefined);
  stopSync = onProgressChange(schedulePush);
}

/** Loads the signed-in trainer once per page load (called from the root layout). */
export async function initAccount(): Promise<void> {
  if (started) return;
  started = true;
  try {
    const me = await api<{ enabled: boolean; user: AccountUser | null; progress: unknown }>("/api/auth/me");
    set({ status: "ready", enabled: me.enabled, user: me.user });
    if (me.user) await startSync(me.user, me.progress);
  } catch {
    set({ status: "ready", user: null });
  }
}

async function signedIn(user: AccountUser) {
  set({ user });
  const me = await api<{ progress: unknown }>("/api/auth/me").catch(() => ({ progress: null }));
  await startSync(user, me.progress);
}

export async function register(username: string, password: string): Promise<string> {
  const res = await api<{ user: AccountUser; recoveryCode: string }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  await signedIn(res.user);
  return res.recoveryCode;
}

export async function signIn(username: string, password: string): Promise<void> {
  const res = await api<{ user: AccountUser }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  await signedIn(res.user);
}

export async function recoverAccount(username: string, recoveryCode: string, newPassword: string): Promise<string> {
  const res = await api<{ user: AccountUser; recoveryCode: string }>("/api/auth/recover", {
    method: "POST",
    body: JSON.stringify({ username, recoveryCode, newPassword }),
  });
  await signedIn(res.user);
  return res.recoveryCode;
}

export async function newRecoveryCode(password: string): Promise<string> {
  const res = await api<{ recoveryCode: string }>("/api/auth/recovery-code", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  return res.recoveryCode;
}

/** Saves any pending changes, ends the session and clears this device's copy. */
export async function signOut(): Promise<void> {
  stopSync?.();
  stopSync = null;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
    await pushProgress(getProgress()).catch(() => undefined);
  }
  await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  resetProgress();
  set({ user: null });
}

