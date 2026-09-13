import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const AUTHKIT_DOMAIN = "https://neat-comic-70-staging.authkit.app";
const RESOURCE_URL = "https://running-coach-mcp.vercel.app/api/mcp";

describe("GET /.well-known/oauth-protected-resource", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns correct protected resource metadata", async () => {
    vi.stubEnv("WORKOS_AUTHKIT_DOMAIN", AUTHKIT_DOMAIN);
    vi.stubEnv("MCP_RESOURCE_URL", RESOURCE_URL);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      resource: RESOURCE_URL,
      authorization_servers: [AUTHKIT_DOMAIN],
      bearer_methods_supported: ["header"],
    });
  });

  it("returns a 500 config error (not a crash) when OAuth env vars are missing", async () => {
    vi.stubEnv("WORKOS_AUTHKIT_DOMAIN", "");
    vi.stubEnv("MCP_RESOURCE_URL", "");

    const response = await GET();
    expect(response.status).toBe(500);
  });
});
