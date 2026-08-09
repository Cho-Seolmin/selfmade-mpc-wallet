import { formatEther } from "ethers";
import {
  formatAuditEvent,
  shortAddress,
} from "../lib/wallet-ui";
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

function txUrl(hash: string, base?: string) {
  const root = (base || "https://sepolia.etherscan.io").replace(/\/$/, "");
  return `${root}/tx/${hash}`;
}

export default function WalletActivityPanel({
  withdraws,
  audits,
  explorerBaseUrl,
}: Props) {
  return (
    <div className="activity-grid">
      <div>
        <div className="section-header" style={{ marginBottom: "12px" }}>
          <h3 style={{ margin: 0, fontSize: "15px" }}>출금 내역</h3>
        </div>
        {withdraws.length === 0 ? (
          <div className="empty-panel">출금 내역이 없습니다.</div>
        ) : (
          <ul className="activity-list">
            {withdraws.map((w) => (
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
        )}
      </div>

      <div>
        <div className="section-header" style={{ marginBottom: "12px" }}>
          <h3 style={{ margin: 0, fontSize: "15px" }}>감사 로그</h3>
        </div>
        {audits.length === 0 ? (
          <div className="empty-panel">감사 이벤트가 없습니다.</div>
        ) : (
          <ul className="activity-list">
            {audits.map((a) => (
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
        )}
      </div>
    </div>
  );
}
