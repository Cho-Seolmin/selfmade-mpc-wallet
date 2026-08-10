import type { WalletStatus } from "../types/wallet";

export function walletStatusLabel(status: WalletStatus | "NONE"): string {
  switch (status) {
    case "ACTIVE":
      return "ACTIVE";
    case "RECOVERY_PENDING":
      return "RECOVERY_PENDING";
    case "RETIRING":
      return "RETIRING";
    case "RETIRED":
      return "RETIRED";
    default:
      return "NONE";
  }
}

export function walletStatusBadgeClass(
  status: WalletStatus | "NONE" | undefined,
): string {
  switch (status) {
    case "ACTIVE":
      return "badge badge--success";
    case "RECOVERY_PENDING":
      return "badge badge--warning";
    case "RETIRING":
      return "badge badge--warning";
    case "RETIRED":
      return "badge badge--gray";
    default:
      return "badge badge--gray";
  }
}

export function walletStatusHint(status: WalletStatus): string {
  switch (status) {
    case "ACTIVE":
      return "정상 사용 가능. Share A+B로 일반 출금, Recovery File로 Share 복구 가능.";
    case "RECOVERY_PENDING":
      return "비상 복구 OTP 완료. B+C 전액 출금만 가능합니다.";
    case "RETIRING":
      return "비상 전액 출금 진행 중. 실패 시 재시도할 수 있습니다.";
    case "RETIRED":
      return "폐기됨. 이 지갑으로는 더 이상 서명·출금할 수 없습니다.";
  }
}

/** Normalize Nest / axios error payloads (STEP 10 filter shape). */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const anyErr = err as {
    response?: { data?: { message?: string | string[]; code?: string } };
    message?: string;
  };
  const raw = anyErr?.response?.data?.message ?? anyErr?.message ?? fallback;
  const message = Array.isArray(raw) ? raw.join(", ") : String(raw);
  const code = anyErr?.response?.data?.code;
  return code ? `${message} (${code})` : message;
}

export function shortAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatAuditEvent(eventType: string): string {
  const map: Record<string, string> = {
    MPC_WALLET_CREATED: "지갑 생성",
    RECOVERY_FILE_CREATED: "Recovery File 생성",
    BROWSER_SHARE_RECOVERED: "Browser Share 복구",
    EMERGENCY_OTP_FAILED: "비상 OTP 실패",
    EMERGENCY_RECOVERY_STARTED: "비상 복구 시작",
    EMERGENCY_RECOVERY_CANCELLED: "비상 복구 취소",
    EMERGENCY_WITHDRAW_REQUESTED: "비상 출금 요청",
    EMERGENCY_WITHDRAW_COMPLETED: "비상 출금 완료",
    EMERGENCY_WITHDRAW_FAILED: "비상 출금 실패",
    WALLET_RETIRED: "지갑 폐기",
    WITHDRAW_REQUESTED: "출금 요청",
    WITHDRAW_COMPLETED: "출금 완료",
  };
  return map[eventType] ?? eventType;
}
