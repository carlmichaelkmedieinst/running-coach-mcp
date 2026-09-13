import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("GET /api/health", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("responds successfully with no Authorization header at all (public endpoint)", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
  });

  it("reports intervalsConfigured/oauthConfigured as true when all required env vars are set, without leaking values", async () => {
    vi.stubEnv("INTERVALS_API_KEY", "super-secret-key");
    vi.stubEnv("INTERVALS_ATHLETE_ID", "12345");
    vi.stubEnv("WORKOS_AUTHKIT_DOMAIN", "https://neat-comic-70-staging.authkit.app");
    vi.stubEnv("MCP_RESOURCE_URL", "https://running-coach-mcp.vercel.app/api/mcp");
    vi.stubEnv("MCP_ALLOWED_USER_ID", "user_01ALLOWED123");

    const response = await GET();
    const body = await response.json();

    expect(body).toEqual({
      status: "ok",
      service: "running-coach-mcp",
      intervalsConfigured: true,
      oauthConfigured: true,
    });

    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain("super-secret-key");
    expect(bodyText).not.toContain("12345");
    expect(bodyText).not.toContain("user_01ALLOWED123");
  });

  it("reports oauthConfigured as false when any required OAuth env var is missing", async () => {
    vi.stubEnv("WORKOS_AUTHKIT_DOMAIN", "https://neat-comic-70-staging.authkit.app");
    vi.stubEnv("MCP_RESOURCE_URL", "");
    vi.stubEnv("MCP_ALLOWED_USER_ID", "");

    const response = await GET();
    const body = await response.json();

    expect(body.oauthConfigured).toBe(false);
  });

  it("reports intervalsConfigured as false when INTERVALS_API_KEY is missing", async () => {
    vi.stubEnv("INTERVALS_API_KEY", "");

    const response = await GET();
    const body = await response.json();

    expect(body.intervalsConfigured).toBe(false);
  });
});
