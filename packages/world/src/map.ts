import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CHUNK_SIZE, type MapAsset, type MapNpcDefinition, type TerrainChunkDTO } from "@villages/shared";

export const TEST_MAP_ID = "starter-valley";
export const MAP_ASSET_VERSION = 1;

const assetDirectory = fileURLToPath(new URL("../assets", import.meta.url));

export function getChunkId(x: number, z: number): string {
  return `${x}:${z}`;
}

export function createWaterMask(size: number, fill = false): boolean[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => fill));
}

export function createEmptyChunk(
  x: number,
  z: number,
  size: number,
  height = 1
): TerrainChunkDTO {
  return {
    id: getChunkId(x, z),
    x,
    z,
    size,
    heights: Array.from({ length: size }, () => Array.from({ length: size }, () => height)),
    water: createWaterMask(size),
  };
}

export function computeMapBounds(chunks: TerrainChunkDTO[]): MapAsset["bounds"] {
  const xs = chunks.map((chunk) => chunk.x);
  const zs = chunks.map((chunk) => chunk.z);

  return {
    minChunkX: Math.min(...xs),
    maxChunkX: Math.max(...xs),
    minChunkZ: Math.min(...zs),
    maxChunkZ: Math.max(...zs),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`${label} must be a number.`);
  }

  return value;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function parseVector3Like(value: unknown, label: string) {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return {
    x: asNumber(value.x, `${label}.x`),
    y: asNumber(value.y, `${label}.y`),
    z: asNumber(value.z, `${label}.z`),
  };
}

function parseMatrix<T extends number | boolean>(
  value: unknown,
  size: number,
  label: string,
  parser: (entry: unknown, entryLabel: string) => T
): T[][] {
  if (!Array.isArray(value) || value.length !== size) {
    throw new Error(`${label} must have ${size} rows.`);
  }

  return value.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== size) {
      throw new Error(`${label}[${rowIndex}] must have ${size} columns.`);
    }

    return row.map((entry, columnIndex) =>
      parser(entry, `${label}[${rowIndex}][${columnIndex}]`)
    );
  });
}

function parseChunk(value: unknown, chunkSize: number): TerrainChunkDTO {
  if (!isRecord(value)) {
    throw new Error("chunk must be an object.");
  }

  const x = asNumber(value.x, "chunk.x");
  const z = asNumber(value.z, "chunk.z");
  const size = asNumber(value.size, "chunk.size");
  if (size !== chunkSize) {
    throw new Error(`chunk ${x}:${z} size must match map chunk size ${chunkSize}.`);
  }

  const heights = parseMatrix(value.heights, size, `chunk ${x}:${z} heights`, asNumber);
  const water = parseMatrix(value.water, size, `chunk ${x}:${z} water`, (entry, entryLabel) => {
    if (typeof entry !== "boolean") {
      throw new Error(`${entryLabel} must be boolean.`);
    }
    return entry;
  });

  return {
    id: asString(value.id, "chunk.id"),
    x,
    z,
    size,
    heights,
    water,
  };
}

function parseNpc(value: unknown): MapNpcDefinition {
  if (!isRecord(value)) {
    throw new Error("npc must be an object.");
  }

  const behavior = value.behavior;
  if (!isRecord(behavior)) {
    throw new Error("npc.behavior must be an object.");
  }

  const behaviorType = asString(behavior.type, "npc.behavior.type");
  if (behaviorType === "standing") {
    return {
      id: asString(value.id, "npc.id"),
      label: asString(value.label, "npc.label"),
      position: parseVector3Like(value.position, "npc.position"),
      behavior: { type: "standing" },
    };
  }

  if (behaviorType === "patrol") {
    if (!Array.isArray(behavior.points) || behavior.points.length < 2) {
      throw new Error("npc.behavior.points must contain at least two patrol points.");
    }

    return {
      id: asString(value.id, "npc.id"),
      label: asString(value.label, "npc.label"),
      position: parseVector3Like(value.position, "npc.position"),
      behavior: {
        type: "patrol",
        points: behavior.points.map((point, index) =>
          parseVector3Like(point, `npc.behavior.points[${index}]`)
        ),
      },
    };
  }

  if (behaviorType === "wandering") {
    return {
      id: asString(value.id, "npc.id"),
      label: asString(value.label, "npc.label"),
      position: parseVector3Like(value.position, "npc.position"),
      behavior: {
        type: "wandering",
        radius: asNumber(behavior.radius, "npc.behavior.radius"),
      },
    };
  }

  throw new Error(`Unsupported npc behavior: ${behaviorType}`);
}

