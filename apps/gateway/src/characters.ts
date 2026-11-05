import crypto from "node:crypto";
import type { Request, Response, Router } from "express";
import express from "express";
import type { Pool } from "pg";
import { sanitizeNickname } from "@villages/shared";
import { hashToken } from "./auth";

import type { CharacterProfile, CharacterAppearance } from "@villages/shared";
export type { CharacterProfile, CharacterAppearance };

export function extractBearerToken(req: Request): string | null {
  const header = req.header("authorization") || req.header("Authorization");
  if (!header) {
    return null;
  }
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

export async function authenticateSession(
  pool: Pool,
  req: Request
): Promise<{ token: string; tokenHash: string; playerId?: string; nickname?: string } | null> {
  const token = extractBearerToken(req);
  if (!token) {
    return null;
  }

  const tokenHash = hashToken(token);

  // Check if player exists in players table (matching auth.ts)
  try {
    const playerResult = await pool.query<{ id: string; nickname: string }>(
      "SELECT id, nickname FROM players WHERE token_hash = $1",
      [tokenHash]
    );

    if (playerResult.rowCount && playerResult.rowCount > 0) {
      return {
        token,
        tokenHash,
        playerId: playerResult.rows[0].id,
        nickname: playerResult.rows[0].nickname,
      };
    }
  } catch {
    // If table query fails, fallback to character check
  }

  // Also check if any characters exist with this account_token_hash
  try {
    const charResult = await pool.query<{ id: string }>(
      "SELECT id FROM characters WHERE account_token_hash = $1 LIMIT 1",
      [tokenHash]
    );

    if (charResult.rowCount && charResult.rowCount > 0) {
      return {
        token,
        tokenHash,
      };
    }
  } catch {
    //
  }

  return null;
}

export function createCharactersRouter(pool: Pool): Router {
  const router = express.Router();

  // GET /api/characters/me: Requires Bearer session token authentication. Returns character profiles associated with the account.
  router.get("/me", async (req: Request, res: Response) => {
    const auth = await authenticateSession(pool, req);
    if (!auth) {
      res.status(401).json({ error: "Unauthorized: Invalid or missing Bearer session token." });
      return;
    }

    try {
      const result = await pool.query<{
        id: string;
        name: string;
        appearance: unknown;
        last_position: unknown;
        created_at: Date | string;
        updated_at: Date | string;
      }>(
        `SELECT id, name, appearance, last_position, created_at, updated_at
         FROM characters
         WHERE account_token_hash = $1
         ORDER BY created_at ASC`,
        [auth.tokenHash]
      );

      const profiles: CharacterProfile[] = result.rows.map((row) => {
        const appearance =
          typeof row.appearance === "string" ? JSON.parse(row.appearance) : (row.appearance ?? {});
        const lastPosition =
          typeof row.last_position === "string"
            ? JSON.parse(row.last_position)
            : (row.last_position ?? null);

        return {
          id: row.id,
          name: row.name,
          appearance,
          last_position: lastPosition,
          lastPosition,
          created_at: row.created_at,
          updated_at: row.updated_at,
        };
      });

      res.status(200).json(profiles);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to retrieve characters.",
      });
    }
  });

  // POST /api/characters: Create or update character (appearance customizations, nickname)
  router.post("/", async (req: Request, res: Response) => {
    const auth = await authenticateSession(pool, req);
    if (!auth) {
      res.status(401).json({ error: "Unauthorized: Invalid or missing Bearer session token." });
      return;
    }

    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      res.status(400).json({ error: "Invalid payload: request body must be an object." });
      return;
    }

    const rawName = req.body.name ?? req.body.nickname;
    if (typeof rawName !== "string" || rawName.trim().length === 0) {
      res.status(400).json({ error: "Character name or nickname is required." });
      return;
    }

    const name = sanitizeNickname(rawName);
    if (name.length < 1 || name.length > 64) {
      res.status(400).json({ error: "Character name must be between 1 and 64 characters." });
      return;
    }

    const appearance = req.body.appearance ?? {};
    if (typeof appearance !== "object" || appearance === null || Array.isArray(appearance)) {
      res.status(400).json({ error: "appearance must be an object." });
      return;
    }

    const lastPosition = req.body.lastPosition ?? req.body.last_position ?? null;
    if (
      lastPosition !== null &&
      (typeof lastPosition !== "object" || Array.isArray(lastPosition))
    ) {
      res.status(400).json({ error: "lastPosition must be an object or null." });
      return;
    }

    const requestedId =
      typeof req.body.id === "string" && req.body.id.trim().length > 0 ? req.body.id.trim() : null;

    if (req.body.id !== undefined && !requestedId) {
      res.status(400).json({ error: "id, if provided, must be a non-empty string." });
      return;
    }

    if (requestedId && requestedId.length > 64) {
      res.status(400).json({ error: "id exceeds maximum length of 64 characters." });
      return;
    }

    try {
      if (requestedId) {
        const existing = await pool.query<{ id: string; account_token_hash: string }>(
          "SELECT id, account_token_hash FROM characters WHERE id = $1",
          [requestedId]
        );

        if (existing.rowCount && existing.rowCount > 0) {
          if (existing.rows[0].account_token_hash !== auth.tokenHash) {
            res.status(403).json({ error: "Forbidden: You do not own this character." });
            return;
          }

          // Update existing
          const bodyType =
            typeof appearance === "object" && appearance !== null && "bodyType" in appearance
              ? String(appearance.bodyType)
              : null;
          const posObj = lastPosition && typeof lastPosition === "object" ? lastPosition : null;
          const posX = posObj && "x" in posObj ? Number(posObj.x) : null;
          const posY = posObj && "y" in posObj ? Number(posObj.y) : null;
          const posZ = posObj && "z" in posObj ? Number(posObj.z) : null;

          const updated = await pool.query<{
            id: string;
            name: string;
            appearance: unknown;
            last_position: unknown;
            created_at: Date | string;
            updated_at: Date | string;
          }>(
            `UPDATE characters
             SET name = $1,
                 nickname_snapshot = $1,
                 appearance = $2,
                 body_type = COALESCE($3, body_type),
                 last_position = COALESCE($4, last_position),
                 position_x = COALESCE($5, position_x),
                 position_y = COALESCE($6, position_y),
                 position_z = COALESCE($7, position_z),
                 player_id = COALESCE(player_id, $8),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $9 AND account_token_hash = $10
             RETURNING id, name, appearance, last_position, created_at, updated_at`,
            [
              name,
              JSON.stringify(appearance),
              bodyType,
              lastPosition ? JSON.stringify(lastPosition) : null,
              posX,
              posY,
              posZ,
              auth.playerId ?? null,
              requestedId,
              auth.tokenHash,
            ]
          );

          const row = updated.rows[0];
          const formattedProfile: CharacterProfile = {
            id: row.id,
            name: row.name,
            appearance:
              typeof row.appearance === "string"
                ? JSON.parse(row.appearance)
                : (row.appearance ?? {}),
            last_position:
              typeof row.last_position === "string"
                ? JSON.parse(row.last_position)
                : row.last_position,
            lastPosition:
              typeof row.last_position === "string"
                ? JSON.parse(row.last_position)
                : row.last_position,
            created_at: row.created_at,
            updated_at: row.updated_at,
          };

          res.status(200).json({
            success: true,
            characterId: row.id,
            id: row.id,
            character: formattedProfile,
          });
          return;
        }
      }

      // Create new character
      const characterId = requestedId ?? crypto.randomUUID();
      const bodyType =
        typeof appearance === "object" && appearance !== null && "bodyType" in appearance
          ? String(appearance.bodyType)
          : "male";
      const posObj = lastPosition && typeof lastPosition === "object" ? lastPosition : null;
      const posX = posObj && "x" in posObj ? Number(posObj.x) : 8;
      const posY = posObj && "y" in posObj ? Number(posObj.y) : 1;
      const posZ = posObj && "z" in posObj ? Number(posObj.z) : 8;

      const inserted = await pool.query<{
        id: string;
        name: string;
        appearance: unknown;
        last_position: unknown;
        created_at: Date | string;
        updated_at: Date | string;
      }>(
        `INSERT INTO characters (
           id, account_token_hash, name, appearance, last_position,
           player_id, nickname_snapshot, body_type, position_x, position_y, position_z, velocity_y,
           created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         RETURNING id, name, appearance, last_position, created_at, updated_at`,
        [
          characterId,
          auth.tokenHash,
          name,
          JSON.stringify(appearance),
          lastPosition ? JSON.stringify(lastPosition) : null,
          auth.playerId ?? null,
          name,
          bodyType,
          posX,
          posY,
          posZ,
        ]
      );

      const row = inserted.rows[0];
      const formattedProfile: CharacterProfile = {
        id: row.id,
        name: row.name,
        appearance:
          typeof row.appearance === "string" ? JSON.parse(row.appearance) : (row.appearance ?? {}),
        last_position:
          typeof row.last_position === "string" ? JSON.parse(row.last_position) : row.last_position,
        lastPosition:
          typeof row.last_position === "string" ? JSON.parse(row.last_position) : row.last_position,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };

      res.status(201).json({
        success: true,
        characterId: row.id,
        id: row.id,
        character: formattedProfile,
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to persist character.",
      });
    }
  });

  // GET /api/characters/:characterId: Retrieve character by ID
  router.get("/:characterId", async (req: Request, res: Response) => {
    const auth = await authenticateSession(pool, req);
    if (!auth) {
      res.status(401).json({ error: "Unauthorized: Invalid or missing Bearer session token." });
      return;
    }

    const rawCharId = req.params.characterId;
    const characterId = Array.isArray(rawCharId) ? rawCharId[0] : rawCharId;
    if (!characterId) {
      res.status(400).json({ error: "Missing characterId parameter." });
      return;
    }
    try {
      const result = await pool.query<{
        id: string;
        account_token_hash: string;
        name: string;
        appearance: unknown;
        last_position: unknown;
        created_at: Date | string;
        updated_at: Date | string;
      }>(
        `SELECT id, account_token_hash, name, appearance, last_position, created_at, updated_at
         FROM characters
         WHERE id = $1`,
        [characterId]
      );

      if (!result.rowCount || result.rowCount === 0) {
        res.status(404).json({ error: `Character '${characterId}' not found.` });
        return;
      }

      const row = result.rows[0];
      if (row.account_token_hash !== auth.tokenHash) {
        res.status(403).json({ error: "Forbidden: You do not own this character." });
        return;
      }

      res.status(200).json({
        id: row.id,
        name: row.name,
        appearance:
          typeof row.appearance === "string" ? JSON.parse(row.appearance) : (row.appearance ?? {}),
        last_position:
          typeof row.last_position === "string" ? JSON.parse(row.last_position) : row.last_position,
        lastPosition:
          typeof row.last_position === "string" ? JSON.parse(row.last_position) : row.last_position,
        created_at: row.created_at,
        updated_at: row.updated_at,
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to retrieve character.",
      });
    }
  });

  return router;
}
