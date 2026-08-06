import { useEffect, useState } from "react";
import { getMe } from "../api/auth";
import type { Me } from "../types/auth";
import "../styles/page.css";

const PLACEHOLDER_ADDRESS = "—";
const PLACEHOLDER_BALANCE = "0 ETH";

export default function DashboardPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const meData = await getMe();
        setMe(meData);
      } catch (err: any) {
        setError(err?.response?.data?.message || "데이터 조회 실패");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

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
          <span className="badge badge--primary">MPC</span>
        </div>

        <div className="field" style={{ marginBottom: "16px" }}>
          <label className="input-label">Address</label>
          <div
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: "13.5px",
              color: "var(--color-text)",
              padding: "12px 14px",
              borderRadius: "10px",
              border: "1px solid var(--color-border)",
              background: "var(--color-gray-soft)",
              wordBreak: "break-all",
            }}
          >
            {PLACEHOLDER_ADDRESS}
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
            {PLACEHOLDER_BALANCE}
          </div>
          <div
            style={{
              fontSize: "12.5px",
              color: "var(--color-text-muted)",
              marginTop: "4px",
            }}
          >
            MPC 기능 연동 전 플레이스홀더입니다.
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
