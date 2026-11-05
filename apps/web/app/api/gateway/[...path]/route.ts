import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const gatewayUrl = process.env.INTERNAL_GATEWAY_URL ?? "http://127.0.0.1:4000";

async function handleProxy(request: NextRequest, params: { path: string[] }) {
  const search = request.nextUrl.search || "";
  const targetUrl = `${gatewayUrl}/${params.path.join("/")}${search}`;
  const body =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();

  const response = await fetch(targetUrl, {
    method: request.method,
    headers: {
      "Content-Type": request.headers.get("content-type") ?? "application/json",
      Authorization: request.headers.get("authorization") ?? "",
      "x-player-id": request.headers.get("x-player-id") ?? "",
      "x-player-token": request.headers.get("x-player-token") ?? "",
    },
    body,
    cache: "no-store",
  });

  const responseBody = await response.text();
  return new NextResponse(responseBody, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "application/json",
    },
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return handleProxy(request, await context.params);
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return handleProxy(request, await context.params);
}
