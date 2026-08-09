import { useEffect, useState } from "react";

type Props = {
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (pin: string) => void;
};

/**
 * Collects a 6-digit Recovery PIN before MPC wallet creation.
 * PIN is used only to encrypt the one-time Recovery File (not sent to server).
 */
export default function RecoveryPinModal({
  open,
  busy,
  onCancel,
  onConfirm,
}: Props) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!open) {
      setPin("");
      setConfirm("");
      setLocalError("");
    }
  }, [open]);

  if (!open) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError("");
    if (!/^\d{6}$/.test(pin)) {
      setLocalError("PIN은 숫자 6자리여야 합니다.");
      return;
    }
    if (pin !== confirm) {
      setLocalError("PIN 확인이 일치하지 않습니다.");
      return;
    }
    onConfirm(pin);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="recovery-pin-title"
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
          maxWidth: "420px",
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
        }}
      >
        <h2 id="recovery-pin-title" style={{ margin: 0, fontSize: "18px" }}>
          Recovery PIN 설정
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: "13.5px",
            color: "var(--color-text-muted)",
            lineHeight: 1.5,
          }}
        >
          지갑 생성 직후 Share A를 담은 Recovery File을 1회 다운로드합니다.
          PIN은 서버로 전송되지 않으며, 브라우저에서만 파일 암호화에 사용됩니다.
        </p>

        <div className="field">
          <label className="input-label" htmlFor="recovery-pin">
            6자리 PIN
          </label>
          <input
            id="recovery-pin"
            className="input"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={6}
            value={pin}
            disabled={busy}
            onChange={(e) =>
              setPin(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
          />
        </div>

        <div className="field">
          <label className="input-label" htmlFor="recovery-pin-confirm">
            PIN 확인
          </label>
          <input
            id="recovery-pin-confirm"
            className="input"
            inputMode="numeric"
            autoComplete="new-password"
            maxLength={6}
            value={confirm}
            disabled={busy}
            onChange={(e) =>
              setConfirm(e.target.value.replace(/\D/g, "").slice(0, 6))
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
            {busy ? "생성 중..." : "PIN 확인 후 생성"}
          </button>
        </div>
      </form>
    </div>
  );
}
