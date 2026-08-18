import { useEffect, useState } from "react";
import { formatUnits } from "ethers";
import type { TokenBalance } from "../types/wallet";

type Props = {
  open: boolean;
  busy: boolean;
  walletAddress: string;
  balanceEth: string;
  token?: TokenBalance | null;
  onCancel: () => void;
  onConfirm: (params: { toAddress: string; otp: string }) => void;
};

/**
 * Confirm destination + OTP for emergency B+C full-balance last withdraw.
 */
export default function EmergencyLastWithdrawModal({
  open,
  busy,
  walletAddress,
  balanceEth,
  token,
  onCancel,
  onConfirm,
}: Props) {
  const [toAddress, setToAddress] = useState("");
  const [otp, setOtp] = useState("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!open) {
      setToAddress("");
      setOtp("");
      setLocalError("");
    }
  }, [open]);

  if (!open) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError("");
    if (!/^0x[a-fA-F0-9]{40}$/.test(toAddress.trim())) {
      setLocalError("올바른 Ethereum 수신 주소를 입력하세요.");
      return;
    }
    if (!/^\d{6}$/.test(otp)) {
      setLocalError("OTP는 숫자 6자리여야 합니다.");
      return;
    }
    onConfirm({ toAddress: toAddress.trim(), otp });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="emergency-last-withdraw-title"
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
        <h2
          id="emergency-last-withdraw-title"
          style={{ margin: 0, fontSize: "18px" }}
        >
          비상 전액 출금 (B+C)
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: "13.5px",
            color: "var(--color-text-muted)",
            lineHeight: 1.5,
          }}
        >
          Share B + Recovery Share C로 ETH와 설정된 토큰(TTK)을 지정 주소로
          전액 출금한 뒤 지갑을 영구 폐기(RETIRED)합니다. 토큰을 먼저 보내고
          이어서 ETH를 보냅니다. 일부 금액 출금은 불가합니다.
          {token
            ? " TTK 출금에는 가스용 Sepolia ETH가 필요합니다. ETH가 부족하면 출금이 중단되며 지갑은 폐기되지 않으니, MPC 주소로 소량의 ETH를 입금한 뒤 다시 시도하세요."
            : ""}
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
          현재 잔액: {balanceEth} ETH (가스비 차감 후 전액)
          {token ? (
            <>
              <br />
              {`${formatUnits(token.balanceRaw || "0", token.decimals)} ${token.symbol}`}{" "}
              (전액)
            </>
          ) : null}
        </p>

        <div className="field">
          <label className="input-label" htmlFor="emergency-to">
            수신 주소
          </label>
          <input
            id="emergency-to"
            className="input"
            placeholder="0x..."
            value={toAddress}
            disabled={busy}
            onChange={(e) => setToAddress(e.target.value.trim())}
          />
        </div>

        <div className="field">
          <label className="input-label" htmlFor="emergency-last-otp">
            Google Authenticator OTP (재확인)
          </label>
          <input
            id="emergency-last-otp"
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
            {busy ? "출금 중..." : "전액 출금 및 폐기"}
          </button>
        </div>
      </form>
    </div>
  );
}