export function parseMapAsset(value: unknown): MapAsset {
  if (!isRecord(value)) {
    throw new Error("Map asset must be an object.");
  }

  const chunkSize = asNumber(value.chunkSize, "chunkSize");
  const chunks = Array.isArray(value.chunks)
    ? value.chunks.map((chunk) => parseChunk(chunk, chunkSize))
    : (() => {
        throw new Error("chunks must be an array.");
      })();
  if (chunks.length === 0) {
    throw new Error("Map asset must contain at least one chunk.");
  }

  const chunkIds = new Set<string>();
  for (const chunk of chunks) {
    if (chunk.id !== getChunkId(chunk.x, chunk.z)) {
      throw new Error(`Chunk id ${chunk.id} must equal ${getChunkId(chunk.x, chunk.z)}.`);
    }
    if (chunkIds.has(chunk.id)) {
      throw new Error(`Duplicate chunk id ${chunk.id}.`);
    }
    chunkIds.add(chunk.id);
  }

  const npcs = Array.isArray(value.npcs)
    ? value.npcs.map((npc) => parseNpc(npc))
    : (() => {
        throw new Error("npcs must be an array.");
      })();

  const parsed: MapAsset = {
    version: asNumber(value.version, "version") as 1,
    mapId: asString(value.mapId, "mapId"),
    name: asString(value.name, "name"),
    chunkSize,
    waterLevel: asNumber(value.waterLevel, "waterLevel"),
    bounds: computeMapBounds(chunks),
    chunks,
    npcs,
  };

  if (parsed.version !== MAP_ASSET_VERSION) {
    throw new Error(`Unsupported map asset version ${parsed.version}.`);
  }

  return parsed;
}

export function cloneMapAsset(map: MapAsset): MapAsset {
  return {
    ...map,
    bounds: { ...map.bounds },
    chunks: map.chunks.map((chunk) => ({
      ...chunk,
      heights: chunk.heights.map((row) => [...row]),
      water: chunk.water.map((row) => [...row]),
    })),
    npcs: map.npcs.map((npc) => ({
      ...npc,
      position: { ...npc.position },
      behavior:
        npc.behavior.type === "patrol"
          ? {
              type: "patrol",
              points: npc.behavior.points.map((point) => ({ ...point })),
            }
          : npc.behavior.type === "wandering"
            ? { type: "wandering", radius: npc.behavior.radius }
            : { type: "standing" },
    })),
  };
}

export function resolveChunkIdForPosition(x: number, z: number, chunkSize = CHUNK_SIZE): string {
  return getChunkId(Math.floor(x / chunkSize), Math.floor(z / chunkSize));
}

export function getChunkAt(map: MapAsset, chunkX: number, chunkZ: number): TerrainChunkDTO | null {
  return map.chunks.find((chunk) => chunk.x === chunkX && chunk.z === chunkZ) ?? null;
}

export function getChunkById(map: MapAsset, chunkId: string): TerrainChunkDTO | null {
  return map.chunks.find((chunk) => chunk.id === chunkId) ?? null;
}

export function getNeighborChunks(map: MapAsset, centerChunkId: string): TerrainChunkDTO[] {
  const [chunkX, chunkZ] = centerChunkId.split(":").map(Number);
  const chunks: TerrainChunkDTO[] = [];

  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const nextChunk = getChunkAt(map, chunkX + dx, chunkZ + dz);
      if (nextChunk) {
        chunks.push(nextChunk);
      }
    }
  }

  return chunks;
}

export function getChunksAroundPosition(map: MapAsset, x: number, z: number): TerrainChunkDTO[] {
  return getNeighborChunks(map, resolveChunkIdForPosition(x, z, map.chunkSize));
}

export function getHeightAt(map: MapAsset, x: number, z: number): number {
  const chunkX = Math.floor(x / map.chunkSize);
  const chunkZ = Math.floor(z / map.chunkSize);
  const chunk = getChunkAt(map, chunkX, chunkZ);
  if (!chunk) {
    return 0;
  }

  const localColumn = Math.max(0, Math.min(chunk.size - 1, Math.floor(x - chunk.x * map.chunkSize)));
  const localRow = Math.max(0, Math.min(chunk.size - 1, Math.floor(z - chunk.z * map.chunkSize)));
  return chunk.heights[localRow][localColumn];
}

export function getWaterAt(map: MapAsset, x: number, z: number): boolean {
  const chunkX = Math.floor(x / map.chunkSize);
  const chunkZ = Math.floor(z / map.chunkSize);
  const chunk = getChunkAt(map, chunkX, chunkZ);
  if (!chunk) {
    return false;
  }

  const localColumn = Math.max(0, Math.min(chunk.size - 1, Math.floor(x - chunk.x * map.chunkSize)));
  const localRow = Math.max(0, Math.min(chunk.size - 1, Math.floor(z - chunk.z * map.chunkSize)));
  return chunk.water[localRow][localColumn];
}

export function getPublishedMapAssetPath(mapId: string): string {
  return resolve(assetDirectory, `${mapId}.json`);
}

export function loadPublishedMapAsset(mapId = TEST_MAP_ID): MapAsset {
  const content = readFileSync(getPublishedMapAssetPath(mapId), "utf8");
  return parseMapAsset(JSON.parse(content) as unknown);
}

export function savePublishedMapAsset(map: MapAsset): MapAsset {
  const parsed = parseMapAsset(map);
  writeFileSync(getPublishedMapAssetPath(parsed.mapId), `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return parsed;
}
