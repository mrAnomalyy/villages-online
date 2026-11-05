import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MapAsset } from "@villages/shared";
import type { MapSummary } from "./maps";
import { createMapsRouter } from "./maps";

describe("Maps API (/api/maps)", () => {
  let server: http.Server;
  let baseUrl: string;
  let mockQuery: ReturnType<typeof vi.fn>;

  const sampleMap: MapAsset = {
    version: 1,
    mapId: "test-valley",
    name: "Test Valley",
    chunkSize: 128,
    chunkResolution: 64,
    waterLevel: 0,
    bounds: { minChunkX: 0, maxChunkX: 0, minChunkZ: 0, maxChunkZ: 0 },
    chunks: [
      {
        id: "0:0",
        x: 0,
        z: 0,
        size: 128,
        resolution: 64,
        heights: Array.from({ length: 64 }, () => Array.from({ length: 64 }, () => 1)),
        water: Array.from({ length: 64 }, () => Array.from({ length: 64 }, () => false)),
      },
    ],
    npcs: [],
  };

  beforeAll(async () => {
    mockQuery = vi.fn();
    const mockPool = { query: mockQuery } as unknown as Pool;

    const app = express();
    app.use(express.json());
    app.use("/api/maps", createMapsRouter(mockPool));
    app.use(
      (err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (
          err instanceof SyntaxError ||
          (typeof err === "object" &&
            err !== null &&
            "status" in err &&
            (err as { status: unknown }).status === 400)
        ) {
          res.status(400).json({ error: "Malformed or invalid JSON payload." });
          return;
        }
        next(err);
      }
    );

    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}/api/maps`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe("POST /api/maps", () => {
    it("creates a new map and returns 201 with success: true and mapId", async () => {
      // First query checks if map exists
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      // Second query performs insert
      mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: sampleMap.mapId }] });

      const res = await fetch(baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sampleMap),
      });

      expect([200, 201]).toContain(res.status);
      const data = (await res.json()) as { success: boolean; mapId: string };
      expect(data.success).toBe(true);
      expect(data.mapId).toBe(sampleMap.mapId);
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it("updates an existing map and returns 200 with success: true", async () => {
      // First query finds existing row
      mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: sampleMap.mapId }] });
      // Second query performs update
      mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: sampleMap.mapId }] });

      const res = await fetch(baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sampleMap),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as { success: boolean; mapId: string };
      expect(data.success).toBe(true);
      expect(data.mapId).toBe(sampleMap.mapId);
    });

    it("accepts map payload wrapped inside { map: ... }", async () => {
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: sampleMap.mapId }] });

      const res = await fetch(baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ map: sampleMap, ownerId: "user-123" }),
      });

      expect([200, 201]).toContain(res.status);
      const data = (await res.json()) as { success: boolean; mapId: string };
      expect(data.success).toBe(true);
      expect(data.mapId).toBe(sampleMap.mapId);
    });

    it("returns 400 when body is not an object or empty", async () => {
      const res = await fetch(baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify("not-an-object"),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBeDefined();
    });

    it("returns 400 when map asset structure is invalid (missing chunks)", async () => {
      const invalidMap = { ...sampleMap, chunks: [] };

      const res = await fetch(baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invalidMap),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBeDefined();
    });

    it("returns 400 when mapId exceeds 64 characters", async () => {
      const longIdMap = { ...sampleMap, mapId: "a".repeat(65) };

      const res = await fetch(baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(longIdMap),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("mapId");
    });

    it("returns 400 when map name exceeds 128 characters", async () => {
      const longNameMap = { ...sampleMap, name: "n".repeat(129) };

      const res = await fetch(baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(longNameMap),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("name");
    });
  });

  describe("GET /api/maps/:mapId", () => {
    it("returns 200 with map data when found in database", async () => {
      mockQuery.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ data: JSON.stringify(sampleMap) }],
      });

      const res = await fetch(`${baseUrl}/${sampleMap.mapId}`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as MapAsset;
      expect(data.mapId).toBe(sampleMap.mapId);
      expect(data.name).toBe(sampleMap.name);
    });

    it("falls back to starter-valley when not found in database", async () => {
      mockQuery.mockResolvedValueOnce({
        rowCount: 0,
        rows: [],
      });

      const res = await fetch(`${baseUrl}/starter-valley`);
      expect(res.status).toBe(200);
      const data = (await res.json()) as MapAsset;
      expect(data.mapId).toBe("starter-valley");
      expect(data.chunks.length).toBeGreaterThan(0);
    });

    it("returns 404 when map is not in database and not in fallback starter maps", async () => {
      mockQuery.mockResolvedValueOnce({
        rowCount: 0,
        rows: [],
      });

      const res = await fetch(`${baseUrl}/non-existent-map-xyz`);
      expect(res.status).toBe(404);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBeDefined();
    });
  });

  describe("GET /api/maps", () => {
    it("returns 200 with list of saved maps", async () => {
      const rows = [
        {
          id: "map-1",
          name: "Map 1",
          owner_id: "user-1",
          chunk_count: 4,
          updated_at: new Date("2026-11-05T00:00:00Z").toISOString(),
        },
        {
          id: "map-2",
          name: "Map 2",
          owner_id: null,
          chunk_count: 1,
          updated_at: new Date("2026-11-04T00:00:00Z").toISOString(),
        },
      ];

      mockQuery.mockResolvedValueOnce({
        rowCount: rows.length,
        rows,
      });

      const res = await fetch(baseUrl);
      expect(res.status).toBe(200);
      const data = (await res.json()) as (MapSummary & { chunkCount?: number })[];
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(2);
      expect(data[0].id).toBe("map-1");
      expect(data[0].name).toBe("Map 1");
      expect(data[0].owner_id).toBe("user-1");
      expect(data[0].chunkCount).toBe(4);
      expect(data[1].owner_id).toBeNull();
      expect(data[1].chunkCount).toBe(1);
    });

    it("returns 200 with empty array when no maps saved", async () => {
      mockQuery.mockResolvedValueOnce({
        rowCount: 0,
        rows: [],
      });

      const res = await fetch(baseUrl);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(0);
    });
  });
});
