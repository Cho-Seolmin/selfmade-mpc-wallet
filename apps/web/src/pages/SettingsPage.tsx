import { useEffect, useState } from "react";
import { getMe, changePassword, getTotpSetup } from "../api/auth";
import { getPreferences, updatePreferences } from "../api/settings";
import { getSystemStatus } from "../api/system";
import type { Me, TotpSetup } from "../types/auth";
import type { BalanceUnit, SystemStatus, UserPreference } from "../types/settings";
import {
  getNotificationCategoryPrefs,
  setNotificationCategoryPrefs,
  type NotificationCategory,
  type NotificationCategoryPrefs,
} from "../lib/notifications";
import { applyTheme, getStoredTheme, type Theme } from "../lib/theme";
import "../styles/page.css";

const NOTIFICATION_CATEGORY_ITEMS: { key: NotificationCategory; label: string }[] = [
  { key: "WITHDRAW_COMPLETED", label: "Withdraw Completed" },
  { key: "WITHDRAW_FAILED", label: "Withdraw Failed" },
  { key: "QUEUE_FAILED", label: "Queue Failed" },
];

function getStatusTone(status: string) {
  switch (status) {
    case "ACTIVE":
      return "success";
    case "SUSPENDED":
      return "danger";
    default:
      return "gray";
  }
}

const TABS = [
  { key: "security", label: "Security" },
  { key: "account", label: "Account" },
  { key: "wallet", label: "Wallet Preferences" },
  { key: "environment", label: "API & Environment" },
  { key: "notifications", label: "Notifications" },
  { key: "about", label: "About" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch-track" />
    </label>
  );
}

