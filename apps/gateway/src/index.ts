import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import Redis from "ioredis";
import { z } from "zod";
import type {
  CreateCharacterRequest,
  GuestAuthRequest,
  GuestAuthResponse,
  RealmJoinTicket,
} from "@villages/shared";
import { pool, ensureRealmRows } from "./db";
import { registerOrResumeGuest, makeTicket, hashToken } from "./auth";
import { getRealmById, realms } from "./realms";
import { createMapsRouter } from "./maps";
import { createCharactersRouter } from "./characters";

const port = Number(process.env.PORT ?? 4000);
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 1,
});

const app = express();
app.use(cors());
app.use(express.json());

// JSON syntax error handler to return JSON error responses instead of HTML
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

app.use("/api/maps", createMapsRouter(pool));
app.use("/api/characters", createCharactersRouter(pool));

const authSchema = z.object({
  nickname: z.string().min(3),
  existingToken: z.string().optional(),
});

const createCharacterSchema = z.object({
  bodyType: z.enum(["male", "female"]),
  characterId: z.string().optional(),
});

function getAuthHeaders(req: express.Request): { playerId: string; token: string } | null {
  const playerId = req.header("x-player-id");
  const token = req.header("x-player-token");

  if (!playerId || !token) {
    return null;
  }

  return { playerId, token };
}

async function validateSession(playerId: string, token: string): Promise<boolean> {
  const sessionToken = await redis.get(`session:${playerId}`);
  return sessionToken === token;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/ready", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    await redis.ping();
    res.json({ ok: true });
  } catch (error) {
    res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown readiness error",
    });
  }
});

app.get("/realms", (_req, res) => {
  res.json(realms);
});

app.post("/auth/guest", async (req, res) => {
  const parsed = authSchema.safeParse(req.body satisfies GuestAuthRequest);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.flatten() });
    return;
  }

  try {
    const guest = await registerOrResumeGuest(
      pool,
      parsed.data.nickname,
      parsed.data.existingToken
    );
    await redis.set(`session:${guest.playerId}`, guest.token, "EX", SESSION_TTL_SECONDS);
    const payload: GuestAuthResponse = guest;
    res.json(payload);
    return;
  } catch (error) {
    res.status(401).json({
      message: error instanceof Error ? error.message : "Unable to register guest",
    });
    return;
  }
});

app.get("/realms/:realmId/character", async (req, res) => {
  const realmId = req.params.realmId;
  const auth = getAuthHeaders(req);
  if (!auth) {
    res.status(401).json({ message: "Missing auth headers." });
    return;
  }

  if (!(await validateSession(auth.playerId, auth.token))) {
    res.status(401).json({ message: "Session not found." });
    return;
  }

  const tokenHash = hashToken(auth.token);
  const result = await pool.query(
    `SELECT id, player_id, realm_id, nickname_snapshot, body_type, position_x, position_y, position_z, velocity_y, name, appearance, last_position
     FROM characters
     WHERE account_token_hash = $1 OR player_id = $2`,
    [tokenHash, auth.playerId]
  );

  if (result.rowCount === 0) {
    res.json(null);
    return;
  }

  const row = result.rows[0];
  const appearance =
    typeof row.appearance === "string" ? JSON.parse(row.appearance) : (row.appearance ?? {});
  const lastPosition =
    typeof row.last_position === "string"
      ? JSON.parse(row.last_position)
      : (row.last_position ?? null);

  const posX =
    row.position_x !== null && row.position_x !== undefined
      ? Number(row.position_x)
      : lastPosition?.x !== null && lastPosition?.x !== undefined
        ? Number(lastPosition.x)
        : 8;
  const posY =
    row.position_y !== null && row.position_y !== undefined
      ? Number(row.position_y)
      : lastPosition?.y !== null && lastPosition?.y !== undefined
        ? Number(lastPosition.y)
        : 1;
  const posZ =
    row.position_z !== null && row.position_z !== undefined
      ? Number(row.position_z)
      : lastPosition?.z !== null && lastPosition?.z !== undefined
        ? Number(lastPosition.z)
        : 8;

  res.json({
    id: row.id,
    playerId: auth.playerId,
    realmId: row.realm_id ?? realmId,
    nickname: row.name ?? row.nickname_snapshot,
    bodyType: appearance.bodyType ?? row.body_type ?? "male",
    position: {
      x: posX,
      y: posY,
      z: posZ,
    },
  });
  return;
});

