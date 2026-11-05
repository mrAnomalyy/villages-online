import http from "node:http";
import { watchFile } from "node:fs";
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
import {
  getChunksAroundPosition,
  getHeightAt,
  getNeighborChunks,
  resolveChunkIdForPosition,
  TEST_MAP_ID,
} from "@villages/world";
import { getPublishedMapAssetPath, loadPublishedMapAsset } from "@villages/world/asset-store";
import { applyJump, applyMovement, createNpc, stepNpc, withChunk } from "./simulation";
import { get3x3ChunkIds, SpatialGrid } from "./spatial-grid";
import type { NpcEntity, PlayerEntity } from "./types";

const port = Number(process.env.PORT ?? 4101);
const realmId = process.env.REALM_ID ?? "alpha";
const realmName = process.env.REALM_NAME ?? "Alpha Realm";
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://villages:villages@127.0.0.1:5432/villages";
const mapId = process.env.MAP_ID ?? TEST_MAP_ID;
let worldMap = loadPublishedMapAsset(mapId);

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
const spatialGrid = new SpatialGrid();
const socketSubscribedEntities = new Map<string, Set<string>>();

function indexNpc(npc: NpcEntity): void {
  const chunkId = resolveChunkIdForPosition(npc.position.x, npc.position.z, worldMap.chunkSize);
  spatialGrid.update(npc.id, chunkId);
}

function indexPlayer(player: PlayerEntity): void {
  const chunkId = resolveChunkIdForPosition(
    player.position.x,
    player.position.z,
    worldMap.chunkSize
  );
  spatialGrid.update(player.id, chunkId);
}

let visibleNpcs = worldMap.npcs.map((npc) => createNpc(npc, worldMap));
for (const npc of visibleNpcs) {
  indexNpc(npc);
}

function asPlayerSnapshot(player: PlayerEntity) {
  return withChunk(
    {
      id: player.id,
      kind: "player" as const,
      label: player.label,
      bodyType: player.bodyType,
      position: player.position,
      velocityY: player.velocityY,
    },
    worldMap.chunkSize
  );
}

function broadcastSnapshots(): void {
  const allEntitySnapshots = new Map<string, ReturnType<typeof asPlayerSnapshot>>();
  for (const player of players.values()) {
    allEntitySnapshots.set(player.id, asPlayerSnapshot(player));
  }
  for (const npc of visibleNpcs) {
    allEntitySnapshots.set(
      npc.id,
      withChunk(
        {
          id: npc.id,
          kind: "npc" as const,
          label: npc.label,
          position: npc.position,
          velocityY: npc.velocityY,
        },
        worldMap.chunkSize
      )
    );
  }

  for (const [characterId, socket] of sockets.entries()) {
    if (socket.readyState !== WebSocket.OPEN) {
      continue;
    }
    const self = allEntitySnapshots.get(characterId);
    if (!self) {
      continue;
    }

    const playerChunkId = self.chunkId;
    const neighborChunkIds = get3x3ChunkIds(playerChunkId);
    const inRangeEntityIds = spatialGrid.getEntitiesInChunks(neighborChunkIds);
    inRangeEntityIds.delete(characterId);

    const prevSubscribed = socketSubscribedEntities.get(characterId) ?? new Set<string>();

    for (const prevId of prevSubscribed) {
      if (!inRangeEntityIds.has(prevId)) {
        const despawnPayload: ServerSocketMessage = {
          type: "entityDespawn",
          entityId: prevId,
        };
        socket.send(JSON.stringify(despawnPayload));
      }
    }

    const visibleEntities: ReturnType<typeof asPlayerSnapshot>[] = [];
    for (const entityId of inRangeEntityIds) {
      const entity = allEntitySnapshots.get(entityId);
      if (entity) {
        visibleEntities.push(entity);
      }
    }

    const payload: ServerSocketMessage = {
      type: "snapshot",
      self,
      entities: visibleEntities,
    };
    socket.send(JSON.stringify(payload));

    socketSubscribedEntities.set(characterId, inRangeEntityIds);
  }
}