function EnvRow({ label, connected }: { label: string; connected: boolean }) {
  return (
    <div className="settings-row">
      <div className="settings-row__text">
        <div className="settings-row__label">{label}</div>
      </div>
      <span
        style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 600 }}
      >
        <span className={`status-dot${connected ? "" : " status-dot--danger"}`} />
        {connected ? "Connected" : "Disconnected"}
      </span>
    </div>
  );
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("security");
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [preferences, setPreferences] = useState<UserPreference | null>(null);
  const [prefMessage, setPrefMessage] = useState("");
  const [prefSaving, setPrefSaving] = useState(false);

  const [status, setStatus] = useState<SystemStatus | null>(null);

  const [categoryPrefs, setCategoryPrefs] = useState<NotificationCategoryPrefs>(() =>
    getNotificationCategoryPrefs(),
  );

  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwMessage, setPwMessage] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSubmitting, setPwSubmitting] = useState(false);
  const [totpSetup, setTotpSetup] = useState<TotpSetup | null>(null);
  const [totpError, setTotpError] = useState("");

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [meData, prefData, statusData] = await Promise.all([
          getMe(),
          getPreferences(),
          getSystemStatus(),
        ]);
        setMe(meData);
        setPreferences(prefData);
        setStatus(statusData);

        try {
          const totp = await getTotpSetup();
          setTotpSetup(totp);
        } catch {
          setTotpError("OTP 설정 정보를 불러오지 못했습니다.");
        }
      } catch (err: any) {
        setError(err?.response?.data?.message || "설정 정보 조회 실패");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const savePreferences = async (patch: Partial<UserPreference>) => {
    if (!preferences) return;

    const optimistic = { ...preferences, ...patch };
    setPreferences(optimistic);
    setPrefSaving(true);
    setPrefMessage("");

    try {
      const updated = await updatePreferences({
        defaultWalletId: optimistic.defaultWalletId,
        balanceUnit: optimistic.balanceUnit,
        autoRefreshEnabled: optimistic.autoRefreshEnabled,
        inAppNotifications: optimistic.inAppNotifications,
        emailNotifications: optimistic.emailNotifications,
      });
      setPreferences(updated);
      setPrefMessage("저장되었습니다.");
    } catch (err: any) {
      setPrefMessage(err?.response?.data?.message || "저장 실패");
    } finally {
      setPrefSaving(false);
    }
  };

  const toggleCategory = (key: NotificationCategory) => {
    const next = { ...categoryPrefs, [key]: !categoryPrefs[key] };
    setCategoryPrefs(next);
    setNotificationCategoryPrefs(next);
  };

  const handleToggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  };

  const handleChangePassword = async () => {
    setPwMessage("");
    setPwError("");

    if (newPassword.length < 4) {
      setPwError("새 비밀번호는 4자 이상이어야 합니다.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError("새 비밀번호가 일치하지 않습니다.");
      return;
    }
    if (newPassword === currentPassword) {
      setPwError("새 비밀번호는 현재 비밀번호와 달라야 합니다.");
      return;
    }

    setPwSubmitting(true);
    try {
      const data = await changePassword(currentPassword, newPassword);
      setPwMessage(data.message || "비밀번호가 변경되었습니다.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setPwError(err?.response?.data?.message || "비밀번호 변경 실패");
    } finally {
      setPwSubmitting(false);
    }
  };

  if (loading) {
    return <div className="loading-screen">불러오는 중...</div>;
  }

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1 className="page__title">Settings</h1>
          <p className="page__subtitle">계정, 보안, 지갑 환경설정을 관리하세요.</p>
        </div>
      </header>

      <div className="tab-group settings-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`tab${activeTab === tab.key ? " is-active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && <div className="alert alert--danger">{error}</div>}

      {activeTab === "security" && (
        <>
          <div className="card section-card">
            <div className="section-header">
              <h2>Security Settings</h2>
            </div>

            <div className="settings-row">
              <div className="settings-row__text">
                <div className="settings-row__label">OTP Authentication</div>
                <div className="settings-row__desc">
                  Recovery File 분실 시 비상 복구(마지막 출금)에 사용합니다.
                </div>
              </div>
              <span className={`badge badge--${status?.otpConfigured ? "success" : "gray"}`}>
                {status?.otpConfigured ? "Enabled" : "미설정"}
              </span>
            </div>

            <div className="settings-row">
              <div className="settings-row__text">
                <div className="settings-row__label">Email Verification</div>
                <div className="settings-row__desc">계정 이메일 인증 상태입니다.</div>
              </div>
              <span className={`badge badge--${me?.status === "ACTIVE" ? "success" : "warning"}`}>
                {me?.status === "ACTIVE" ? "Verified" : "Pending"}
              </span>
            </div>
          </div>

          <div className="card section-card">
            <div className="section-header">
              <h2>2단계 인증 (2FA)</h2>
              <span className="badge badge--success">계정별 OTP</span>
            </div>
            <p style={{ fontSize: "13px", color: "var(--color-text-muted)", marginBottom: "14px" }}>
              Google Authenticator 등에 아래 secret을 등록하세요.
            </p>
            {totpError && (
              <div className="alert alert--danger" style={{ marginBottom: "14px" }}>
                {totpError}
              </div>
            )}
            {totpSetup && (
              <div className="info-box info-box--neutral" style={{ marginBottom: "14px" }}>
                <div style={{ fontSize: "12px", color: "var(--color-text-muted)", marginBottom: "6px" }}>
                  OTP Secret
                </div>
                <code style={{ wordBreak: "break-all", fontSize: "13px" }}>{totpSetup.secret}</code>
                <div style={{ fontSize: "12px", color: "var(--color-text-muted)", margin: "12px 0 6px" }}>
                  otpauth URL
                </div>
                <code style={{ wordBreak: "break-all", fontSize: "12px" }}>{totpSetup.otpauthUrl}</code>
              </div>
            )}
            <div className="settings-row">
              <div className="settings-row__text">
                <div className="settings-row__label">비상 복구 OTP</div>
                <div className="settings-row__desc">
                  계정마다 JWT에서 파생된 고유 TOTP secret을 사용합니다.
                </div>
              </div>
              <Switch checked={Boolean(totpSetup)} onChange={() => {}} disabled />
            </div>
          </div>
        </>
      )}

      {activeTab === "account" && (
        <>
          <div className="card section-card">
            <div className="section-header">
              <h2>Account</h2>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "20px" }}>
              <span
                style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "999px",
                  background: "var(--color-primary-soft)",
                  color: "var(--color-primary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "18px",
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {me?.email ? me.email.charAt(0).toUpperCase() : "?"}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "15px", fontWeight: 700, overflowWrap: "anywhere" }}>
                  {me?.email ?? "-"}
                </div>
                <div style={{ display: "flex", gap: "6px", marginTop: "6px", flexWrap: "wrap" }}>
                  {me?.role && <span className="badge badge--primary">{me.role}</span>}
                  {me?.status && (
                    <span className={`badge badge--${getStatusTone(me.status)}`}>{me.status}</span>
                  )}
                </div>
              </div>
            </div>

            <hr className="divider" style={{ margin: "0 0 20px" }} />

            <div className="history-row__meta" style={{ fontSize: "13px" }}>
              <div>
                <span className="history-row__meta-label">Email</span>
                {me?.email ?? "-"}
              </div>
              <div>
                <span className="history-row__meta-label">Role</span>
                {me?.role ?? "-"}
              </div>
              <div>
                <span className="history-row__meta-label">Status</span>
                {me?.status ?? "-"}
              </div>
              <div>
                <span className="history-row__meta-label">Created</span>
                {me?.createdAt ? new Date(me.createdAt).toLocaleDateString() : "-"}
              </div>
            </div>
          </div>

          <div className="card section-card">
            <div className="section-header">
              <h2>비밀번호 변경</h2>
            </div>

            <div className="field">
              <label className="input-label" htmlFor="settings-current-password">
                현재 비밀번호
              </label>
              <input
                id="settings-current-password"
                type="password"
                className="input"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="현재 비밀번호"
                autoComplete="current-password"
              />
            </div>

            <div className="field">
              <label className="input-label" htmlFor="settings-new-password">
                새 비밀번호 (8자 이상)
              </label>
              <input
                id="settings-new-password"
                type="password"
                className="input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="새 비밀번호"
                autoComplete="new-password"
              />
            </div>

            <div className="field">
              <label className="input-label" htmlFor="settings-confirm-password">
                새 비밀번호 확인
              </label>
              <input
                id="settings-confirm-password"
                type="password"
                className="input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="새 비밀번호 확인"
                autoComplete="new-password"
              />
            </div>

            <button
              className="btn btn--primary"
              onClick={handleChangePassword}
              disabled={pwSubmitting || !currentPassword || !newPassword}
            >
              {pwSubmitting ? "변경 중..." : "비밀번호 변경"}
            </button>

            {pwMessage && <div className="alert alert--info">{pwMessage}</div>}
            {pwError && <div className="alert alert--danger">{pwError}</div>}
          </div>
        </>
      )}

      {activeTab === "wallet" && preferences && (
        <div className="card section-card">
          <div className="section-header">
            <h2>Wallet Preferences</h2>
          </div>

          <div className="field">
            <label className="input-label" htmlFor="settings-default-network">
              Default Network
            </label>
            <select id="settings-default-network" className="input" value="sepolia" disabled>
              <option value="sepolia">Ethereum Sepolia</option>
            </select>
          </div>

          <div className="settings-row">
            <div className="settings-row__text">
              <div className="settings-row__label">Auto Refresh</div>
              <div className="settings-row__desc">
                잔액/출금 이력을 주기적으로 자동 새로고침합니다.
              </div>
            </div>
            <Switch
              checked={preferences.autoRefreshEnabled}
              onChange={(next) => savePreferences({ autoRefreshEnabled: next })}
            />
          </div>

          <div className="settings-row">
            <div className="settings-row__text">
              <div className="settings-row__label">잔액 표시 단위</div>
            </div>
            <div className="tab-group" style={{ marginBottom: 0 }}>
              {(["ETH", "WEI"] as BalanceUnit[]).map((unit) => (
                <button
                  key={unit}
                  type="button"
                  className={`tab${preferences.balanceUnit === unit ? " is-active" : ""}`}
                  onClick={() => savePreferences({ balanceUnit: unit })}
                >
                  {unit}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row__text">
              <div className="settings-row__label">Theme</div>
            </div>
            <button type="button" className="btn btn--secondary" onClick={handleToggleTheme}>
              {theme === "dark" ? "Dark" : "Light"}
            </button>
          </div>

          {prefSaving && <div style={{ fontSize: "12px", color: "var(--color-text-faint)" }}>저장 중...</div>}
          {!prefSaving && prefMessage && (
            <div className="alert alert--info" style={{ marginTop: "12px" }}>
              {prefMessage}
            </div>
          )}
        </div>
      )}

      {activeTab === "environment" && (
        <div className="card section-card">
          <div className="section-header">
            <h2>API &amp; Environment</h2>
          </div>

          {status ? (
            <>
              <EnvRow label="Backend" connected={status.backendOnline} />
              <EnvRow label="Database" connected={status.dbConnected} />
              <EnvRow label="WebSocket" connected={status.websocketConnected} />
              <EnvRow label="Sepolia RPC" connected={status.sepoliaRpcConnected} />

              <hr className="divider" style={{ margin: "16px 0" }} />

              <div className="history-row__meta" style={{ fontSize: "13px" }}>
                <div>
                  <span className="history-row__meta-label">네트워크</span>
                  {status.network}
                </div>
                <div>
                  <span className="history-row__meta-label">서버 시각</span>
                  {new Date(status.serverTime).toLocaleString()}
                </div>
              </div>
            </>
          ) : (
            <p className="empty-state">불러오는 중...</p>
          )}
        </div>
      )}

      {activeTab === "notifications" && preferences && (
        <>
          <div className="card section-card">
            <div className="section-header">
              <h2>Notifications</h2>
            </div>

            <div className="settings-row">
              <div className="settings-row__text">
                <div className="settings-row__label">인앱 알림</div>
                <div className="settings-row__desc">출금 상태가 변경되면 사이드바 알림으로 표시합니다.</div>
              </div>
              <Switch
                checked={preferences.inAppNotifications}
                onChange={(next) => savePreferences({ inAppNotifications: next })}
              />
            </div>

            <div className="settings-row">
              <div className="settings-row__text">
                <div className="settings-row__label">
                  이메일 알림 <span className="badge badge--gray">준비중</span>
                </div>
                <div className="settings-row__desc">
                  출금 완료/실패 시 이메일로 알려드립니다. (실제 발송 기능은 준비 중입니다)
                </div>
              </div>
              <Switch
                checked={preferences.emailNotifications}
                onChange={(next) => savePreferences({ emailNotifications: next })}
              />
            </div>

            {prefSaving && <div style={{ fontSize: "12px", color: "var(--color-text-faint)" }}>저장 중...</div>}
            {!prefSaving && prefMessage && (
              <div className="alert alert--info" style={{ marginTop: "12px" }}>
                {prefMessage}
              </div>
            )}
          </div>

          <div className="card section-card">
            <div className="section-header">
              <h2>알림 유형</h2>
            </div>
            <p style={{ fontSize: "12.5px", color: "var(--color-text-muted)", marginBottom: "6px" }}>
              인앱 알림이 켜져 있을 때, 아래 유형의 출금 상태 변경만 골라서 받아볼 수 있습니다.
            </p>

            {NOTIFICATION_CATEGORY_ITEMS.map((item) => (
              <div className="settings-row" key={item.key}>
                <div className="settings-row__text">
                  <div className="settings-row__label">{item.label}</div>
                </div>
                <Switch checked={categoryPrefs[item.key]} onChange={() => toggleCategory(item.key)} />
              </div>
            ))}
          </div>
        </>
      )}

      {activeTab === "about" && (
        <div className="card section-card">
          <div className="section-header">
            <h2>정보</h2>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "18px" }}>
            <span
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "10px",
                background: "var(--color-primary)",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: "14px",
              }}
            >
              CS
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: "15px" }}>Custody Vault</div>
              <div style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                Selfmade MPC Wallet · v2.0.0
              </div>
            </div>
          </div>

          <p style={{ fontSize: "13px", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
            단일 MPC 지갑 서비스를 위한 데모 애플리케이션입니다.
          </p>
        </div>
      )}
    </div>
  );
}