app.post("/realms/:realmId/characters", async (req, res) => {
  const realmId = req.params.realmId;
  const auth = getAuthHeaders(req);
  if (!auth) {
    res.status(401).json({ message: "Missing auth headers." });
    return;
  }

  if (!(await validateSession(auth.playerId, auth.token))) {
    res.status(401).json({ message: "Session not found." });
    return;
  }

  const parsed = createCharacterSchema.safeParse(req.body satisfies CreateCharacterRequest);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.flatten() });
    return;
  }

  const player = await pool.query<{ nickname: string }>(
    "SELECT nickname FROM players WHERE id = $1",
    [auth.playerId]
  );
  if (player.rowCount === 0) {
    res.status(404).json({ message: "Player not found." });
    return;
  }

  const tokenHash = hashToken(auth.token);
  const targetId = parsed.data.characterId;
  const existing = targetId
    ? await pool.query<{
        id: string;
        position_x: number | null;
        position_y: number | null;
        position_z: number | null;
        last_position: unknown;
        appearance: unknown;
      }>(
        `SELECT id, position_x, position_y, position_z, last_position, appearance
         FROM characters
         WHERE id = $1 AND (account_token_hash = $2 OR player_id = $3)`,
        [targetId, tokenHash, auth.playerId]
      )
    : await pool.query<{
        id: string;
        position_x: number | null;
        position_y: number | null;
        position_z: number | null;
        last_position: unknown;
        appearance: unknown;
      }>(
        `SELECT id, position_x, position_y, position_z, last_position, appearance
         FROM characters
         WHERE account_token_hash = $1 OR player_id = $2
         ORDER BY updated_at DESC LIMIT 1`,
        [tokenHash, auth.playerId]
      );

  let characterId = existing.rows[0]?.id;
  let posX = 8;
  let posY = 1;
  let posZ = 8;

  if (!characterId) {
    characterId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO characters (
         id, player_id, realm_id, nickname_snapshot, body_type,
         position_x, position_y, position_z, velocity_y,
         account_token_hash, name, appearance, last_position,
         created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        characterId,
        auth.playerId,
        realmId,
        player.rows[0].nickname,
        parsed.data.bodyType,
        8,
        1,
        8,
        0,
        tokenHash,
        player.rows[0].nickname,
        JSON.stringify({ bodyType: parsed.data.bodyType }),
        JSON.stringify({ x: 8, y: 1, z: 8 }),
      ]
    );
  } else {
    const existingRow = existing.rows[0];
    const existingLastPos =
      typeof existingRow.last_position === "string"
        ? JSON.parse(existingRow.last_position)
        : existingRow.last_position;

    posX =
      existingRow.position_x !== null && existingRow.position_x !== undefined
        ? Number(existingRow.position_x)
        : existingLastPos?.x !== null && existingLastPos?.x !== undefined
          ? Number(existingLastPos.x)
          : 8;
    posY =
      existingRow.position_y !== null && existingRow.position_y !== undefined
        ? Number(existingRow.position_y)
        : existingLastPos?.y !== null && existingLastPos?.y !== undefined
          ? Number(existingLastPos.y)
          : 1;
    posZ =
      existingRow.position_z !== null && existingRow.position_z !== undefined
        ? Number(existingRow.position_z)
        : existingLastPos?.z !== null && existingLastPos?.z !== undefined
          ? Number(existingLastPos.z)
          : 8;

    const existingAppearance =
      typeof existingRow.appearance === "string"
        ? JSON.parse(existingRow.appearance)
        : (existingRow.appearance ?? {});

    const mergedAppearance = {
      ...existingAppearance,
      bodyType: parsed.data.bodyType,
    };

    await pool.query(
      `UPDATE characters
       SET player_id = COALESCE(player_id, $1),
           realm_id = $2,
           nickname_snapshot = $3,
           body_type = $4,
           name = $3,
           appearance = $5,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6`,
      [
        auth.playerId,
        realmId,
        player.rows[0].nickname,
        parsed.data.bodyType,
        JSON.stringify(mergedAppearance),
        characterId,
      ]
    );
  }

  res.status(201).json({
    id: characterId,
    playerId: auth.playerId,
    realmId,
    nickname: player.rows[0].nickname,
    bodyType: parsed.data.bodyType,
    position: {
      x: posX,
      y: posY,
      z: posZ,
    },
  });
  return;
});

app.post("/realms/:realmId/join", async (req, res) => {
  const realmId = req.params.realmId;
  const auth = getAuthHeaders(req);
  if (!auth) {
    res.status(401).json({ message: "Missing auth headers." });
    return;
  }

  const realm = getRealmById(realmId);
  if (!realm) {
    res.status(404).json({ message: "Realm not found." });
    return;
  }

  if (!(await validateSession(auth.playerId, auth.token))) {
    res.status(401).json({ message: "Session not found." });
    return;
  }

  const tokenHash = hashToken(auth.token);
  const character = await pool.query<{ id: string }>(
    "SELECT id FROM characters WHERE account_token_hash = $1 OR player_id = $2",
    [tokenHash, auth.playerId]
  );
  if (character.rowCount === 0) {
    res.status(400).json({ message: "Character not created yet." });
    return;
  }

  await pool.query(
    "UPDATE characters SET realm_id = $1, player_id = COALESCE(player_id, $2) WHERE id = $3",
    [realmId, auth.playerId, character.rows[0].id]
  );

  const ticket = makeTicket();
  await redis.set(
    `join:${ticket}`,
    JSON.stringify({
      playerId: auth.playerId,
      realmId,
      characterId: character.rows[0].id,
    }),
    "EX",
    60
  );

  const response: RealmJoinTicket = {
    ticket,
    realm,
    playerId: auth.playerId,
    characterId: character.rows[0].id,
  };
  res.json(response);
  return;
});

export async function start(): Promise<void> {
  await ensureRealmRows(realms);
  app.listen(port, () => {
    console.log(`[gateway] listening on ${port}`);
  });
}

if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
  start().catch((error) => {
    console.error("[gateway] failed to boot", error);
    process.exit(1);
  });
}

export { app };
