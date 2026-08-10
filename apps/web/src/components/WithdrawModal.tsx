import { useEffect, useState } from "react";
import { parseEther } from "ethers";

type Props = {
  open: boolean;
  busy: boolean;
  hasShareA: boolean;
  walletAddress: string;
  balanceEth: string;
  onCancel: () => void;
  onConfirm: (params: { toAddress: string; amount: string }) => void;
};

function parseEthInput(value: string): bigint | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    // Match API: pure digits = wei, otherwise ETH decimal.
    if (/^\d+$/.test(trimmed)) return BigInt(trimmed);
    return parseEther(trimmed);
  } catch {
    return null;
  }
}

function balanceToWei(balanceEth: string): bigint {
  try {
    return parseEther(balanceEth || "0");
  } catch {
    return 0n;
  }
}

/**
 * Normal A+B partial ETH withdraw: destination + amount (ETH decimal).
 */
export default function WithdrawModal({
  open,
  busy,
  hasShareA,
  walletAddress,
  balanceEth,
  onCancel,
  onConfirm,
}: Props) {
  const [toAddress, setToAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!open) {
      setToAddress("");
      setAmount("");
      setLocalError("");
    }
  }, [open]);

  const balanceWei = balanceToWei(balanceEth);
  const amountWei = parseEthInput(amount);
  const amountExceedsBalance =
    amountWei !== null && amountWei > 0n && amountWei > balanceWei;

  const shareWarning =
    "이 브라우저에 Share A가 없습니다. Recovery File로 복구한 뒤 다시 시도하세요. Recovery File도 없다면 비상 복구(OTP)를 사용하세요.";
  const balanceWarning =
    "출금 금액이 현재 잔액보다 큽니다. 가스비도 잔액에서 차감되므로 잔액보다 적게 입력하세요.";

  if (!open) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError("");

    if (!hasShareA) {
      setLocalError(shareWarning);
      return;
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(toAddress.trim())) {
      setLocalError("올바른 Ethereum 수신 주소를 입력하세요.");
      return;
    }
    const amt = amount.trim();
    if (!amt || amountWei === null || amountWei <= 0n) {
      setLocalError("출금 금액(ETH)을 올바르게 입력하세요.");
      return;
    }
    if (amountWei > balanceWei) {
      setLocalError(balanceWarning);
      return;
    }
    onConfirm({ toAddress: toAddress.trim(), amount: amt });
  };

  const canSubmit = hasShareA && !busy && !amountExceedsBalance;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="withdraw-ab-title"
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
          maxWidth: "460px",
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
        }}
      >
        <h2 id="withdraw-ab-title" style={{ margin: 0, fontSize: "18px" }}>
          일반 출금 (A+B)
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: "13.5px",
            color: "var(--color-text-muted)",
            lineHeight: 1.5,
          }}
        >
          Browser Share A + Main Share B로 Threshold Signing합니다. 가스비는
          잔액에서 별도 차감되므로 전액보다 조금 적게 입력하세요.
        </p>
        <p
          style={{
            margin: 0,
            fontSize: "12.5px",
            color: "var(--color-text-muted)",
            wordBreak: "break-all",
          }}
        >
          출금 지갑: {walletAddress}
          <br />
          현재 잔액: {balanceEth} ETH
        </p>

        {!hasShareA && (
          <div className="alert alert--danger" role="alert">
            {shareWarning}
          </div>
        )}

        <div className="field">
          <label className="input-label" htmlFor="withdraw-to">
            수신 주소
          </label>
          <input
            id="withdraw-to"
            className="input"
            placeholder="0x..."
            value={toAddress}
            disabled={busy || !hasShareA}
            onChange={(e) => setToAddress(e.target.value.trim())}
          />
        </div>

        <div className="field">
          <label className="input-label" htmlFor="withdraw-amount">
            출금 금액 (ETH)
          </label>
          <input
            id="withdraw-amount"
            className="input"
            inputMode="decimal"
            placeholder="0.01"
            value={amount}
            disabled={busy || !hasShareA}
            aria-invalid={amountExceedsBalance}
            onChange={(e) => {
              setAmount(e.target.value);
              setLocalError("");
            }}
          />
        </div>

        {amountExceedsBalance && (
          <div className="alert alert--danger" role="alert">
            {balanceWarning}
          </div>
        )}

        {localError && !amountExceedsBalance && (
          <div className="alert alert--danger" role="alert">
            {localError}
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
          <button
            type="submit"
            className="btn btn--primary"
            disabled={!canSubmit}
          >
            {busy ? "서명·출금 중..." : "출금하기"}
          </button>
        </div>
      </form>
    </div>
  );
}
