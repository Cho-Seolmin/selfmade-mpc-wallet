import { useCallback, useEffect, useState } from "react";
import { formatEther, formatUnits } from "ethers";
import { getMe } from "../api/auth";
import {
  cancelEmergencyRecovery,
  emergencyLastWithdraw,
  getRetiredWallets,
  getWalletAudits,
  getWalletBalance,
  getWalletWithdraws,
  getWallets,
  startEmergencyRecovery,
} from "../api/wallet";
import EmergencyLastWithdrawModal from "../components/EmergencyLastWithdrawModal";
import EmergencyOtpModal from "../components/EmergencyOtpModal";
import RecoveryPinModal from "../components/RecoveryPinModal";
import RestoreShareModal from "../components/RestoreShareModal";
import WalletActivityPanel, {
  type AuditLogItem,
} from "../components/WalletActivityPanel";
import WithdrawModal from "../components/WithdrawModal";
import { createMpcWalletViaDkg } from "../lib/mpc/create-wallet";
import {
  clearLegacySessionShareA,
  deleteBrowserShareA,
  hasBrowserShareA,
} from "../lib/mpc/browser-share-store";
import { restoreBrowserShareA } from "../lib/mpc/restore-browser-share";
import { withdrawViaAbSigning } from "../lib/mpc/withdraw-ab";
import {
  apiErrorMessage,
  walletStatusBadgeClass,
  walletStatusHint,
} from "../lib/wallet-ui";
import type { Me } from "../types/auth";
import type { TokenBalance, Wallet, WithdrawItem } from "../types/wallet";
import "../styles/page.css";

