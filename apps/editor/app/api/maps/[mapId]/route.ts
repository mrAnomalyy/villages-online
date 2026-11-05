import { NextResponse } from "next/server";
import type { MapAsset } from "@villages/shared";
import { loadPublishedMapAsset, savePublishedMapAsset } from "@villages/world/asset-store";

const gatewayUrl = process.env.INTERNAL_GATEWAY_URL ?? "http://127.0.0.1:4000";

export async function GET(_request: Request, context: { params: Promise<{ mapId: string }> }) {
  const { mapId } = await context.params;

  try {
    const gatewayRes = await fetch(`${gatewayUrl}/api/maps/${mapId}`, {
      cache: "no-store",
    });
    if (gatewayRes.ok) {
      const data = await gatewayRes.json();
      return NextResponse.json(data);
    }
  } catch {
    // Gateway offline, fallback
  }

  try {
    return NextResponse.json(loadPublishedMapAsset(mapId));
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Map load failed." },
      { status: 400 }
    );
  }
}

export async function PUT(request: Request, context: { params: Promise<{ mapId: string }> }) {
  const { mapId } = await context.params;

  try {
    const body = (await request.json()) as { map: unknown; action?: string };
    const parsed = savePublishedMapAsset({
      ...(body.map as MapAsset),
      mapId,
    });

    return NextResponse.json({
      action: body.action ?? "save",
      map: parsed,
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Map save failed." },
      { status: 400 }
    );
  }
}
