import { useEffect, useState } from "react";
import { parseRecoveryFileJson } from "../lib/mpc/recovery-file";

type Props = {
  open: boolean;
  busy: boolean;
  walletAddress: string;
  alreadyHasShareA: boolean;
  /** Restore failure from parent (wrong file / PIN / wallet mismatch). */
  error?: string;
  onCancel: () => void;
  onConfirm: (params: {
    recoveryFileJson: string;
    pin: string;
    overwrite: boolean;
  }) => void;
  onDismissError?: () => void;
};

/**
 * Upload Recovery File + enter PIN to restore Share A into IndexedDB.
 * Decryption stays in the browser.
 */
export default function RestoreShareModal({
  open,
  busy,
  walletAddress,
  alreadyHasShareA,
  error = "",
  onCancel,
  onConfirm,
  onDismissError,
}: Props) {
  const [pin, setPin] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileJson, setFileJson] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!open) {
      setPin("");
      setFileName("");
      setFileJson("");
      setOverwrite(false);
      setLocalError("");
    }
  }, [open]);

  if (!open) return null;

  const displayError = localError || error;

  const clearErrors = () => {
    setLocalError("");
    onDismissError?.();
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    clearErrors();
    const file = e.target.files?.[0];
    if (!file) {
      setFileName("");
      setFileJson("");
      return;
    }
    try {
      const text = await file.text();
      if (!text.trim()) {
        throw new Error("Recovery File이 비어 있습니다.");
      }
      parseRecoveryFileJson(text);
      setFileName(file.name);
      setFileJson(text);
    } catch (err: unknown) {
      setFileName("");
      setFileJson("");
      const msg =
        err instanceof Error ? err.message : "파일을 읽을 수 없습니다.";
      setLocalError(msg);
      e.target.value = "";
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    clearErrors();
    if (!fileJson) {
      setLocalError("Recovery File을 선택하세요.");
      return;
    }
    if (!/^\d{6}$/.test(pin)) {
      setLocalError("PIN은 숫자 6자리여야 합니다.");
      return;
    }
    if (alreadyHasShareA && !overwrite) {
      setLocalError("기존 Share A를 덮어쓰려면 확인에 체크하세요.");
      return;
    }
    try {
      parseRecoveryFileJson(fileJson);
    } catch (err: unknown) {
      setLocalError(
        err instanceof Error
          ? err.message
          : "유효하지 않은 Recovery File입니다.",
      );
      return;
    }
    onConfirm({
      recoveryFileJson: fileJson,
      pin,
      overwrite: alreadyHasShareA ? overwrite : true,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="restore-share-title"
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
        <h2 id="restore-share-title" style={{ margin: 0, fontSize: "18px" }}>
          Browser Share 복구
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: "13.5px",
            color: "var(--color-text-muted)",
            lineHeight: 1.5,
          }}
        >
          Recovery File과 6자리 PIN으로 Share A를 이 브라우저에 다시 저장합니다.
          복호화는 브라우저에서만 수행되며 서버로 전송되지 않습니다.
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
          <label className="input-label" htmlFor="recovery-file">
            Recovery File (.json)
          </label>
          <input
            id="recovery-file"
            type="file"
            accept="application/json,.json"
            disabled={busy}
            onChange={onFileChange}
          />
          {fileName && (
            <div
              style={{
                marginTop: "6px",
                fontSize: "12.5px",
                color: "var(--color-text-muted)",
              }}
            >
              선택됨: {fileName}
            </div>
          )}
        </div>

        <div className="field">
          <label className="input-label" htmlFor="restore-pin">
            6자리 Recovery PIN
          </label>
          <input
            id="restore-pin"
            className="input"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            disabled={busy}
            onChange={(e) => {
              clearErrors();
              setPin(e.target.value.replace(/\D/g, "").slice(0, 6));
            }}
          />
        </div>

        {alreadyHasShareA && (
          <label
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "flex-start",
              fontSize: "13px",
              color: "var(--color-text-muted)",
            }}
          >
            <input
              type="checkbox"
              checked={overwrite}
              disabled={busy}
              onChange={(e) => setOverwrite(e.target.checked)}
            />
            기존 Share A를 덮어씁니다
          </label>
        )}

        {displayError && (
          <div className="alert alert--danger" role="alert">
            {displayError}
          </div>
        )}

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
            {busy ? "복구 중..." : "Share A 복구"}
          </button>
        </div>
      </form>
    </div>
  );
}
