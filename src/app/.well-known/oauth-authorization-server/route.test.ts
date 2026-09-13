import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const AUTHKIT_DOMAIN = "https://neat-comic-70-staging.authkit.app";

describe("GET /.well-known/oauth-authorization-server", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv("WORKOS_AUTHKIT_DOMAIN", AUTHKIT_DOMAIN);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    global.fetch = originalFetch;
  });

  it("proxies valid upstream WorkOS metadata using cache: no-store", async () => {
    const upstreamMetadata = {
      issuer: AUTHKIT_DOMAIN,
      authorization_endpoint: `${AUTHKIT_DOMAIN}/oauth2/authorize`,
      token_endpoint: `${AUTHKIT_DOMAIN}/oauth2/token`,
    };

    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(init?.cache).toBe("no-store");
      return new Response(JSON.stringify(upstreamMetadata), { status: 200 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const response = await GET();
    const body = await response.json();

    expect(fetchMock).toHaveBeenCalledWith(
      `${AUTHKIT_DOMAIN}/.well-known/oauth-authorization-server`,
      expect.objectContaining({ cache: "no-store" })
    );
    expect(response.status).toBe(200);
    expect(body).toEqual(upstreamMetadata);
  });

  it("returns 502 when the upstream responds with an error status", async () => {
    global.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;

    const response = await GET();
    expect(response.status).toBe(502);
  });

  it("returns 502 (clean error, no crash) when the upstream request throws", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const response = await GET();
    expect(response.status).toBe(502);
  });

  it("returns 500 when WORKOS_AUTHKIT_DOMAIN is not configured", async () => {
    vi.stubEnv("WORKOS_AUTHKIT_DOMAIN", "");

    const response = await GET();
    expect(response.status).toBe(500);
  });
});
