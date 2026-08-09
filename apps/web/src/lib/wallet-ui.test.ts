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
});
