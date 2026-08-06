import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getMe, logout } from "../api/auth";
import { getPreferences } from "../api/settings";
import { getSystemStatus } from "../api/system";
import type { Me } from "../types/auth";
import { applyTheme, getStoredTheme } from "../lib/theme";
import {
  clearStoredNotifications,
  getStoredNotifications,
  type AppNotification,
} from "../lib/notifications";
import "./AppShell.css";

type NavKey = "dashboard" | "settings";

type NavItem = {
  key: NavKey;
  label: string;
  path: string;
  icon: ReactNode;
};

function DashboardIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M4 12h1.5M18.5 12H20M12 4v1.5M12 18.5V20M6.3 6.3l1.1 1.1M16.6 16.6l1.1 1.1M17.7 6.3l-1.1 1.1M7.4 16.6l-1.1 1.1" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M20.7 15.2A8.6 8.6 0 019.3 3.8a1 1 0 00-1.2-1.3A10 10 0 1021.9 16a1 1 0 00-1.2-.8z" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", label: "Dashboard", path: "/dashboard", icon: <DashboardIcon /> },
  { key: "settings", label: "Settings", path: "/settings", icon: <SettingsIcon /> },
];

type AppShellProps = {
  children: ReactNode;
};

export default function AppShell({ children }: AppShellProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const [me, setMe] = useState<Me | null>(null);
  const [theme, setTheme] = useState(() => getStoredTheme());

  const [notifications, setNotifications] = useState<AppNotification[]>(() =>
    getStoredNotifications(),
  );
  const [notifOpen, setNotifOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [systemHealthy, setSystemHealthy] = useState<boolean | null>(null);
  const inAppEnabledRef = useRef(true);
  const notifWrapRef = useRef<HTMLDivElement>(null);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  };

  const activeKey: NavKey = location.pathname.startsWith("/settings")
    ? "settings"
    : "dashboard";

  useEffect(() => {
    let cancelled = false;

    getMe()
      .then((data) => {
        if (!cancelled) setMe(data);
      })
      .catch(() => {
        // 사이드바 계정 정보 조회 실패는 조용히 무시
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    getSystemStatus()
      .then((status) => {
        if (cancelled) return;

        const healthy =
          status.backendOnline &&
          status.dbConnected &&
          status.sepoliaRpcConnected;

        setSystemHealthy(healthy);
      })
      .catch(() => {
        if (!cancelled) setSystemHealthy(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    getPreferences()
      .then((data) => {
        if (!cancelled) inAppEnabledRef.current = data.inAppNotifications !== false;
      })
      .catch(() => {
        // 알림 설정 조회 실패 시 기본값(사용) 유지
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!notifOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (notifWrapRef.current && !notifWrapRef.current.contains(event.target as Node)) {
        setNotifOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNotifOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [notifOpen]);

  const handleToggleNotifications = () => {
    setNotifOpen((prev) => {
      const next = !prev;
      if (next) setUnreadCount(0);
      return next;
    });
  };

  const handleClearNotifications = () => {
    setNotifications(clearStoredNotifications());
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // Proceed to login even if the server-side cookie clear fails.
    }
    navigate("/login");
  };

  return (
    <div className="app-shell">
      <aside className="app-shell__sidebar">
        <div className="app-shell__brand">
          <span className="app-shell__brand-mark">CS</span>
          <span className="app-shell__brand-text">
            <span className="app-shell__brand-name">Custody Vault</span>
            <span className="app-shell__brand-sub">MPC Wallet</span>
          </span>
          <div className="app-shell__brand-actions">
            <div className="app-shell__notif-wrap" ref={notifWrapRef}>
              <button
                type="button"
                className="app-shell__theme-toggle"
                onClick={handleToggleNotifications}
                aria-label="알림"
                title="알림"
              >
                <BellIcon />
                {unreadCount > 0 && (
                  <span className="app-shell__notif-dot">{unreadCount > 9 ? "9+" : unreadCount}</span>
                )}
              </button>

              {notifOpen && (
                <div className="app-shell__notif-panel">
                  <div className="app-shell__notif-panel-header">
                    <span>알림</span>
                    {notifications.length > 0 && (
                      <button
                        type="button"
                        className="app-shell__notif-clear"
                        onClick={handleClearNotifications}
                      >
                        모두 지우기
                      </button>
                    )}
                  </div>

                  {notifications.length === 0 ? (
                    <div className="app-shell__notif-empty">알림이 없습니다.</div>
                  ) : (
                    <div className="app-shell__notif-list">
                      {notifications.map((notification) => (
                        <div key={notification.id} className="app-shell__notif-item">
                          <div className="app-shell__notif-message">{notification.message}</div>
                          <div className="app-shell__notif-time">
                            {new Date(notification.createdAt).toLocaleString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              className="app-shell__theme-toggle"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
              title={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
            >
              {theme === "dark" ? <MoonIcon /> : <SunIcon />}
            </button>
          </div>
        </div>

        <nav className="app-shell__nav">
          {NAV_ITEMS.map((item) => (
            <div key={item.key}>
              <button
                type="button"
                className={`app-shell__nav-item${
                  item.key === activeKey ? " is-active" : ""
                }`}
                onClick={() => navigate(item.path)}
                aria-current={item.key === activeKey ? "page" : undefined}
              >
                <span className="app-shell__nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            </div>
          ))}
        </nav>

        <div className="app-shell__sidebar-footer">
          <span
            className={`app-shell__status-dot${
              systemHealthy === false ? " is-degraded" : ""
            }`}
          />
          <div>
            <div className="app-shell__footer-title">
              {systemHealthy === false ? "System Degraded" : "System Normal"}
            </div>
            <div className="app-shell__footer-sub">Sepolia Testnet</div>
          </div>
        </div>

        <div className="app-shell__account">
          <span className="app-shell__account-avatar">
            {me?.email ? me.email.charAt(0).toUpperCase() : "?"}
          </span>
          <div className="app-shell__account-text">
            <div className="app-shell__account-email" title={me?.email}>
              {me?.email ?? "불러오는 중..."}
            </div>
            {me?.role && (
              <div className="app-shell__account-role">{me.role}</div>
            )}
          </div>
        </div>

        <button
          type="button"
          className="app-shell__logout-btn"
          onClick={handleLogout}
        >
          <LogoutIcon />
          로그아웃
        </button>
      </aside>

      <div className="app-shell__body">{children}</div>
    </div>
  );
}
