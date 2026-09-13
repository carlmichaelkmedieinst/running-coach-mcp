import { metadataCorsOptionsRequestHandler } from "mcp-handler";
import { NextResponse } from "next/server";

import { getWorkosAuthkitDomain } from "@/lib/auth/config";

/** Reasonable timeout for the upstream WorkOS metadata fetch. */
const UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414), proxied from WorkOS.
 *
 * Some MCP clients still probe authorization-server discovery directly
 * against the MCP host instead of following the protected resource
 * metadata's `authorization_servers` link. We proxy WorkOS's own metadata
 * verbatim rather than hand-maintaining a copy that could drift out of
 * sync.
 */
export async function GET() {
  let authkitDomain: string;

  try {
    authkitDomain = getWorkosAuthkitDomain();
  } catch {
    return NextResponse.json(
      { error: "server_error", message: "OAuth is not configured." },
      { status: 500 }
    );
  }

  try {
    const upstreamResponse = await fetch(
      `${authkitDomain}/.well-known/oauth-authorization-server`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      }
    );

    if (!upstreamResponse.ok) {
      return NextResponse.json(
        { error: "server_error", message: "Failed to fetch authorization server metadata." },
        { status: 502 }
      );
    }

    const metadata = await upstreamResponse.json();

    return NextResponse.json(metadata, {
      headers: { "Cache-Control": "max-age=3600" },
    });
  } catch {
    return NextResponse.json(
      { error: "server_error", message: "Failed to fetch authorization server metadata." },
      { status: 502 }
    );
  }
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
