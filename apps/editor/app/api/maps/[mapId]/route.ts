import { NextResponse } from "next/server";
import type { MapAsset } from "@villages/shared";
import { loadPublishedMapAsset, savePublishedMapAsset } from "@villages/world/asset-store";

export async function GET(_request: Request, context: { params: Promise<{ mapId: string }> }) {
  const { mapId } = await context.params;
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
