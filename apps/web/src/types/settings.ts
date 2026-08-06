export type BalanceUnit = "ETH" | "WEI";

export type UserPreference = {
  id: string;
  userId: string;
  defaultWalletId: string | null;
  balanceUnit: BalanceUnit;
  autoRefreshEnabled: boolean;
  inAppNotifications: boolean;
  emailNotifications: boolean;
  updatedAt: string;
};

export type UpdatePreferencesPayload = {
  defaultWalletId?: string | null;
  balanceUnit?: BalanceUnit;
  autoRefreshEnabled?: boolean;
  inAppNotifications?: boolean;
  emailNotifications?: boolean;
};

export type SystemStatus = {
  apiStatus: string;
  backendOnline: boolean;
  dbConnected: boolean;
  websocketConnected: boolean;
  sepoliaRpcConnected: boolean;
  otpConfigured: boolean;
  network: string;
  serverTime: string;
};
