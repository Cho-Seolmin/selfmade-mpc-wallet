import { useEffect, useState } from "react";

type Props = {
  open: boolean;
  busy: boolean;
  walletAddress: string;
  onCancel: () => void;
  onConfirm: (otp: string) => void;
};

/**
 * Google OTP confirmation to enter emergency recovery (RECOVERY_PENDING).
 * Used when Recovery File is also lost — not for normal A+B withdraw.
 */
export default function EmergencyOtpModal({
  open,
  busy,
  walletAddress,
  onCancel,
  onConfirm,
}: Props) {
  const [otp, setOtp] = useState("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!open) {
      setOtp("");
      setLocalError("");
    }
  }, [open]);

  if (!open) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError("");
    if (!/^\d{6}$/.test(otp)) {
      setLocalError("OTP는 숫자 6자리여야 합니다.");
      return;
    }
    onConfirm(otp);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="emergency-otp-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: "16px",
      }}
    >
      <form
        onSubmit={submit}
        className="card"
        style={{
          width: "100%",
          maxWidth: "440px",
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
        }}
      >
        <h2 id="emergency-otp-title" style={{ margin: 0, fontSize: "18px" }}>
          비상 복구 (Google OTP)
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: "13.5px",
            color: "var(--color-text-muted)",
            lineHeight: 1.5,
          }}
        >
          Recovery File까지 분실한 경우에만 사용합니다. OTP 인증 후 지갑은
          RECOVERY_PENDING이 되며, 이후 B+C로 전액 출금 후 지갑이 폐기됩니다.
          일부 금액 출금은 불가합니다.
        </p>
        <p
          style={{
            margin: 0,
            fontSize: "12.5px",
            color: "var(--color-text-muted)",
            wordBreak: "break-all",
          }}
        >
          대상 지갑: {walletAddress}
        </p>

        <div className="field">
          <label className="input-label" htmlFor="emergency-otp">
            Google Authenticator OTP
          </label>
          <input
            id="emergency-otp"
            className="input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={otp}
            disabled={busy}
            onChange={(e) =>
              setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
          />
        </div>

        {localError && <div className="alert alert--danger">{localError}</div>}

        <div className="page__actions" style={{ marginTop: "4px" }}>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            onClick={onCancel}
          >
            취소
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "인증 중..." : "비상 복구 시작"}
          </button>
        </div>
      </form>
    </div>
  );
}
