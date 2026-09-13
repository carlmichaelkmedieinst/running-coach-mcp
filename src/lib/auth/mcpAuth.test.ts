import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `jose` is mocked so tests never touch the network or need real WorkOS
// credentials. `jwtVerify` is the single seam that determines whether a
// token is treated as cryptographically valid.
const jwtVerifyMock = vi.fn();

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => "mock-jwks"),
  jwtVerify: (...args: unknown[]) => jwtVerifyMock(...args),
}));

const { withWorkosAuth } = await import("./mcpAuth");

const AUTHKIT_DOMAIN = "https://neat-comic-70-staging.authkit.app";
const RESOURCE_URL = "https://running-coach-mcp.vercel.app/api/mcp";
const ALLOWED_USER_ID = "user_01ALLOWED123";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request(RESOURCE_URL, { method: "POST", headers });
}

function makeInner() {
  return vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
}

function futureExp(): number {
  return Math.floor(Date.now() / 1000) + 3600;
}

describe("withWorkosAuth", () => {
  beforeEach(() => {
    jwtVerifyMock.mockReset();
    vi.stubEnv("WORKOS_AUTHKIT_DOMAIN", AUTHKIT_DOMAIN);
    vi.stubEnv("MCP_RESOURCE_URL", RESOURCE_URL);
    vi.stubEnv("MCP_ALLOWED_USER_ID", ALLOWED_USER_ID);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 401 with a WWW-Authenticate challenge when no Authorization header is present", async () => {
    const inner = makeInner();
    const response = await withWorkosAuth(inner)(makeRequest());

    expect(response.status).toBe(401);
    const challenge = response.headers.get("WWW-Authenticate");
    expect(challenge).toContain("Bearer");
    expect(challenge).toContain(
      'resource_metadata="https://running-coach-mcp.vercel.app/.well-known/oauth-protected-resource"'
    );
    expect(inner).not.toHaveBeenCalled();
  });

  it("returns 401 for a malformed bearer token", async () => {
    jwtVerifyMock.mockRejectedValue(new Error("Invalid Compact JWS"));
    const inner = makeInner();

    const response = await withWorkosAuth(inner)(
      makeRequest({ Authorization: "Bearer not-a-real-jwt" })
    );

    expect(response.status).toBe(401);
    expect(inner).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid signature", async () => {
    jwtVerifyMock.mockRejectedValue(new Error("signature verification failed"));
    const inner = makeInner();

    const response = await withWorkosAuth(inner)(
      makeRequest({ Authorization: "Bearer valid.looking.jwt" })
    );

    expect(response.status).toBe(401);
    expect(inner).not.toHaveBeenCalled();
  });

  it("returns 401 for a valid JWT with the wrong audience", async () => {
    jwtVerifyMock.mockRejectedValue(new Error('unexpected "aud" claim value'));
    const inner = makeInner();

    const response = await withWorkosAuth(inner)(
      makeRequest({ Authorization: "Bearer wrong-audience.jwt" })
    );

    expect(response.status).toBe(401);
    expect(inner).not.toHaveBeenCalled();
  });

  it("returns 401 for a valid JWT with the wrong issuer", async () => {
    jwtVerifyMock.mockRejectedValue(new Error('unexpected "iss" claim value'));
    const inner = makeInner();

    const response = await withWorkosAuth(inner)(
      makeRequest({ Authorization: "Bearer wrong-issuer.jwt" })
    );

    expect(response.status).toBe(401);
    expect(inner).not.toHaveBeenCalled();
  });

  it("returns 403 (without revealing the allowed subject) for a valid JWT with the wrong subject", async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: "user_someone_else", exp: futureExp() },
    });
    const inner = makeInner();

    const response = await withWorkosAuth(inner)(
      makeRequest({ Authorization: "Bearer valid.other-user.jwt" })
    );

    expect(response.status).toBe(403);
    const bodyText = await response.text();
    expect(bodyText).not.toContain(ALLOWED_USER_ID);
    expect(inner).not.toHaveBeenCalled();
  });

  it("fails closed with 403 when MCP_ALLOWED_USER_ID is not configured", async () => {
    vi.stubEnv("MCP_ALLOWED_USER_ID", "");
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: ALLOWED_USER_ID, exp: futureExp() },
    });
    const inner = makeInner();

    const response = await withWorkosAuth(inner)(
      makeRequest({ Authorization: "Bearer valid.jwt" })
    );

    expect(response.status).toBe(403);
    expect(inner).not.toHaveBeenCalled();
  });

  it("reaches the wrapped handler for a correctly authenticated and authorized request", async () => {
    jwtVerifyMock.mockResolvedValue({
      payload: { sub: ALLOWED_USER_ID, exp: futureExp() },
    });
    const inner = makeInner();

    const response = await withWorkosAuth(inner)(
      makeRequest({ Authorization: "Bearer valid.allowed-user.jwt" })
    );

    expect(inner).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("responds with a 500 config error (not a crash) when MCP_RESOURCE_URL is missing", async () => {
    vi.stubEnv("MCP_RESOURCE_URL", "");
    const inner = makeInner();

    const response = await withWorkosAuth(inner)(
      makeRequest({ Authorization: "Bearer valid.jwt" })
    );

    expect(response.status).toBe(500);
    expect(inner).not.toHaveBeenCalled();
  });
});
