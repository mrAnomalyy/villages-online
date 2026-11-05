import type { Request, Response, Router } from "express";
import express from "express";
import type { Pool } from "pg";
import type { MapAsset } from "@villages/shared";
import { parseMapAsset } from "@villages/world";
import { loadPublishedMapAsset } from "@villages/world/asset-store";

export interface MapSummary {
  id: string;
  name: string;
  owner_id: string | null;
  updated_at: string | Date;
}

export function createMapsRouter(pool: Pool): Router {
  const router = express.Router();

  // POST /api/maps: Save or update a map asset.
  // Validates JSON structure, stores in world_maps table, returns { success: true, mapId }
  router.post("/", async (req: Request, res: Response) => {
    try {
      const rawMap = req.body?.map ?? req.body;
      if (!rawMap || typeof rawMap !== "object") {
        res.status(400).json({ error: "Invalid map payload: body must be an object." });
        return;
      }

      let map: MapAsset;
      try {
        map = parseMapAsset(rawMap);
      } catch (validationError) {
        res.status(400).json({
          error:
            validationError instanceof Error
              ? validationError.message
              : "Invalid MapAsset structure.",
        });
        return;
      }

      if (map.mapId.length > 64) {
        res.status(400).json({ error: "mapId exceeds maximum length of 64 characters." });
        return;
      }

      if (map.name.length > 128) {
        res.status(400).json({ error: "name exceeds maximum length of 128 characters." });
        return;
      }

      const ownerId =
        typeof req.body?.ownerId === "string"
          ? req.body.ownerId.slice(0, 64)
          : typeof req.body?.owner_id === "string"
            ? req.body.owner_id.slice(0, 64)
            : null;

      const existing = await pool.query<{ id: string }>("SELECT id FROM world_maps WHERE id = $1", [
        map.mapId,
      ]);
      const isNew = existing.rowCount === 0;

      await pool.query(
        `INSERT INTO world_maps (id, name, owner_id, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name,
             owner_id = COALESCE(EXCLUDED.owner_id, world_maps.owner_id),
             data = EXCLUDED.data,
             updated_at = CURRENT_TIMESTAMP`,
        [map.mapId, map.name, ownerId, JSON.stringify(map)]
      );

      res.status(isNew ? 201 : 200).json({
        success: true,
        mapId: map.mapId,
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to save map asset.",
      });
    }
  });

  // GET /api/maps: List all available saved maps (id, name, owner_id, updated_at)
  router.get("/", async (_req: Request, res: Response) => {
    try {
      const result = await pool.query<{
        id: string;
        name: string;
        owner_id: string | null;
        updated_at: Date | string;
      }>(
        `SELECT id, name, owner_id, updated_at
         FROM world_maps
         ORDER BY updated_at DESC`
      );

      const summaries: MapSummary[] = result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        owner_id: row.owner_id,
        updated_at: row.updated_at,
      }));

      res.status(200).json(summaries);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to list maps.",
      });
    }
  });

  // GET /api/maps/:mapId: Retrieve a map by ID. If not found in database, check fallback starter maps (starter-valley).
  router.get("/:mapId", async (req: Request, res: Response) => {
    const rawMapId = req.params.mapId;
    const mapId = Array.isArray(rawMapId) ? rawMapId[0] : rawMapId;
    if (!mapId) {
      res.status(400).json({ error: "Missing mapId parameter." });
      return;
    }

    try {
      const result = await pool.query<{ data: unknown }>(
        "SELECT data FROM world_maps WHERE id = $1",
        [mapId]
      );

      if (result.rowCount && result.rowCount > 0) {
        const rawData = result.rows[0].data;
        const parsed = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
        res.status(200).json(parsed);
        return;
      }

      // Check fallback starter maps
      try {
        const fallback = loadPublishedMapAsset(mapId);
        res.status(200).json(fallback);
      } catch {
        res.status(404).json({
          error: `Map '${mapId}' not found in database or fallback starter maps.`,
        });
      }
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to retrieve map.",
      });
    }
  });

  return router;
}
