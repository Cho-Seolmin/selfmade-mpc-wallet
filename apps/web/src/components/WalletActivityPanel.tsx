import { useEffect, useState } from "react";
import { formatEther } from "ethers";
import { formatAuditEvent, shortAddress } from "../lib/wallet-ui";
import type { WithdrawItem } from "../types/wallet";

export type AuditLogItem = {
  id: string;
  eventType: string;
  actorType: string;
  message: string | null;
  data: unknown;
  createdAt: string;
  withdrawRequestId?: string | null;
};

type Props = {
  withdraws: WithdrawItem[];
  audits: AuditLogItem[];
  explorerBaseUrl?: string;
};

const PAGE_SIZE = 5;

function txUrl(hash: string, base?: string) {
  const root = (base || "https://sepolia.etherscan.io").replace(/\/$/, "");
  return `${root}/tx/${hash}`;
}

function pageCount(total: number) {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

function slicePage<T>(items: T[], page: number): T[] {
  const start = (page - 1) * PAGE_SIZE;
  return items.slice(start, start + PAGE_SIZE);
}

function PaginationBar({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <nav className="pager" aria-label="페이지 이동">
      <button
        type="button"
        className="pager__nav"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        ‹ 이전
      </button>
      <div className="pager__pages">
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            className={`pager__page${n === page ? " pager__page--active" : ""}`}
            aria-current={n === page ? "page" : undefined}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="pager__nav"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        다음 ›
      </button>
    </nav>
  );
}

export default function WalletActivityPanel({
  withdraws,
  audits,
  explorerBaseUrl,
}: Props) {
  const [withdrawPage, setWithdrawPage] = useState(1);
  const [auditPage, setAuditPage] = useState(1);

  const withdrawPages = pageCount(withdraws.length);
  const auditPages = pageCount(audits.length);

  useEffect(() => {
    setWithdrawPage((p) => Math.min(p, withdrawPages));
  }, [withdrawPages]);

  useEffect(() => {
    setAuditPage((p) => Math.min(p, auditPages));
  }, [auditPages]);

  const visibleWithdraws = slicePage(withdraws, withdrawPage);
  const visibleAudits = slicePage(audits, auditPage);

  return (
    <div className="activity-grid">
      <div>
        <div className="section-header" style={{ marginBottom: "12px" }}>
          <h3 style={{ margin: 0, fontSize: "15px" }}>출금 내역</h3>
        </div>
        {withdraws.length === 0 ? (
          <div className="empty-panel">출금 내역이 없습니다.</div>
        ) : (
          <>
            <ul className="activity-list">
              {visibleWithdraws.map((w) => (
                <li key={w.id} className="activity-list__item">
                  <div className="activity-list__row">
                    <span className="activity-list__title">
                      {formatEther(w.amount || "0")} ETH
                    </span>
                    <span
                      className={`badge ${
                        w.status === "EXECUTED"
                          ? "badge--success"
                          : w.status === "FAILED" || w.status === "REJECTED"
                            ? "badge--danger"
                            : "badge--warning"
                      }`}
                    >
                      {w.status}
                    </span>
                  </div>
                  <div className="activity-list__meta">
                    → {shortAddress(w.toAddress)}
                    {w.executionType ? ` · ${w.executionType}` : ""}
                    {" · "}
                    {new Date(w.createdAt).toLocaleString()}
                  </div>
                  {w.txHash && (
                    <a
                      className="activity-list__link"
                      href={txUrl(w.txHash, explorerBaseUrl)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {shortAddress(w.txHash)}
                    </a>
                  )}
                </li>
              ))}
            </ul>
            <PaginationBar
              page={withdrawPage}
              totalPages={withdrawPages}
              onChange={setWithdrawPage}
            />
          </>
        )}
      </div>

      <div>
        <div className="section-header" style={{ marginBottom: "12px" }}>
          <h3 style={{ margin: 0, fontSize: "15px" }}>감사 로그</h3>
        </div>
        {audits.length === 0 ? (
          <div className="empty-panel">감사 이벤트가 없습니다.</div>
        ) : (
          <>
            <ul className="activity-list">
              {visibleAudits.map((a) => (
                <li key={a.id} className="activity-list__item">
                  <div className="activity-list__row">
                    <span className="activity-list__title">
                      {formatAuditEvent(a.eventType)}
                    </span>
                    <span className="badge badge--gray">{a.actorType}</span>
                  </div>
                  {a.message && (
                    <div className="activity-list__meta">{a.message}</div>
                  )}
                  <div className="activity-list__meta">
                    {new Date(a.createdAt).toLocaleString()}
                  </div>
                </li>
              ))}
            </ul>
            <PaginationBar
              page={auditPage}
              totalPages={auditPages}
              onChange={setAuditPage}
            />
          </>
        )}
      </div>
    </div>
  );
}