function sendChunksForPlayer(player: PlayerEntity, socket: WebSocket): void {
  socket.send(
    JSON.stringify({
      type: "chunks",
      chunks: getChunksAroundPosition(worldMap, player.position.x, player.position.z),
    } satisfies ServerSocketMessage)
  );
}

function reloadWorldMap(): void {
  try {
    const nextMap = loadPublishedMapAsset(mapId);
    for (const npc of visibleNpcs) {
      spatialGrid.remove(npc.id);
    }
    worldMap = nextMap;
    visibleNpcs = worldMap.npcs.map((npc) => createNpc(npc, worldMap));
    for (const npc of visibleNpcs) {
      indexNpc(npc);
    }
    for (const player of players.values()) {
      indexPlayer(player);
    }

    for (const [characterId, socket] of sockets.entries()) {
      if (socket.readyState !== WebSocket.OPEN) {
        continue;
      }
      const player = players.get(characterId);
      if (player) {
        sendChunksForPlayer(player, socket);
      }
    }

    console.log(`[realm:${realmId}] reloaded map ${worldMap.mapId}`);
  } catch (error) {
    console.error(
      `[realm:${realmId}] map reload failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

watchFile(getPublishedMapAssetPath(mapId), { interval: 500 }, (current, previous) => {
  if (current.mtimeMs !== previous.mtimeMs || current.size !== previous.size) {
    reloadWorldMap();
  }
});

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
      indexPlayer(player);
      await redis.del(`join:${message.ticket}`);

      const playerSnapshot = asPlayerSnapshot(player);
      const neighborChunkIds = get3x3ChunkIds(playerSnapshot.chunkId);
      const inRangeEntityIds = spatialGrid.getEntitiesInChunks(neighborChunkIds);
      inRangeEntityIds.delete(player.id);

      const initialEntities: ReturnType<typeof asPlayerSnapshot>[] = [];
      for (const otherPlayer of players.values()) {
        if (otherPlayer.id !== player.id && inRangeEntityIds.has(otherPlayer.id)) {
          initialEntities.push(asPlayerSnapshot(otherPlayer));
        }
      }
      for (const npc of visibleNpcs) {
        if (inRangeEntityIds.has(npc.id)) {
          initialEntities.push(
            withChunk(
              {
                id: npc.id,
                kind: "npc",
                label: npc.label,
                position: npc.position,
                velocityY: npc.velocityY,
              },
              worldMap.chunkSize
            )
          );
        }
      }

      socketSubscribedEntities.set(player.id, inRangeEntityIds);

      const initial: InitialWorldPayload = {
        realmId,
        playerId: player.playerId,
        characterId: player.id,
        mapId: worldMap.mapId,
        chunks: getChunksAroundPosition(worldMap, player.position.x, player.position.z),
        player: playerSnapshot,
        entities: initialEntities,
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
      socket.send(
        JSON.stringify({
          type: "chunks",
          chunks: getNeighborChunks(worldMap, message.centerChunkId),
        } satisfies ServerSocketMessage)
      );
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
      spatialGrid.remove(currentCharacterId);
    }
    sockets.delete(currentCharacterId);
    socketSubscribedEntities.delete(currentCharacterId);
  });
});

setInterval(() => {
  const deltaSeconds = 1 / TICK_RATE;
  for (const player of players.values()) {
    applyMovement(player, deltaSeconds, worldMap);
    indexPlayer(player);
  }
  for (const npc of visibleNpcs) {
    stepNpc(npc, deltaSeconds, worldMap);
    indexNpc(npc);
  }
  broadcastSnapshots();
}, 1000 / TICK_RATE);

server.listen(port, () => {
  console.log(`[realm:${realmId}] listening on ${port}`);
});
