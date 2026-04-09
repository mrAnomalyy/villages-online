import express from "express";
import cors from "cors";
import Redis from "ioredis";
import { z } from "zod";
import type { CreateCharacterRequest, GuestAuthRequest, GuestAuthResponse, RealmJoinTicket } from "@villages/shared";
import { pool, ensureRealmRows } from "./db";
import { registerOrResumeGuest, makeTicket } from "./auth";
import { getRealmById, realms } from "./realms";

const port = Number(process.env.PORT ?? 4000);
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 1
});

const app = express();
app.use(cors());
app.use(express.json());

const authSchema = z.object({
  nickname: z.string().min(3),
  existingToken: z.string().optional()
});

const createCharacterSchema = z.object({
  bodyType: z.enum(["male", "female"])
});

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
      error: error instanceof Error ? error.message : "Unknown readiness error"
    });
  }
});

app.get("/realms", (_req, res) => {
  res.json(realms);
});

app.post("/auth/guest", async (req, res) => {
  const parsed = authSchema.safeParse(req.body satisfies GuestAuthRequest);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.flatten() });
  }

  try {
    const guest = await registerOrResumeGuest(pool, parsed.data.nickname, parsed.data.existingToken);
    await redis.set(`session:${guest.playerId}`, guest.token, "EX", 60 * 60 * 24 * 14);
    const payload: GuestAuthResponse = guest;
    return res.json(payload);
  } catch (error) {
    return res.status(401).json({
      message: error instanceof Error ? error.message : "Unable to register guest"
    });
  }
});

app.get("/realms/:realmId/character", async (req, res) => {
  const realmId = req.params.realmId;
  const playerId = req.header("x-player-id");
  const token = req.header("x-player-token");
  if (!playerId || !token) {
    return res.status(401).json({ message: "Missing auth headers." });
  }

  const sessionToken = await redis.get(`session:${playerId}`);
  if (sessionToken !== token) {
    return res.status(401).json({ message: "Session not found." });
  }

  const result = await pool.query(
    `SELECT id, player_id, realm_id, nickname_snapshot, body_type, position_x, position_y, position_z
     FROM characters
     WHERE player_id = $1 AND realm_id = $2`,
    [playerId, realmId]
  );

  if (result.rowCount === 0) {
    return res.json(null);
  }

  return res.json({
    id: result.rows[0].id,
    playerId: result.rows[0].player_id,
    realmId: result.rows[0].realm_id,
    nickname: result.rows[0].nickname_snapshot,
    bodyType: result.rows[0].body_type,
    position: {
      x: Number(result.rows[0].position_x),
      y: Number(result.rows[0].position_y),
      z: Number(result.rows[0].position_z)
    }
  });
});

app.post("/realms/:realmId/characters", async (req, res) => {
  const realmId = req.params.realmId;
  const playerId = req.header("x-player-id");
  const token = req.header("x-player-token");
  if (!playerId || !token) {
    return res.status(401).json({ message: "Missing auth headers." });
  }

  const sessionToken = await redis.get(`session:${playerId}`);
  if (sessionToken !== token) {
    return res.status(401).json({ message: "Session not found." });
  }

  const parsed = createCharacterSchema.safeParse(req.body satisfies CreateCharacterRequest);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.flatten() });
  }

  const player = await pool.query<{ nickname: string }>("SELECT nickname FROM players WHERE id = $1", [playerId]);
  if (player.rowCount === 0) {
    return res.status(404).json({ message: "Player not found." });
  }

  const created = await pool.query(
    `INSERT INTO characters (
       id, player_id, realm_id, nickname_snapshot, body_type, position_x, position_y, position_z
     ) VALUES ($1, $2, $3, $4, $5, 8, 1, 8)
     ON CONFLICT (player_id, realm_id) DO UPDATE
     SET body_type = EXCLUDED.body_type
     RETURNING id, player_id, realm_id, nickname_snapshot, body_type, position_x, position_y, position_z`,
    [crypto.randomUUID(), playerId, realmId, player.rows[0].nickname, parsed.data.bodyType]
  );

  return res.status(201).json({
    id: created.rows[0].id,
    playerId: created.rows[0].player_id,
    realmId: created.rows[0].realm_id,
    nickname: created.rows[0].nickname_snapshot,
    bodyType: created.rows[0].body_type,
    position: {
      x: Number(created.rows[0].position_x),
      y: Number(created.rows[0].position_y),
      z: Number(created.rows[0].position_z)
    }
  });
});

app.post("/realms/:realmId/join", async (req, res) => {
  const realmId = req.params.realmId;
  const playerId = req.header("x-player-id");
  const token = req.header("x-player-token");
  if (!playerId || !token) {
    return res.status(401).json({ message: "Missing auth headers." });
  }

  const realm = getRealmById(realmId);
  if (!realm) {
    return res.status(404).json({ message: "Realm not found." });
  }

  const sessionToken = await redis.get(`session:${playerId}`);
  if (sessionToken !== token) {
    return res.status(401).json({ message: "Session not found." });
  }

  const character = await pool.query<{ id: string }>(
    "SELECT id FROM characters WHERE player_id = $1 AND realm_id = $2",
    [playerId, realmId]
  );
  if (character.rowCount === 0) {
    return res.status(400).json({ message: "Character not created yet." });
  }

  const ticket = makeTicket();
  await redis.set(
    `join:${ticket}`,
    JSON.stringify({
      playerId,
      realmId,
      characterId: character.rows[0].id
    }),
    "EX",
    60
  );

  const response: RealmJoinTicket = {
    ticket,
    realm,
    playerId,
    characterId: character.rows[0].id
  };
  return res.json(response);
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
