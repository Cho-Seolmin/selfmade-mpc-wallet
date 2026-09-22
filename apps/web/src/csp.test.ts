import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const vercel = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../vercel.json"),
    "utf8",
  ),
) as {
  rewrites: unknown[];
  headers: Array<{
    source: string;
    headers: Array<{ key: string; value: string }>;
  }>;
};

describe("frontend CSP (vercel.json)", () => {
  const csp = vercel.headers
    .flatMap((entry) => entry.headers)
    .find((header) => header.key === "Content-Security-Policy")?.value;

  it("keeps the existing SPA rewrite", () => {
    expect(vercel.rewrites).toEqual([
      { source: "/(.*)", destination: "/index.html" },
    ]);
  });

  it("sets a restrictive CSP without unsafe-eval or unsafe-inline", () => {
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain(
      "connect-src 'self' https://api-production-7e18.up.railway.app",
    );
    expect(csp).not.toMatch(/(^|;)\s*'unsafe-eval'(\s|;|$)/);
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toMatch(/\*/);
  });
});
