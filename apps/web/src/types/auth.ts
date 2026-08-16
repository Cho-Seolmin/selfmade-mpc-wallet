export type UserRole = "USER" | "ADMIN";
export type UserStatus = "PENDING" | "ACTIVE";

export type Me = {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  walletAddress?: string | null;
  createdAt?: string;
};

export type LoginResponse = {
  ok: true;
};

export type TotpSetupStatus = {
  configured: boolean;
  alreadyRevealed: boolean;
};

export type TotpSetup = {
  secret: string;
  otpauthUrl: string;
  hint: string;
  created?: boolean;
  configured?: boolean;
  alreadyRevealed?: boolean;
};
