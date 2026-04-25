import http from "node:http";
import express from "express";
import Redis from "ioredis";
import { Pool } from "pg";
import { WebSocket, WebSocketServer } from "ws";
import {
  TICK_RATE,
  type ClientSocketMessage,
  type InitialWorldPayload,
  type ServerSocketMessage,
} from "@villages/shared";
import { getChunksAroundPosition, getHeightAt, getNeighborChunks, loadPublishedMapAsset, TEST_MAP_ID } from "@villages/world";
import { applyJump, applyMovement, createNpc, stepNpc, withChunk } from "./simulation";
import type { PlayerEntity } from "./types";

const port = Number(process.env.PORT ?? 4101);
const realmId = process.env.REALM_ID ?? "alpha";
const realmName = process.env.REALM_NAME ?? "Alpha Realm";
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://villages:villages@127.0.0.1:5432/villages";
const mapId = process.env.MAP_ID ?? TEST_MAP_ID;
const worldMap = loadPublishedMapAsset(mapId);

const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
const pool = new Pool({ connectionString: databaseUrl });

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, realmId, realmName });
});

app.get("/ready", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    await redis.ping();
    res.json({ ok: true, realmId });
  } catch (error) {
    res.status(503).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown readiness error",
    });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const players = new Map<string, PlayerEntity>();
const sockets = new Map<string, WebSocket>();
const visibleNpcs = worldMap.npcs.map((npc) => createNpc(npc, worldMap));

function asPlayerSnapshot(player: PlayerEntity) {
  return withChunk({
    id: player.id,
    kind: "player" as const,
    label: player.label,
    bodyType: player.bodyType,
    position: player.position,
    velocityY: player.velocityY,
  }, worldMap.chunkSize);
}

function broadcastSnapshots(): void {
  const entities = [
    ...Array.from(players.values()).map(asPlayerSnapshot),
    ...visibleNpcs.map((npc) =>
      withChunk({
        id: npc.id,
        kind: "npc" as const,
        label: npc.label,
        position: npc.position,
        velocityY: npc.velocityY,
      }, worldMap.chunkSize)
    ),
  ];

  for (const [characterId, socket] of sockets.entries()) {
    if (socket.readyState !== WebSocket.OPEN) {
      continue;
    }
    const self = entities.find((entity) => entity.id === characterId);
    if (!self) {
      continue;
    }
    const payload: ServerSocketMessage = {
      type: "snapshot",
      self,
      entities: entities.filter((entity) => entity.id !== characterId),
    };
    socket.send(JSON.stringify(payload));
  }
}

async function loadCharacter(characterId: string): Promise<PlayerEntity | null> {
  const result = await pool.query(
    `SELECT c.id, c.player_id, c.nickname_snapshot, c.body_type, c.position_x, c.position_y, c.position_z, c.velocity_y
     FROM characters c
     WHERE c.id = $1 AND c.realm_id = $2`,
    [characterId, realmId]
  );

  if (result.rowCount === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    playerId: row.player_id,
    label: row.nickname_snapshot,
    bodyType: row.body_type,
    position: {
      x: Number(row.position_x),
      y: getHeightAt(worldMap, Number(row.position_x), Number(row.position_z)) + 1,
      z: Number(row.position_z),
    },
    velocityY: Number(row.velocity_y),
    direction: { x: 0, z: 0 },
  };
}

async function persistCharacter(character: PlayerEntity): Promise<void> {
  await pool.query(
    `UPDATE characters
     SET position_x = $1, position_y = $2, position_z = $3, velocity_y = $4, updated_at = NOW()
     WHERE id = $5`,
    [
      character.position.x,
      character.position.y,
      character.position.z,
      character.velocityY,
      character.id,
    ]
  );
}

wss.on("connection", (socket) => {
  let currentCharacterId: string | null = null;

  socket.on("message", async (raw) => {
    const message = JSON.parse(String(raw)) as ClientSocketMessage;
    if (message.type === "hello") {
      const joinValue = await redis.get(`join:${message.ticket}`);
      if (!joinValue) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Join ticket expired.",
          } satisfies ServerSocketMessage)
        );
        socket.close();
        return;
      }

      const join = JSON.parse(joinValue) as {
        playerId: string;
        realmId: string;
        characterId: string;
      };
      if (join.realmId !== realmId) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Ticket is for another realm.",
          } satisfies ServerSocketMessage)
        );
        socket.close();
        return;
      }

      const player = await loadCharacter(join.characterId);
      if (!player) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Character not found.",
          } satisfies ServerSocketMessage)
        );
        socket.close();
        return;
      }

      players.set(player.id, player);
      sockets.set(player.id, socket);
      currentCharacterId = player.id;
      await redis.del(`join:${message.ticket}`);

      const initial: InitialWorldPayload = {
        realmId,
        playerId: player.playerId,
        characterId: player.id,
        mapId: worldMap.mapId,
        chunks: getChunksAroundPosition(worldMap, player.position.x, player.position.z),
        player: asPlayerSnapshot(player),
        entities: [
          ...Array.from(players.values())
            .filter((otherPlayer) => otherPlayer.id !== player.id)
            .map(asPlayerSnapshot),
          ...visibleNpcs.map((npc) =>
            withChunk({
              id: npc.id,
              kind: "npc",
              label: npc.label,
              position: npc.position,
              velocityY: npc.velocityY,
            }, worldMap.chunkSize)
          ),
        ],
      };
      socket.send(
        JSON.stringify({ type: "welcome", payload: initial } satisfies ServerSocketMessage)
      );
      return;
    }

    if (!currentCharacterId) {
      return;
    }

    const player = players.get(currentCharacterId);
    if (!player) {
      return;
    }

    if (message.type === "move") {
      player.direction = message.direction;
      return;
    }

    if (message.type === "jump") {
      applyJump(player, worldMap);
      return;
    }

    if (message.type === "subscribeChunks") {
      const chunks = getNeighborChunks(worldMap, message.centerChunkId);
      socket.send(JSON.stringify({ type: "chunks", chunks } satisfies ServerSocketMessage));
    }
  });

  socket.on("close", async () => {
    if (!currentCharacterId) {
      return;
    }
    const character = players.get(currentCharacterId);
    if (character) {
      await persistCharacter(character);
      players.delete(currentCharacterId);
    }
    sockets.delete(currentCharacterId);
  });
});

setInterval(() => {
  const deltaSeconds = 1 / TICK_RATE;
  for (const player of players.values()) {
    applyMovement(player, deltaSeconds, worldMap);
  }
  for (const npc of visibleNpcs) {
    stepNpc(npc, deltaSeconds, worldMap);
  }
  broadcastSnapshots();
}, 1000 / TICK_RATE);

server.listen(port, () => {
  console.log(`[realm:${realmId}] listening on ${port}`);
});
