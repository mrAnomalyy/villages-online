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
    `SELECT id, name, appearance, last_position
     FROM characters
     WHERE account_token_hash = $1`,
    [tokenHash]
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
      : (row.last_position ?? { x: 8, y: 1, z: 8 });

  res.json({
    id: row.id,
    playerId: auth.playerId,
    realmId,
    nickname: row.name,
    bodyType: appearance.bodyType ?? "male",
    position: {
      x: Number(lastPosition.x ?? 8),
      y: Number(lastPosition.y ?? 1),
      z: Number(lastPosition.z ?? 8),
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
  const existing = await pool.query<{ id: string }>(
    "SELECT id FROM characters WHERE account_token_hash = $1",
    [tokenHash]
  );

  let characterId = existing.rows[0]?.id;
  if (!characterId) {
    characterId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO characters (id, account_token_hash, name, appearance, last_position, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        characterId,
        tokenHash,
        player.rows[0].nickname,
        JSON.stringify({ bodyType: parsed.data.bodyType }),
        JSON.stringify({ x: 8, y: 1, z: 8 }),
      ]
    );
  } else {
    await pool.query(
      `UPDATE characters
       SET appearance = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND account_token_hash = $3`,
      [JSON.stringify({ bodyType: parsed.data.bodyType }), characterId, tokenHash]
    );
  }

  res.status(201).json({
    id: characterId,
    playerId: auth.playerId,
    realmId,
    nickname: player.rows[0].nickname,
    bodyType: parsed.data.bodyType,
    position: {
      x: 8,
      y: 1,
      z: 8,
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
    "SELECT id FROM characters WHERE account_token_hash = $1",
    [tokenHash]
  );
  if (character.rowCount === 0) {
    res.status(400).json({ message: "Character not created yet." });
    return;
  }

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
