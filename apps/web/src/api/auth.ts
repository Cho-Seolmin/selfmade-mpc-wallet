import { api } from "./axios";
import type { LoginResponse, Me, TotpSetup, TotpSetupStatus } from "../types/auth";

export async function login(email: string, password: string): Promise<LoginResponse> {
  const res = await api.post<LoginResponse>("/auth/login", { email, password });
  return res.data;
}

export async function logout(): Promise<void> {
  await api.post("/auth/logout");
}

export async function getMe(): Promise<Me> {
  const res = await api.get<Me>("/auth/me");
  return res.data;
}

export async function getTotpStatus(): Promise<TotpSetupStatus> {
  const res = await api.get<TotpSetupStatus>("/auth/totp-status");
  return res.data;
}

/** One-time reveal — second call returns 410. Mutates totpSecretRevealedAt. */
export async function revealTotpSetup(): Promise<TotpSetup> {
  const res = await api.post<TotpSetup>("/auth/totp-setup");
  return res.data;
}

export async function register(email: string, password: string) {
  const res = await api.post("/auth/register", { email, password });
  return res.data;
}

export async function changePassword(currentPassword: string, newPassword: string) {
  const res = await api.patch("/auth/password", { currentPassword, newPassword });
  return res.data;
}
