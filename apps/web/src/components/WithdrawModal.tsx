import { useEffect, useState } from "react";
import { formatUnits, parseUnits } from "ethers";
import type { TokenBalance } from "../types/wallet";

type WithdrawAsset = "ETH" | "ERC20";

type Props = {
  open: boolean;
  busy: boolean;
  hasShareA: boolean;
  walletAddress: string;
  balanceEth: string;
  token?: TokenBalance | null;
  onCancel: () => void;
  onConfirm: (params: {
    toAddress: string;
    amount: string;
    asset: WithdrawAsset;
  }) => void;
};

function parseDecimal(value: string, decimals: number): bigint | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const raw = parseUnits(trimmed, decimals);
    if (raw <= 0n) return null;
    return raw;
  } catch {
    return null;
  }
}

function balanceToRaw(display: string, decimals: number): bigint {
  try {
    return parseUnits(display || "0", decimals);
  } catch {
    return 0n;
  }
}

/**
 * Normal A+B partial withdraw: ETH or configured ERC-20 (TTK).
 */
export default function WithdrawModal({
  open,
  busy,
  hasShareA,
  walletAddress,
  balanceEth,
  token,
  onCancel,
  onConfirm,
}: Props) {
  const [asset, setAsset] = useState<WithdrawAsset>("ETH");
  const [toAddress, setToAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!open) {
      setAsset("ETH");
      setToAddress("");
      setAmount("");
      setLocalError("");
    }
  }, [open]);

  const tokenEnabled = Boolean(token?.address);
  const selectedDecimals = asset === "ERC20" ? (token?.decimals ?? 18) : 18;
  const selectedSymbol =
    asset === "ERC20" ? token?.symbol || "TTK" : "ETH";
  const selectedBalanceRaw =
    asset === "ERC20"
      ? BigInt(token?.balanceRaw || "0")
      : balanceToRaw(balanceEth, 18);

  const amountRaw = parseDecimal(amount, selectedDecimals);
  const amountExceedsBalance =
    amountRaw !== null && amountRaw > 0n && amountRaw > selectedBalanceRaw;

  const shareWarning =
    "이 브라우저에 Share A가 없습니다. Recovery File로 복구한 뒤 다시 시도하세요. Recovery File도 없다면 비상 복구(OTP)를 사용하세요.";
  const balanceWarning =
    asset === "ERC20"
      ? `출금 금액이 현재 ${selectedSymbol} 잔액보다 큽니다.`
      : "출금 금액이 현재 잔액보다 큽니다. 가스비도 잔액에서 차감되므로 잔액보다 적게 입력하세요.";

  if (!open) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError("");

    if (!hasShareA) {
      setLocalError(shareWarning);
      return;
    }
    if (asset === "ERC20" && !tokenEnabled) {
      setLocalError("표시할 토큰이 없습니다. API의 TestToken 설정을 확인하세요.");
      return;
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(toAddress.trim())) {
      setLocalError("올바른 Ethereum 수신 주소를 입력하세요.");
      return;
    }
    const amt = amount.trim();
    if (!amt || amountRaw === null || amountRaw <= 0n) {
      setLocalError(`출금 금액(${selectedSymbol})을 올바르게 입력하세요.`);
      return;
    }
    if (amountRaw > selectedBalanceRaw) {
      setLocalError(balanceWarning);
      return;
    }
    onConfirm({ toAddress: toAddress.trim(), amount: amt, asset });
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
          {asset === "ERC20"
            ? `${selectedSymbol}은 토큰 컨트랙트로 transfer 하고, 가스비는 ETH에서 차감됩니다.`
            : "Browser Share A + Main Share B로 Threshold Signing합니다. 가스비는 잔액에서 별도 차감되므로 전액보다 조금 적게 입력하세요."}
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
          {tokenEnabled ? (
            <>
              <br />
              {`${formatUnits(token!.balanceRaw || "0", token!.decimals)} ${token!.symbol}`}
            </>
          ) : null}
        </p>

        {!hasShareA && (
          <div className="alert alert--danger" role="alert">
            {shareWarning}
          </div>
        )}

        <div className="field">
          <span className="input-label">자산</span>
          <div className="page__actions" style={{ marginTop: "6px" }}>
            <button
              type="button"
              className={`btn ${asset === "ETH" ? "btn--primary" : "btn--secondary"}`}
              disabled={busy || !hasShareA}
              onClick={() => {
                setAsset("ETH");
                setLocalError("");
              }}
            >
              ETH
            </button>
            <button
              type="button"
              className={`btn ${asset === "ERC20" ? "btn--primary" : "btn--secondary"}`}
              disabled={busy || !hasShareA || !tokenEnabled}
              onClick={() => {
                setAsset("ERC20");
                setLocalError("");
              }}
            >
              {token?.symbol || "TTK"}
            </button>
          </div>
        </div>

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
            출금 금액 ({selectedSymbol})
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
