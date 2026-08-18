export type AppNotification = {
  id: string;
  message: string;
  createdAt: string;
  walletId?: string;
};

const STORAGE_KEY = "custody-wallet-notifications";
const MAX_ITEMS = 30;

export function getStoredNotifications(): AppNotification[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addStoredNotification(notification: AppNotification): AppNotification[] {
  const next = [notification, ...getStoredNotifications()].slice(0, MAX_ITEMS);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 저장 실패는 무시 (프라이빗 모드 등)
  }
  return next;
}

export function clearStoredNotifications(): AppNotification[] {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 저장 실패는 무시
  }
  return [];
}

export type NotificationCategory =
  | "WITHDRAW_COMPLETED"
  | "WITHDRAW_FAILED"
  | "QUEUE_FAILED";

export type NotificationCategoryPrefs = Record<NotificationCategory, boolean>;

const CATEGORY_STORAGE_KEY = "custody-wallet-notification-categories";

const DEFAULT_CATEGORY_PREFS: NotificationCategoryPrefs = {
  WITHDRAW_COMPLETED: true,
  WITHDRAW_FAILED: true,
  QUEUE_FAILED: true,
};

export function getNotificationCategoryPrefs(): NotificationCategoryPrefs {
  if (typeof window === "undefined") return DEFAULT_CATEGORY_PREFS;
  try {
    const raw = window.localStorage.getItem(CATEGORY_STORAGE_KEY);
    if (!raw) return DEFAULT_CATEGORY_PREFS;
    return { ...DEFAULT_CATEGORY_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CATEGORY_PREFS;
  }
}

export function setNotificationCategoryPrefs(prefs: NotificationCategoryPrefs) {
  try {
    window.localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // 저장 실패는 무시
  }
}

export function statusToCategory(
  status: string,
): NotificationCategory | null {
  switch (status) {
    case "EXECUTED":
    case "BROADCASTED":
      return "WITHDRAW_COMPLETED";
    case "FAILED":
    case "REJECTED":
      return "WITHDRAW_FAILED";
    case "DEAD":
      return "QUEUE_FAILED";
    default:
      return null;
  }
}
