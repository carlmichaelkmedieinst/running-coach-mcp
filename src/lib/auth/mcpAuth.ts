/**
 * WorkOS OAuth protection for the MCP endpoint.
 *
 * Composes `mcp-handler`'s `withMcpAuth` (standards-compliant bearer-token
 * gate: parses `Authorization: Bearer ...`, issues RFC 9728
 * `WWW-Authenticate` challenges on failure) with our own WorkOS access
 * token verification and single-user authorization check.
 *
 * Our Next.js app is the OAuth *Resource Server* only — WorkOS AuthKit is
 * the Authorization Server. We never issue tokens, never accept a static
 * shared secret, and never forward WorkOS tokens to Intervals.icu (which
 * has its own, independent, server-only credential — see
 * `src/lib/intervals/auth.ts`).
 */

import type { AuthInfo } from "@modelcontextprotocol/server";
import { withMcpAuth } from "mcp-handler";

import { getAllowedUserId, getMcpResourceOrigin } from "./config";
import { verifyWorkosAccessToken } from "./verifyAccessToken";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 403 with no detail about the allow-listed user — never reveal it. */
function forbiddenResponse(): Response {
  return jsonResponse({ error: "forbidden" }, 403);
}

/** 500 for server-side misconfiguration (distinct from 401/403 auth outcomes). */
function configurationErrorResponse(): Response {
  return jsonResponse({ error: "server_error", message: "OAuth is not configured." }, 500);
}

/**
 * Verifies the bearer token against WorkOS's JWKS (signature, issuer,
 * audience) and maps it to an `AuthInfo` for `mcp-handler`. Returning
 * `undefined` (or throwing) causes `withMcpAuth` to answer 401.
 */
async function verifyToken(_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  if (!bearerToken) {
    return undefined;
  }

  const payload = await verifyWorkosAccessToken(bearerToken);

  const subject = typeof payload.sub === "string" ? payload.sub : undefined;
  const clientId =
    typeof payload.client_id === "string"
      ? payload.client_id
      : typeof payload.azp === "string"
        ? payload.azp
        : (subject ?? "unknown");
  const scopes =
    typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [];

  return {
    token: bearerToken,
    clientId,
    scopes,
    expiresAt: payload.exp,
    // `sub` is carried in `extra` (not a standard AuthInfo field) so the
    // single-user check below can read it back off `req.auth`.
    extra: { sub: subject },
  };
}

/** This server is personal: only one WorkOS user id may ever be authorized. */
function isAuthorizedSubject(subject: string | undefined): boolean {
  const allowedUserId = getAllowedUserId();

  // Fail closed: with no allow-listed user configured, nobody is authorized.
  if (!allowedUserId) {
    return false;
  }

  return Boolean(subject) && subject === allowedUserId;
}

/**
 * Wraps an MCP route handler with WorkOS bearer-token verification and
 * single-user authorization.
 *
 * - No / malformed / invalid / expired token -> 401, with a
 *   `WWW-Authenticate: Bearer ...` challenge referencing
 *   `/.well-known/oauth-protected-resource`.
 * - Valid token, but `sub` isn't the allow-listed user (or none is
 *   configured) -> 403, without revealing the allowed subject.
 * - Valid token and authorized subject -> delegates to `handler`.
 */
export function withWorkosAuth(
  handler: (req: Request) => Response | Promise<Response>
): (req: Request) => Promise<Response> {
  let resourceOrigin: string;

  try {
    resourceOrigin = getMcpResourceOrigin();
  } catch {
    // Fail closed rather than throwing at module-load time, which would
    // take down the whole route.
    return async () => configurationErrorResponse();
  }

  return withMcpAuth(
    async (req) => {
      const subject = req.auth?.extra?.sub as string | undefined;

      if (!isAuthorizedSubject(subject)) {
        return forbiddenResponse();
      }

      return handler(req);
    },
    verifyToken,
    {
      required: true,
      resourceUrl: resourceOrigin,
    }
  );
}
