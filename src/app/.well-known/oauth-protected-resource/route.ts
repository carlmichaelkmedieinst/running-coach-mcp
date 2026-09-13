import { generateProtectedResourceMetadata, metadataCorsOptionsRequestHandler } from "mcp-handler";
import { NextResponse } from "next/server";

import { getMcpResourceUrl, getWorkosAuthkitDomain } from "@/lib/auth/config";

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) for `/api/mcp`.
 *
 * Tells MCP clients which Authorization Server(s) to use and how to send
 * the token. `resource` must exactly match the Resource Indicator
 * configured in WorkOS.
 */
export async function GET() {
  let resourceUrl: string;
  let authkitDomain: string;

  try {
    resourceUrl = getMcpResourceUrl();
    authkitDomain = getWorkosAuthkitDomain();
  } catch {
    return NextResponse.json(
      { error: "server_error", message: "OAuth is not configured." },
      { status: 500 }
    );
  }

  const metadata = generateProtectedResourceMetadata({
    authServerUrls: [authkitDomain],
    resourceUrl,
    additionalMetadata: {
      bearer_methods_supported: ["header"],
    },
  });

  return NextResponse.json(metadata, {
    headers: { "Cache-Control": "max-age=3600" },
  });
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