export default function DashboardPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [latestRetired, setLatestRetired] = useState<Wallet | null>(null);
  const [balanceEth, setBalanceEth] = useState<string>("0");
  const [tokenBalanceLabel, setTokenBalanceLabel] = useState<string | null>(
    null,
  );
  const [tokenInfo, setTokenInfo] = useState<TokenBalance | null>(null);
  const [hasShareA, setHasShareA] = useState(false);
  const [withdraws, setWithdraws] = useState<WithdrawItem[]>([]);
  const [audits, setAudits] = useState<AuditLogItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [emergencyBusy, setEmergencyBusy] = useState(false);
  const [cancelEmergencyBusy, setCancelEmergencyBusy] = useState(false);
  const [lastWithdrawBusy, setLastWithdrawBusy] = useState(false);
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [emergencyModalOpen, setEmergencyModalOpen] = useState(false);
  const [lastWithdrawModalOpen, setLastWithdrawModalOpen] = useState(false);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [createHint, setCreateHint] = useState("");
  const [restoreError, setRestoreError] = useState("");

  const loadActivity = useCallback(async (walletId: string) => {
    const [wRows, aRows] = await Promise.all([
      getWalletWithdraws(walletId).catch(() => [] as WithdrawItem[]),
      getWalletAudits(walletId, 30).catch(() => [] as AuditLogItem[]),
    ]);
    setWithdraws(Array.isArray(wRows) ? wRows : []);
    setAudits(Array.isArray(aRows) ? aRows : []);
  }, []);

  const refreshWallet = useCallback(async () => {
    const [wallets, retired] = await Promise.all([
      getWallets(),
      getRetiredWallets().catch(() => [] as Wallet[]),
    ]);
    const current = wallets[0] ?? null;
    const retiredLatest = retired[0] ?? null;
    setWallet(current);
    setLatestRetired(retiredLatest);

    if (current) {
      try {
        const bal = await getWalletBalance(current.id);
        setBalanceEth(formatEther(bal.balanceWei ?? "0"));
        const token = Array.isArray(bal.tokens) ? bal.tokens[0] : undefined;
        if (token) {
          setTokenInfo(token);
          setTokenBalanceLabel(
            `${formatUnits(token.balanceRaw ?? "0", token.decimals ?? 18)} ${token.symbol || "TTK"}`,
          );
        } else {
          setTokenInfo(null);
          setTokenBalanceLabel(null);
        }
      } catch {
        setBalanceEth("0");
        setTokenInfo(null);
        setTokenBalanceLabel(null);
      }
      try {
        setHasShareA(await hasBrowserShareA(current.id));
      } catch {
        setHasShareA(false);
      }
      await loadActivity(current.id);
    } else {
      setBalanceEth("0");
      setTokenInfo(null);
      setTokenBalanceLabel(null);
      setHasShareA(false);
      if (retiredLatest) {
        await loadActivity(retiredLatest.id);
      } else {
        setWithdraws([]);
        setAudits([]);
      }
    }
  }, [loadActivity]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const meData = await getMe();
        setMe(meData);
        await refreshWallet();
      } catch (err: unknown) {
        setError(apiErrorMessage(err, "데이터 조회 실패"));
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [refreshWallet]);

  const onConfirmPin = async (pin: string) => {
    setError("");
    setCreateHint("");
    setCreating(true);
    try {
      setCreateHint("DKG 진행 중 (Browser A + Server B + Recovery C)...");
      const result = await createMpcWalletViaDkg({ recoveryPin: pin });
      setPinModalOpen(false);
      setWallet(result.wallet);
      setHasShareA(true);
      setCreateHint(
        "지갑이 생성되었습니다. Share A는 IndexedDB에, Recovery File은 다운로드되었습니다. 파일을 안전한 곳에 보관하세요.",
      );
      await refreshWallet();
    } catch (err: unknown) {
      setError(apiErrorMessage(err, "MPC 지갑 생성에 실패했습니다."));
    } finally {
      setCreating(false);
    }
  };

  const onRestoreShare = async (params: {
    recoveryFileJson: string;
    pin: string;
    overwrite: boolean;
  }) => {
    if (!wallet) return;
    setError("");
    setRestoreError("");
    setCreateHint("");
    setRestoring(true);
    try {
      await restoreBrowserShareA({
        recoveryFileJson: params.recoveryFileJson,
        pin: params.pin,
        expectedWallet: {
          id: wallet.id,
          address: wallet.address,
          mpcPublicKey: wallet.mpcPublicKey,
        },
        overwrite: params.overwrite,
      });
      setRestoreModalOpen(false);
      setHasShareA(true);
      setCreateHint(
        "Share A가 이 브라우저에 복구되었습니다. Recovery File을 다시 분실하지 않도록 보관하세요.",
      );
      await refreshWallet();
    } catch (err: unknown) {
      setRestoreError(apiErrorMessage(err, "Share A 복구에 실패했습니다."));
    } finally {
      setRestoring(false);
    }
  };

  const onEmergencyOtp = async (otp: string) => {
    if (!wallet) return;
    setError("");
    setCreateHint("");
    setEmergencyBusy(true);
    try {
      const result = await startEmergencyRecovery(wallet.id, otp);
      setEmergencyModalOpen(false);
      setWallet(result.wallet);
      setCreateHint(result.message);
      await refreshWallet();
    } catch (err: unknown) {
      setError(apiErrorMessage(err, "비상 복구 OTP 인증에 실패했습니다."));
    } finally {
      setEmergencyBusy(false);
    }
  };

  const onCancelEmergency = async () => {
    if (!wallet) return;
    setError("");
    setCreateHint("");
    setCancelEmergencyBusy(true);
    try {
      const result = await cancelEmergencyRecovery(wallet.id);
      setWallet(result.wallet);
      setCreateHint(result.message);
      await refreshWallet();
    } catch (err: unknown) {
      setError(apiErrorMessage(err, "비상 복구 취소에 실패했습니다."));
      await refreshWallet();
    } finally {
      setCancelEmergencyBusy(false);
    }
  };

  const onLastWithdraw = async (params: {
    toAddress: string;
    otp: string;
  }) => {
    if (!wallet) return;
    const retiredId = wallet.id;
    setError("");
    setCreateHint("");
    setLastWithdrawBusy(true);
    try {
      const result = await emergencyLastWithdraw(wallet.id, params);
      setLastWithdrawModalOpen(false);
      try {
        await deleteBrowserShareA(retiredId);
        clearLegacySessionShareA(retiredId);
      } catch {
        // Best-effort local wipe; server already RETIRED.
      }
      setCreateHint(result.message);
      setWallet(null);
      setHasShareA(false);
      setBalanceEth("0");
      await refreshWallet();
    } catch (err: unknown) {
      setError(apiErrorMessage(err, "비상 전액 출금에 실패했습니다."));
      await refreshWallet();
    } finally {
      setLastWithdrawBusy(false);
    }
  };

  const onCopyAddress = async () => {
    if (!wallet) return;
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCreateHint(
        "입금 주소가 복사되었습니다. Sepolia ETH를 이 주소로 보내면 잔액에 반영됩니다.",
      );
      setError("");
    } catch {
      setError("주소 복사에 실패했습니다. 주소를 직접 선택해 복사하세요.");
    }
  };

  const onWithdrawClick = () => {
    if (!wallet) return;
    if (wallet.status === "RECOVERY_PENDING" || wallet.status === "RETIRING") {
      setLastWithdrawModalOpen(true);
      return;
    }
    setError("");
    setCreateHint("");
    setWithdrawModalOpen(true);
  };

  const onWithdraw = async (params: {
    toAddress: string;
    amount: string;
    asset: "ETH" | "ERC20";
  }) => {
    if (!wallet) return;
    setError("");
    setCreateHint("");
    setWithdrawBusy(true);
    try {
      const result = await withdrawViaAbSigning({
        walletId: wallet.id,
        toAddress: params.toAddress,
        amount: params.amount,
        asset: params.asset,
        tokenAddress:
          params.asset === "ERC20" ? tokenInfo?.address : undefined,
      });
      setWithdrawModalOpen(false);
      const txHint = result.withdraw.txHash
        ? ` tx: ${result.withdraw.txHash}`
        : "";
      setCreateHint(`${result.message}${txHint}`);
      await refreshWallet();
    } catch (err: unknown) {
      setError(apiErrorMessage(err, "일반 출금(A+B)에 실패했습니다."));
      await refreshWallet();
    } finally {
      setWithdrawBusy(false);
    }
  };

  if (loading) {
    return <div className="loading-screen">불러오는 중...</div>;
  }

  const canLastWithdraw =
    wallet?.status === "RECOVERY_PENDING" || wallet?.status === "RETIRING";
  const busy =
    creating ||
    restoring ||
    emergencyBusy ||
    cancelEmergencyBusy ||
    lastWithdrawBusy ||
    withdrawBusy;
  const status = wallet?.status ?? "NONE";

  return (
    <div className="page">
      <RecoveryPinModal
        open={pinModalOpen}
        busy={creating}
        onCancel={() => {
          if (!creating) setPinModalOpen(false);
        }}
        onConfirm={onConfirmPin}
      />
      <RestoreShareModal
        open={restoreModalOpen}
        busy={restoring}
        walletAddress={wallet?.address ?? ""}
        alreadyHasShareA={hasShareA}
        error={restoreError}
        onCancel={() => {
          if (!restoring) {
            setRestoreModalOpen(false);
            setRestoreError("");
          }
        }}
        onConfirm={onRestoreShare}
        onDismissError={() => setRestoreError("")}
      />
      <EmergencyOtpModal
        open={emergencyModalOpen}
        busy={emergencyBusy}
        walletAddress={wallet?.address ?? ""}
        onCancel={() => {
          if (!emergencyBusy) setEmergencyModalOpen(false);
        }}
        onConfirm={onEmergencyOtp}
      />
      <EmergencyLastWithdrawModal
        open={lastWithdrawModalOpen}
        busy={lastWithdrawBusy}
        walletAddress={wallet?.address ?? ""}
        balanceEth={balanceEth}
        token={tokenInfo}
        onCancel={() => {
          if (!lastWithdrawBusy) setLastWithdrawModalOpen(false);
        }}
        onConfirm={onLastWithdraw}
      />
      <WithdrawModal
        open={withdrawModalOpen}
        busy={withdrawBusy}
        hasShareA={hasShareA}
        walletAddress={wallet?.address ?? ""}
        balanceEth={balanceEth}
        token={tokenInfo}
        onCancel={() => {
          if (!withdrawBusy) setWithdrawModalOpen(false);
        }}
        onConfirm={onWithdraw}
      />

      <header className="page__header">
        <div>
          <h1 className="page__title">Dashboard</h1>
          <p className="page__subtitle">
            2-of-3 MPC 지갑 생성 · 복구 · 일반/비상 출금
          </p>
        </div>
      </header>

      {me && (
        <section
          className="card section-card"
          style={{ marginBottom: "20px" }}
        >
          <div className="section-header">
            <h2>내 정보</h2>
          </div>
          <div
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: "12px",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              background: "var(--color-gray-soft)",
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: "13.5px",
                color: "var(--color-text-muted)",
              }}
            >
              이메일: {me.email}
            </p>
            <p
              style={{
                margin: 0,
                fontSize: "13.5px",
                color: "var(--color-text-muted)",
              }}
            >
              권한: {me.role} · 계정: {me.status}
            </p>
          </div>
        </section>
      )}

      <section className="card section-card">
        <div className="section-header">
          <h2>My MPC Wallet</h2>
          <span className={walletStatusBadgeClass(status)}>{status}</span>
        </div>

        {!wallet ? (
          <div style={{ marginBottom: "20px" }}>
            <p
              style={{
                fontSize: "13.5px",
                color: "var(--color-text-muted)",
                marginTop: 0,
              }}
            >
              활성 MPC 지갑이 없습니다. DKG로 Share A/B/C를 만들고 Recovery
              File을 저장하세요.
            </p>
            {latestRetired && (
              <div
                className="alert alert--success"
                style={{ marginBottom: "14px" }}
              >
                이전 지갑이 RETIRED 처리되었습니다.
                <br />
                주소: {latestRetired.address}
                {latestRetired.retiredAt
                  ? ` · 폐기: ${new Date(latestRetired.retiredAt).toLocaleString()}`
                  : ""}
                <br />
                아래에서 새 지갑을 만들 수 있습니다. 하단에서 이전 출금/감사
                이력을 확인할 수 있습니다.
              </div>
            )}
            <button
              type="button"
              className="btn btn--primary"
              disabled={creating}
              onClick={() => setPinModalOpen(true)}
            >
              Create MPC Wallet
            </button>
          </div>
        ) : (
          <>
            <p
              style={{
                fontSize: "13px",
                color: "var(--color-text-muted)",
                marginTop: 0,
                marginBottom: "16px",
              }}
            >
              {walletStatusHint(wallet.status)}
            </p>

            <div className="field" style={{ marginBottom: "12px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                  marginBottom: "4px",
                }}
              >
                <label
                  className="input-label"
                  style={{ fontSize: "11px", marginBottom: 0 }}
                >
                  Address
                </label>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={busy}
                  onClick={onCopyAddress}
                  style={{
                    height: "26px",
                    padding: "0 8px",
                    fontSize: "11.5px",
                    border: "none",
                  }}
                >
                  주소복사
                </button>
              </div>
              <div
                className="mono-box"
                style={{
                  fontSize: "11.5px",
                  padding: "8px 10px",
                  borderRadius: "8px",
                  lineHeight: 1.4,
                  wordBreak: "break-all",
                }}
              >
                {wallet.address}
              </div>
            </div>

            <div className="field" style={{ marginBottom: "12px" }}>
              <label className="input-label">Browser Share A</label>
              <div
                style={{
                  fontSize: "13.5px",
                  color: "var(--color-text-muted)",
                  marginBottom: "10px",
                }}
              >
                {hasShareA
                  ? "IndexedDB에 암호화되어 저장됨"
                  : "이 브라우저에 Share A 없음 — Recovery File로 복구 필요"}
              </div>
              <button
                type="button"
                className="btn btn--secondary"
                disabled={busy || canLastWithdraw}
                onClick={() => {
                  setRestoreError("");
                  setRestoreModalOpen(true);
                }}
              >
                {hasShareA ? "Share A 다시 복구" : "Browser Share 복구"}
              </button>
            </div>

            <div className="field" style={{ marginBottom: "16px" }}>
              <label className="input-label">비상 복구</label>
              <div
                style={{
                  fontSize: "13.5px",
                  color: "var(--color-text-muted)",
                  marginBottom: "10px",
                }}
              >
                {wallet.status === "RECOVERY_PENDING"
                  ? "OTP 인증 완료 — 전액 출금(B+C)을 진행하거나, 실수였다면 취소해 ACTIVE로 되돌릴 수 있습니다."
                  : wallet.status === "RETIRING"
                    ? "비상 출금 재시도 가능 (RETIRING)"
                    : "Recovery File까지 분실한 경우 Google OTP로 시작합니다."}
              </div>
              <div className="page__actions" style={{ marginBottom: 0 }}>
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={busy || wallet.status === "RETIRING"}
                  onClick={() => setEmergencyModalOpen(true)}
                >
                  {wallet.status === "RECOVERY_PENDING"
                    ? "OTP 재확인"
                    : "비상 복구 (OTP)"}
                </button>
                {wallet.status === "RECOVERY_PENDING" && (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={busy}
                    onClick={onCancelEmergency}
                  >
                    {cancelEmergencyBusy ? "취소 중..." : "비상 복구 취소"}
                  </button>
                )}
                {canLastWithdraw && (
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={busy}
                    onClick={() => setLastWithdrawModalOpen(true)}
                  >
                    전액 출금 (B+C)
                  </button>
                )}
              </div>
            </div>

            <div className="field" style={{ marginBottom: "20px" }}>
              <label className="input-label">Balance</label>
              <div
                style={{
                  fontSize: "22px",
                  fontWeight: 700,
                  color: "var(--color-text)",
                  padding: "4px 0",
                }}
              >
                {balanceEth} ETH
                {tokenBalanceLabel && (
                  <div
                    style={{
                      fontSize: "16px",
                      fontWeight: 600,
                      color: "var(--color-text-muted)",
                      marginTop: "4px",
                    }}
                  >
                    {tokenBalanceLabel}
                  </div>
                )}
              </div>
            </div>

            <div className="page__actions" style={{ marginBottom: "24px" }}>
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={onWithdrawClick}
              >
                {canLastWithdraw ? "비상 전액 출금" : "Withdraw"}
              </button>
            </div>
          </>
        )}

        {createHint && (
          <div className="alert alert--success" style={{ marginBottom: "16px" }}>
            {createHint}
          </div>
        )}

        <WalletActivityPanel withdraws={withdraws} audits={audits} />
      </section>

      {error && <div className="alert alert--danger">{error}</div>}
    </div>
  );
}
