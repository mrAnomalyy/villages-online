import type { MapAsset, MapNpcDefinition, NpcBehavior, Vector3Like } from "@villages/shared";
import {
  cloneMapAsset,
  computeMapBounds,
  createEmptyChunk,
  getChunkCellSize,
  getChunkResolution,
  getChunkSampleStep,
} from "./map";

export type WorldBrushTarget = {
  worldX: number;
  worldZ: number;
  radius: number;
};

function clampIndex(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

function brushIntersectsChunk(
  worldX: number,
  worldZ: number,
  radius: number,
  map: MapAsset,
  chunk: MapAsset["chunks"][number]
): boolean {
  const minX = chunk.x * map.chunkSize;
  const minZ = chunk.z * map.chunkSize;
  const maxX = minX + chunk.size;
  const maxZ = minZ + chunk.size;
  const nearestX = Math.max(minX, Math.min(maxX, worldX));
  const nearestZ = Math.max(minZ, Math.min(maxZ, worldZ));
  return Math.hypot(nearestX - worldX, nearestZ - worldZ) <= radius;
}

function mapChunkCells(
  map: MapAsset,
  target: WorldBrushTarget,
  update: (
    value: number | boolean,
    row: number,
    column: number,
    chunk: MapAsset["chunks"][number]
  ) => number | boolean,
  key: "heights" | "water" | "surface"
): MapAsset {
  const next = cloneMapAsset(map);
  for (const chunk of next.chunks) {
    if (!brushIntersectsChunk(target.worldX, target.worldZ, target.radius, next, chunk)) {
      continue;
    }

    const resolution = getChunkResolution(chunk);
    const cellSize = getChunkCellSize(chunk);
    const chunkOriginX = chunk.x * next.chunkSize;
    const chunkOriginZ = chunk.z * next.chunkSize;
    const minColumn = clampIndex(
      Math.floor((target.worldX - target.radius - chunkOriginX) / cellSize),
      resolution - 1
    );
    const maxColumn = clampIndex(
      Math.ceil((target.worldX + target.radius - chunkOriginX) / cellSize),
      resolution - 1
    );
    const minRow = clampIndex(
      Math.floor((target.worldZ - target.radius - chunkOriginZ) / cellSize),
      resolution - 1
    );
    const maxRow = clampIndex(
      Math.ceil((target.worldZ + target.radius - chunkOriginZ) / cellSize),
      resolution - 1
    );

    if (key === "surface" && !chunk.surface) {
      chunk.surface = Array.from({ length: resolution }, () =>
        Array.from({ length: resolution }, () => 0)
      );
    }

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const sampleWorldX = chunkOriginX + (column + 0.5) * cellSize;
        const sampleWorldZ = chunkOriginZ + (row + 0.5) * cellSize;
        const distance = Math.hypot(sampleWorldX - target.worldX, sampleWorldZ - target.worldZ);
        if (distance > target.radius) {
          continue;
        }
        if (key === "heights") {
          chunk.heights[row][column] = update(
            chunk.heights[row][column],
            row,
            column,
            chunk
          ) as number;
        } else if (key === "water") {
          chunk.water[row][column] = update(
            chunk.water[row][column],
            row,
            column,
            chunk
          ) as boolean;
        } else if (key === "surface") {
          chunk.surface![row][column] = update(
            chunk.surface![row][column],
            row,
            column,
            chunk
          ) as number;
        }
      }
    }
  }

  next.bounds = computeMapBounds(next.chunks);
  return next;
}

function sculptChunkTerrain(
  chunk: MapAsset["chunks"][number],
  map: MapAsset,
  target: WorldBrushTarget & { delta: number; intensity: number }
): void {
  const radius = Math.max(0.8, target.radius + 0.6);
  const nextHeights = chunk.heights.map((row) => [...row]);
  const sampleStep = getChunkSampleStep(chunk);
  const chunkOriginX = chunk.x * map.chunkSize;
  const chunkOriginZ = chunk.z * map.chunkSize;
  const resolution = getChunkResolution(chunk);
  const minColumn = clampIndex(
    Math.floor((target.worldX - radius - chunkOriginX) / sampleStep),
    resolution - 1
  );
  const maxColumn = clampIndex(
    Math.ceil((target.worldX + radius - chunkOriginX) / sampleStep),
    resolution - 1
  );
  const minRow = clampIndex(
    Math.floor((target.worldZ - radius - chunkOriginZ) / sampleStep),
    resolution - 1
  );
  const maxRow = clampIndex(
    Math.ceil((target.worldZ + radius - chunkOriginZ) / sampleStep),
    resolution - 1
  );

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      const sampleX = chunkOriginX + column * sampleStep;
      const sampleZ = chunkOriginZ + row * sampleStep;
      const distance = Math.hypot(sampleX - target.worldX, sampleZ - target.worldZ);
      if (distance > radius) {
        continue;
      }

      const normalized = distance / radius;
      const falloff = Math.cos((normalized * Math.PI) / 2) ** 2;
      const amount = target.delta * target.intensity * falloff;
      nextHeights[row][column] = Math.max(
        0,
        Number((nextHeights[row][column] + amount).toFixed(2))
      );
    }
  }

  chunk.heights = nextHeights;
}

export function addChunk(map: MapAsset, x: number, z: number): MapAsset {
  if (map.chunks.some((chunk) => chunk.x === x && chunk.z === z)) {
    return cloneMapAsset(map);
  }

  const next = cloneMapAsset(map);
  next.chunks.push(createEmptyChunk(x, z, map.chunkSize, map.chunkResolution));
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
  target: WorldBrushTarget & { delta: number; intensity: number }
): MapAsset {
  const next = cloneMapAsset(map);
  for (const chunk of next.chunks) {
    if (brushIntersectsChunk(target.worldX, target.worldZ, target.radius + 0.6, next, chunk)) {
      sculptChunkTerrain(chunk, next, target);
    }
  }

  next.bounds = computeMapBounds(next.chunks);
  return next;
}

export function paintWater(map: MapAsset, target: WorldBrushTarget & { value: boolean }): MapAsset {
  return mapChunkCells(map, target, () => target.value, "water");
}

export function paintSurface(
  map: MapAsset,
  target: WorldBrushTarget & { materialId: number; opacity?: number; hardness?: number }
): MapAsset {
  const opacity = target.opacity ?? 1;
  const hardness = target.hardness ?? 1;

  return mapChunkCells(
    map,
    target,
    (currentVal, row, column, chunk) => {
      if (opacity < 1 || hardness < 1) {
        const cellSize = getChunkCellSize(chunk);
        const chunkOriginX = chunk.x * map.chunkSize;
        const chunkOriginZ = chunk.z * map.chunkSize;
        const sampleWorldX = chunkOriginX + (column + 0.5) * cellSize;
        const sampleWorldZ = chunkOriginZ + (row + 0.5) * cellSize;
        const dist = Math.hypot(sampleWorldX - target.worldX, sampleWorldZ - target.worldZ);
        const norm = target.radius > 0 ? dist / target.radius : 0;
        let factor = 1;
        if (norm > hardness) {
          factor = Math.max(0, (1 - norm) / Math.max(0.01, 1 - hardness));
        }
        const prob = factor * opacity;
        if (prob >= 1 || Math.random() < prob) {
          return target.materialId;
        }
        return currentVal;
      }
      return target.materialId;
    },
    "surface"
  );
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
