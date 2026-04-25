import type { MapAsset, MapNpcDefinition, NpcBehavior, Vector3Like } from "@villages/shared";
import { cloneMapAsset, computeMapBounds, createEmptyChunk, getChunkById } from "./map";

type ChunkCellTarget = {
  chunkId: string;
  row: number;
  column: number;
  radius: number;
};

function mapChunkCells(
  map: MapAsset,
  target: ChunkCellTarget,
  update: (value: number | boolean, row: number, column: number) => number | boolean,
  key: "heights" | "water"
): MapAsset {
  const next = cloneMapAsset(map);
  const chunk = getChunkById(next, target.chunkId);
  if (!chunk) {
    return next;
  }

  for (let row = 0; row < chunk.size; row += 1) {
    for (let column = 0; column < chunk.size; column += 1) {
      const distance = Math.hypot(column - target.column, row - target.row);
      if (distance > target.radius) {
        continue;
      }
      if (key === "heights") {
        chunk.heights[row][column] = update(chunk.heights[row][column], row, column) as number;
      } else {
        chunk.water[row][column] = update(chunk.water[row][column], row, column) as boolean;
      }
    }
  }

  next.bounds = computeMapBounds(next.chunks);
  return next;
}

export function addChunk(map: MapAsset, x: number, z: number): MapAsset {
  if (map.chunks.some((chunk) => chunk.x === x && chunk.z === z)) {
    return cloneMapAsset(map);
  }

  const next = cloneMapAsset(map);
  next.chunks.push(createEmptyChunk(x, z, map.chunkSize));
  next.chunks.sort((left, right) => left.z - right.z || left.x - right.x);
  next.bounds = computeMapBounds(next.chunks);
  return next;
}

export function removeChunk(map: MapAsset, chunkId: string): MapAsset {
  if (map.chunks.length === 1) {
    return cloneMapAsset(map);
  }

  const next = cloneMapAsset(map);
  next.chunks = next.chunks.filter((chunk) => chunk.id !== chunkId);
  next.bounds = computeMapBounds(next.chunks);
  return next;
}

export function sculptTerrain(
  map: MapAsset,
  target: ChunkCellTarget & { delta: number; intensity: number }
): MapAsset {
  return mapChunkCells(
    map,
    target,
    (value, row, column) => {
      const distance = Math.hypot(column - target.column, row - target.row);
      const falloff = Math.max(0.2, 1 - distance / Math.max(target.radius, 1));
      const nextHeight = Number(value) + target.delta * target.intensity * falloff;
      return Math.max(0, Number(nextHeight.toFixed(2)));
    },
    "heights"
  );
}

export function paintWater(
  map: MapAsset,
  target: ChunkCellTarget & { value: boolean }
): MapAsset {
  return mapChunkCells(map, target, () => target.value, "water");
}

export function createNpcDefinition(
  map: MapAsset,
  input?: Partial<MapNpcDefinition>
): { map: MapAsset; npc: MapNpcDefinition } {
  const next = cloneMapAsset(map);
  const npc: MapNpcDefinition = {
    id: input?.id ?? `npc-${next.npcs.length + 1}`,
    label: input?.label ?? `NPC ${next.npcs.length + 1}`,
    position: input?.position ?? { x: 8, y: 1, z: 8 },
    behavior: input?.behavior ?? { type: "standing" },
  };
  next.npcs.push(npc);
  return { map: next, npc };
}

export function updateNpcDefinition(
  map: MapAsset,
  npcId: string,
  patch: Partial<Omit<MapNpcDefinition, "behavior">> & { behavior?: NpcBehavior }
): MapAsset {
  const next = cloneMapAsset(map);
  next.npcs = next.npcs.map((npc) =>
    npc.id === npcId
      ? {
          ...npc,
          ...patch,
          position: patch.position ?? npc.position,
          behavior: patch.behavior ?? npc.behavior,
        }
      : npc
  );
  return next;
}

export function deleteNpcDefinition(map: MapAsset, npcId: string): MapAsset {
  const next = cloneMapAsset(map);
  next.npcs = next.npcs.filter((npc) => npc.id !== npcId);
  return next;
}

export function appendPatrolPoint(map: MapAsset, npcId: string, point: Vector3Like): MapAsset {
  const next = cloneMapAsset(map);
  next.npcs = next.npcs.map((npc) => {
    if (npc.id !== npcId) {
      return npc;
    }

    if (npc.behavior.type !== "patrol") {
      return {
        ...npc,
        behavior: {
          type: "patrol",
          points: [{ ...npc.position }, point],
        },
      };
    }

    return {
      ...npc,
      behavior: {
        type: "patrol",
        points: [...npc.behavior.points, point],
      },
    };
  });
  return next;
}

export function removePatrolPoint(map: MapAsset, npcId: string, index: number): MapAsset {
  const next = cloneMapAsset(map);
  next.npcs = next.npcs.map((npc) => {
    if (npc.id !== npcId || npc.behavior.type !== "patrol") {
      return npc;
    }

    const points = npc.behavior.points.filter((_, pointIndex) => pointIndex !== index);
    return {
      ...npc,
      behavior: points.length >= 2 ? { type: "patrol", points } : { type: "standing" },
    };
  });
  return next;
}
