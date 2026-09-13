/**
 * Server-only configuration for protecting `/api/mcp` with WorkOS AuthKit
 * OAuth. Mirrors the pattern in `src/lib/intervals/auth.ts`: read from
 * `process.env`, throw helpful (secret-free) errors when a required value
 * is missing, and expose boolean "is configured" checks safe for
 * non-secret status endpoints like `/api/health`.
 */

/**
 * The WorkOS AuthKit domain acting as our OAuth Authorization Server, e.g.
 * `https://neat-comic-70-staging.authkit.app`.
 */
export function getWorkosAuthkitDomain(): string {
  const domain = process.env.WORKOS_AUTHKIT_DOMAIN;

  if (!domain || domain.trim().length === 0) {
    throw new Error("WORKOS_AUTHKIT_DOMAIN is not configured.");
  }

  return domain.replace(/\/$/, "");
}

/**
 * The MCP resource identifier (RFC 8707 resource indicator), e.g.
 * `https://running-coach-mcp.vercel.app/api/mcp`. Used both as the OAuth
 * `audience` access tokens must carry and as the `resource` value in our
 * protected resource metadata.
 */
export function getMcpResourceUrl(): string {
  const url = process.env.MCP_RESOURCE_URL;

  if (!url || url.trim().length === 0) {
    throw new Error("MCP_RESOURCE_URL is not configured.");
  }

  return url;
}

/**
 * Origin (scheme + host) of {@link getMcpResourceUrl}, e.g.
 * `https://running-coach-mcp.vercel.app`. Used to build discovery URLs
 * like `<origin>/.well-known/oauth-protected-resource`.
 */
export function getMcpResourceOrigin(): string {
  return new URL(getMcpResourceUrl()).origin;
}

/**
 * The single WorkOS user id (`sub` claim, e.g. `user_...`) allowed to use
 * this personal MCP server.
 *
 * Returns `null` when unset so callers can fail closed (deny everyone)
 * instead of accidentally authorizing any authenticated user. Never log
 * or expose this value.
 */
export function getAllowedUserId(): string | null {
  const userId = process.env.MCP_ALLOWED_USER_ID;

  if (!userId || userId.trim().length === 0) {
    return null;
  }

  return userId;
}

/**
 * Whether all environment variables required for OAuth protection are
 * present. Only a boolean — safe to expose via `/api/health`.
 */
export function isOAuthConfigured(): boolean {
  return Boolean(
    process.env.WORKOS_AUTHKIT_DOMAIN?.trim() &&
      process.env.MCP_RESOURCE_URL?.trim() &&
      process.env.MCP_ALLOWED_USER_ID?.trim()
  );
}
