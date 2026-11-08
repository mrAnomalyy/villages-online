import { NextResponse } from "next/server";
import type { MapAsset } from "@villages/shared";
import { loadPublishedMapAsset, savePublishedMapAsset } from "@villages/world/asset-store";

const gatewayUrl = process.env.INTERNAL_GATEWAY_URL ?? "http://127.0.0.1:4000";

export async function GET() {
  try {
    const res = await fetch(`${gatewayUrl}/api/maps`, {
      cache: "no-store",
    });

    if (res.ok) {
      const data = (await res.json()) as Array<{
        id: string;
        name: string;
        owner_id: string | null;
        chunk_count?: number;
        chunkCount?: number;
        updated_at: string;
      }>;

      if (Array.isArray(data) && data.length > 0) {
        return NextResponse.json(data);
      }
    }
  } catch {
    // Gateway may be offline or starting up; use fallback
  }

  // Fallback default maps from asset-store
  try {
    const starter = loadPublishedMapAsset("starter-valley");
    return NextResponse.json([
      {
        id: starter.mapId,
        name: starter.name,
        owner_id: null,
        chunk_count: starter.chunks.length,
        chunkCount: starter.chunks.length,
        updated_at: new Date().toISOString(),
      },
    ]);
  } catch {
    return NextResponse.json([]);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { map?: unknown } | MapAsset;
    const mapData = ("map" in body && body.map ? body.map : body) as MapAsset;

    // First attempt to save to Gateway world_maps table
    try {
      const gatewayRes = await fetch(`${gatewayUrl}/api/maps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ map: mapData }),
      });

      if (gatewayRes.ok) {
        const payload = (await gatewayRes.json()) as { success: boolean; mapId: string };
        // Also persist locally to disk so published asset stays synchronized
        try {
          savePublishedMapAsset(mapData);
        } catch {
          // ignore disk save error if gateway succeeded
        }
        return NextResponse.json(payload, { status: gatewayRes.status });
      }
    } catch {
      // Gateway unreachable, fall back to disk save
    }

    const saved = savePublishedMapAsset(mapData);
    return NextResponse.json({
      success: true,
      mapId: saved.mapId,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save cloud map." },
      { status: 400 }
    );
  }
}
