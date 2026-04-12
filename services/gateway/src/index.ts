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
import { registerOrResumeGuest, makeTicket } from "./auth";
import { getRealmById, realms } from "./realms";

const port = Number(process.env.PORT ?? 4000);
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 1,
});

const app = express();
app.use(cors());
app.use(express.json());

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

  const result = await pool.query(
    `SELECT id, player_id, realm_id, nickname_snapshot, body_type, position_x, position_y, position_z
     FROM characters
     WHERE player_id = $1 AND realm_id = $2`,
    [auth.playerId, realmId]
  );

  if (result.rowCount === 0) {
    res.json(null);
    return;
  }

  res.json({
    id: result.rows[0].id,
    playerId: result.rows[0].player_id,
    realmId: result.rows[0].realm_id,
    nickname: result.rows[0].nickname_snapshot,
    bodyType: result.rows[0].body_type,
    position: {
      x: Number(result.rows[0].position_x),
      y: Number(result.rows[0].position_y),
      z: Number(result.rows[0].position_z),
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

  const created = await pool.query(
    `INSERT INTO characters (
       id, player_id, realm_id, nickname_snapshot, body_type, position_x, position_y, position_z
     ) VALUES ($1, $2, $3, $4, $5, 8, 1, 8)
     ON CONFLICT (player_id, realm_id) DO UPDATE
     SET body_type = EXCLUDED.body_type
     RETURNING id, player_id, realm_id, nickname_snapshot, body_type, position_x, position_y, position_z`,
    [crypto.randomUUID(), auth.playerId, realmId, player.rows[0].nickname, parsed.data.bodyType]
  );

  res.status(201).json({
    id: created.rows[0].id,
    playerId: created.rows[0].player_id,
    realmId: created.rows[0].realm_id,
    nickname: created.rows[0].nickname_snapshot,
    bodyType: created.rows[0].body_type,
    position: {
      x: Number(created.rows[0].position_x),
      y: Number(created.rows[0].position_y),
      z: Number(created.rows[0].position_z),
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

  const character = await pool.query<{ id: string }>(
    "SELECT id FROM characters WHERE player_id = $1 AND realm_id = $2",
    [auth.playerId, realmId]
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

async function start(): Promise<void> {
  await ensureRealmRows(realms);
  app.listen(port, () => {
    console.log(`[gateway] listening on ${port}`);
  });
}

start().catch((error) => {
  console.error("[gateway] failed to boot", error);
  process.exit(1);
});
