import { useCallback, useEffect, useState } from "react";
import { getMe } from "../api/auth";
import { getWalletBalance, getWallets } from "../api/wallet";
import { createMpcWalletViaDkg } from "../lib/mpc/create-wallet";
import type { Me } from "../types/auth";
import type { Wallet } from "../types/wallet";
import { formatEther } from "ethers";
import "../styles/page.css";

export default function DashboardPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [balanceEth, setBalanceEth] = useState<string>("0");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createHint, setCreateHint] = useState("");

  const refreshWallet = useCallback(async () => {
    const wallets = await getWallets();
    const current = wallets[0] ?? null;
    setWallet(current);
    if (current) {
      try {
        const bal = await getWalletBalance(current.id);
        setBalanceEth(formatEther(bal.balanceWei ?? "0"));
      } catch {
        setBalanceEth("0");
      }
    } else {
      setBalanceEth("0");
    }
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const meData = await getMe();
        setMe(meData);
        await refreshWallet();
      } catch (err: any) {
        setError(err?.response?.data?.message || "데이터 조회 실패");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [refreshWallet]);

  const onCreate = async () => {
    setError("");
    setCreateHint("");
    setCreating(true);
    try {
      setCreateHint("DKG 진행 중 (Browser A + Server B + Recovery C)...");
      const result = await createMpcWalletViaDkg();
      setWallet(result.wallet);
      setCreateHint(
        "지갑이 생성되었습니다. Share A는 이 브라우저 sessionStorage에 임시 저장되었습니다 (STEP 5에서 암호화 저장으로 교체).",
      );
      await refreshWallet();
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        "MPC 지갑 생성에 실패했습니다.";
      setError(Array.isArray(msg) ? msg.join(", ") : String(msg));
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return <div className="loading-screen">불러오는 중...</div>;
  }

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1 className="page__title">Dashboard</h1>
          <p className="page__subtitle">
            Selfmade MPC Wallet 현황을 확인하세요.
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
              권한: {me.role}
            </p>
            <p
              style={{
                margin: 0,
                fontSize: "13.5px",
                color: "var(--color-text-muted)",
              }}
            >
              상태: {me.status}
            </p>
          </div>
        </section>
      )}

      <section className="card section-card">
        <div className="section-header">
          <h2>My MPC Wallet</h2>
          <span className="badge badge--primary">
            {wallet?.status ?? "NONE"}
          </span>
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
              아직 MPC 지갑이 없습니다. 2-of-3 DKG로 Share A/B/C를 생성합니다.
            </p>
            <button
              type="button"
              className="btn btn--primary"
              disabled={creating}
              onClick={onCreate}
            >
              {creating ? "Creating..." : "Create MPC Wallet"}
            </button>
          </div>
        ) : (
          <>
            <div className="field" style={{ marginBottom: "16px" }}>
              <label className="input-label">Address</label>
              <div
                style={{
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: "13.5px",
                  color: "var(--color-text)",
                  padding: "12px 14px",
                  borderRadius: "10px",
                  border: "1px solid var(--color-border)",
                  background: "var(--color-gray-soft)",
                  wordBreak: "break-all",
                }}
              >
                {wallet.address}
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
              </div>
            </div>

            <div
              className="page__actions"
              style={{ marginBottom: "24px" }}
            >
              <button type="button" className="btn btn--primary" disabled>
                Deposit
              </button>
              <button type="button" className="btn btn--secondary" disabled>
                Withdraw
              </button>
            </div>
          </>
        )}

        {createHint && (
          <div className="alert alert--success" style={{ marginBottom: "16px" }}>
            {createHint}
          </div>
        )}

        <div className="section-header" style={{ marginBottom: "12px" }}>
          <h3 style={{ margin: 0, fontSize: "15px" }}>Transaction History</h3>
        </div>
        <div
          style={{
            border: "1px dashed var(--color-border)",
            borderRadius: "12px",
            padding: "28px 16px",
            textAlign: "center",
            color: "var(--color-text-muted)",
            fontSize: "13.5px",
            background: "var(--color-gray-soft)",
          }}
        >
          거래 내역이 없습니다.
        </div>
      </section>

      {error && <div className="alert alert--danger">{error}</div>}
    </div>
  );
}
