import {
  CHUNK_RESOLUTION,
  CHUNK_SIZE,
  type MapAsset,
  type MapNpcDefinition,
  type TerrainChunkDTO,
} from "@villages/shared";

export const TEST_MAP_ID = "starter-valley";
export const MAP_ASSET_VERSION = 1;

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
  resolution = CHUNK_RESOLUTION,
  height = 1
): TerrainChunkDTO {
  return {
    id: getChunkId(x, z),
    x,
    z,
    size,
    resolution,
    heights: Array.from({ length: resolution }, () =>
      Array.from({ length: resolution }, () => height)
    ),
    water: createWaterMask(resolution),
    surface: Array.from({ length: resolution }, () => Array.from({ length: resolution }, () => 0)),
  };
}

export function getChunkResolution(chunk: TerrainChunkDTO): number {
  return chunk.resolution;
}

export function getChunkSampleStep(chunk: TerrainChunkDTO): number {
  const resolution = getChunkResolution(chunk);
  return resolution > 1 ? chunk.size / (resolution - 1) : chunk.size;
}

export function getChunkCellSize(chunk: TerrainChunkDTO): number {
  return chunk.size / getChunkResolution(chunk);
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

    return row.map((entry, columnIndex) => parser(entry, `${label}[${rowIndex}][${columnIndex}]`));
  });
}

function parseChunk(value: unknown, chunkSize: number, defaultResolution: number): TerrainChunkDTO {
  if (!isRecord(value)) {
    throw new Error("chunk must be an object.");
  }

  const x = asNumber(value.x, "chunk.x");
  const z = asNumber(value.z, "chunk.z");
  const size = asNumber(value.size, "chunk.size");
  if (size !== chunkSize) {
    throw new Error(`chunk ${x}:${z} size must match map chunk size ${chunkSize}.`);
  }

  const matrixSize = Array.isArray(value.heights) ? value.heights.length : defaultResolution;
  const resolution =
    value.resolution === undefined ? matrixSize : asNumber(value.resolution, "chunk.resolution");
  if (resolution <= 0 || !Number.isInteger(resolution)) {
    throw new Error(`chunk ${x}:${z} resolution must be a positive integer.`);
  }

  const heights = parseMatrix(value.heights, resolution, `chunk ${x}:${z} heights`, asNumber);
  const water = parseMatrix(
    value.water,
    resolution,
    `chunk ${x}:${z} water`,
    (entry, entryLabel) => {
      if (typeof entry !== "boolean") {
        throw new Error(`${entryLabel} must be boolean.`);
      }
      return entry;
    }
  );

  const surface =
    value.surface !== undefined
      ? parseMatrix(value.surface, resolution, `chunk ${x}:${z} surface`, asNumber)
      : undefined;

  return {
    id: asString(value.id, "chunk.id"),
    x,
    z,
    size,
    resolution,
    heights,
    water,
    ...(surface ? { surface } : {}),
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
  const inferredChunkResolution =
    Array.isArray(value.chunks) &&
    value.chunks[0] &&
    typeof value.chunks[0] === "object" &&
    value.chunks[0] !== null &&
    Array.isArray((value.chunks[0] as Record<string, unknown>).heights)
      ? ((value.chunks[0] as Record<string, unknown>).heights as unknown[]).length
      : CHUNK_RESOLUTION;
  const chunkResolution =
    value.chunkResolution === undefined
      ? inferredChunkResolution
      : asNumber(value.chunkResolution, "chunkResolution");
  if (chunkResolution <= 0 || !Number.isInteger(chunkResolution)) {
    throw new Error("chunkResolution must be a positive integer.");
  }
  const chunks = Array.isArray(value.chunks)
    ? value.chunks.map((chunk) => parseChunk(chunk, chunkSize, chunkResolution))
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
    chunkResolution,
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
    chunkResolution: map.chunkResolution,
    chunks: map.chunks.map((chunk) => ({
      ...chunk,
      resolution: chunk.resolution,
      heights: chunk.heights.map((row) => [...row]),
      water: chunk.water.map((row) => [...row]),
      surface: chunk.surface ? chunk.surface.map((row) => [...row]) : undefined,
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

  const resolution = getChunkResolution(chunk);
  if (resolution === 1) {
    return chunk.heights[0][0];
  }

  const localX = x - chunk.x * map.chunkSize;
  const localZ = z - chunk.z * map.chunkSize;
  const sampleX = Math.max(0, Math.min(resolution - 1, (localX / chunk.size) * (resolution - 1)));
  const sampleZ = Math.max(0, Math.min(resolution - 1, (localZ / chunk.size) * (resolution - 1)));
  const left = Math.floor(sampleX);
  const top = Math.floor(sampleZ);
  const right = Math.min(left + 1, resolution - 1);
  const bottom = Math.min(top + 1, resolution - 1);
  const blendX = sampleX - left;
  const blendZ = sampleZ - top;
  const topHeight = chunk.heights[top][left] * (1 - blendX) + chunk.heights[top][right] * blendX;
  const bottomHeight =
    chunk.heights[bottom][left] * (1 - blendX) + chunk.heights[bottom][right] * blendX;
  return topHeight * (1 - blendZ) + bottomHeight * blendZ;
}

export function getWaterAt(map: MapAsset, x: number, z: number): boolean {
  const chunkX = Math.floor(x / map.chunkSize);
  const chunkZ = Math.floor(z / map.chunkSize);
  const chunk = getChunkAt(map, chunkX, chunkZ);
  if (!chunk) {
    return false;
  }

  const resolution = getChunkResolution(chunk);
  const localX = x - chunk.x * map.chunkSize;
  const localZ = z - chunk.z * map.chunkSize;
  const localColumn = Math.max(
    0,
    Math.min(resolution - 1, Math.floor((localX / chunk.size) * resolution))
  );
  const localRow = Math.max(
    0,
    Math.min(resolution - 1, Math.floor((localZ / chunk.size) * resolution))
  );
  return chunk.water[localRow][localColumn];
}
