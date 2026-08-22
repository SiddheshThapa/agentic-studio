// Same-origin proxy: the browser calls this app's own /api/proxy/* instead of
// the FastAPI backend directly. Two things this buys, both real:
//
//   1. The backend's X-API-Key is attached here, server-side, from a
//      non-NEXT_PUBLIC env var — it never ships to the browser. Previously
//      NEXT_PUBLIC_API_KEY was effectively public (see CLAUDE.md).
//   2. The session cookie set by /auth/login is same-origin for the browser
//      even though the backend runs on a different port, so it's usable
//      without loosening it to SameSite=None or making it non-httpOnly.
//
// Generic on purpose: forwards method/headers/body and streams the response
// back untouched, so this one handler covers JSON calls, the PDF download,
// and the file upload (/ingest) without special-casing any of them.
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = (process.env.BACKEND_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
const BACKEND_KEY = process.env.BACKEND_API_KEY ?? "";

async function forward(req: NextRequest, path: string[]): Promise<NextResponse> {
  const url = `${BACKEND_URL}/${path.join("/")}${req.nextUrl.search}`;

  const headers = new Headers(req.headers);
  headers.delete("host");
  headers.delete("content-length");
  if (BACKEND_KEY) headers.set("x-api-key", BACKEND_KEY);

  let res: Response;
  try {
    res = await fetch(url, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
      // Required by Node's fetch when the request body is a stream.
      duplex: "half",
    } as RequestInit);
  } catch {
    return NextResponse.json({ detail: "Could not reach the backend." }, { status: 502 });
  }

  const responseHeaders = new Headers(res.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("set-cookie"); // re-added below, one at a time

  const out = new NextResponse(res.body, { status: res.status, headers: responseHeaders });
  for (const cookie of res.headers.getSetCookie?.() ?? []) {
    out.headers.append("set-cookie", cookie);
  }
  return out;
}

type RouteContext = { params: Promise<{ path: string[] }> };

/** Re-exported as GET/POST/PATCH/PUT/DELETE from each app's route.ts. */
export function createProxyHandlers() {
  const handler = async (req: NextRequest, ctx: RouteContext) => forward(req, (await ctx.params).path);
  return { GET: handler, POST: handler, PATCH: handler, PUT: handler, DELETE: handler };
}
