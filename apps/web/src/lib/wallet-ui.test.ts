import { describe, expect, it } from "vitest";
import {
  apiErrorMessage,
  formatAuditEvent,
  walletStatusBadgeClass,
} from "./wallet-ui";

describe("wallet-ui helpers", () => {
  it("maps status to badge class", () => {
    expect(walletStatusBadgeClass("ACTIVE")).toContain("success");
    expect(walletStatusBadgeClass("RECOVERY_PENDING")).toContain("warning");
    expect(walletStatusBadgeClass("RETIRED")).toContain("gray");
  });

  it("formats known audit events", () => {
    expect(formatAuditEvent("WALLET_RETIRED")).toBe("지갑 폐기");
    expect(formatAuditEvent("CUSTOM_X")).toBe("CUSTOM_X");
  });

  it("includes error code from API payload", () => {
    expect(
      apiErrorMessage(
        { response: { data: { message: "폐기됨", code: "WALLET_RETIRED" } } },
        "fallback",
      ),
    ).toBe("폐기됨 (WALLET_RETIRED)");
  });

  it("shows INSUFFICIENT_GAS server copy without appending the code", () => {
    expect(
      apiErrorMessage(
        {
          response: {
            data: {
              message:
                "TTK 잔액이 있지만 가스비로 쓸 Sepolia ETH가 부족합니다. MPC 지갑 주소로 소량의 ETH를 입금한 뒤 비상 출금을 다시 시도하세요. 지갑은 폐기되지 않았습니다.",
              code: "INSUFFICIENT_GAS",
            },
          },
        },
        "fallback",
      ),
    ).toBe(
      "TTK 잔액이 있지만 가스비로 쓸 Sepolia ETH가 부족합니다. MPC 지갑 주소로 소량의 ETH를 입금한 뒤 비상 출금을 다시 시도하세요. 지갑은 폐기되지 않았습니다.",
    );
  });
});
