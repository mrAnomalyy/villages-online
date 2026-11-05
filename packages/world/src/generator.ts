import {
  CHUNK_RESOLUTION,
  CHUNK_SIZE,
  type MapAsset,
  type MapBounds,
  type MapNpcDefinition,
  type TerrainChunkDTO,
  type WaterMask,
} from "@villages/shared";
import { computeMapBounds, createWaterMask, getChunkId } from "./map";

export type NoiseAlgorithm = "simplex" | "perlin";

export type BiomeType =
  | "plains"
  | "hills"
  | "mountains"
  | "plateau"
  | "mesa"
  | "valley"
  | "river"
  | "mixed";

export interface HeightSampleContext {
  worldX: number;
  worldZ: number;
  chunkX: number;
  chunkZ: number;
  normalizedNoise: number;
  rawNoise: number;
  biome: BiomeType;
}

export interface BiomeConfig {
  biome: BiomeType;
  scale?: number;
  octaves?: number;
  persistence?: number;
  lacunarity?: number;
  baseHeight?: number;
  heightScale?: number;
  carveRivers?: boolean;
  riverFrequency?: number;
  riverWidth?: number;
  riverDepth?: number;
}

export interface ProceduralGenOptions {
  seed?: number | string;
  algorithm?: NoiseAlgorithm;
  biome?: BiomeType;
  scale?: number;
  octaves?: number;
  persistence?: number;
  lacunarity?: number;
  baseHeight?: number;
  heightScale?: number;
  waterLevel?: number;
  carveRivers?: boolean;
  riverFrequency?: number;
  riverWidth?: number;
  riverDepth?: number;
  size?: number;
  resolution?: number;
  heightModifier?: (height: number, context: HeightSampleContext) => number;
}

export interface ProceduralMapOptions extends ProceduralGenOptions {
  mapId?: string;
  name?: string;
  chunkSize?: number;
  chunkResolution?: number;
  waterLevel?: number;
  bounds?: MapBounds;
  minChunkX?: number;
  maxChunkX?: number;
  minChunkZ?: number;
  maxChunkZ?: number;
  chunkCountX?: number;
  chunkCountZ?: number;
  chunks?: Array<{ x: number; z: number }>;
  npcs?: MapNpcDefinition[];
}

export interface INoise2D {
  noise2D(x: number, y: number): number;
}

export function hashSeed(seed: number | string): number {
  if (typeof seed === "number") {
    let h = seed | 0;
    if (h === 0) {
      h = 1337;
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function createMulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildPermutation(seed: number): Uint8Array {
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) {
    p[i] = i;
  }

  const rng = createMulberry32(seed);
  for (let i = 255; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }

  for (let i = 0; i < 512; i += 1) {
    perm[i] = p[i & 255];
  }

  return perm;
}

const SIMPLEX_F2 = 0.5 * (Math.sqrt(3) - 1);
const SIMPLEX_G2 = (3 - Math.sqrt(3)) / 6;
const GRAD_X = new Float64Array([1, -1, 1, -1, 1, -1, 0, 0]);
const GRAD_Y = new Float64Array([1, 1, -1, -1, 0, 0, 1, -1]);

export class SimplexNoise2D implements INoise2D {
  private readonly perm: Uint8Array;

  constructor(seed: number | string = 1337) {
    this.perm = buildPermutation(hashSeed(seed));
  }

  noise2D(x: number, y: number): number {
    const s = (x + y) * SIMPLEX_F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * SIMPLEX_G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);

    let i1 = 0;
    let j1 = 0;
    if (x0 > y0) {
      i1 = 1;
      j1 = 0;
    } else {
      i1 = 0;
      j1 = 1;
    }

    const x1 = x0 - i1 + SIMPLEX_G2;
    const y1 = y0 - j1 + SIMPLEX_G2;
    const x2 = x0 - 1.0 + 2.0 * SIMPLEX_G2;
    const y2 = y0 - 1.0 + 2.0 * SIMPLEX_G2;

    const ii = i & 255;
    const jj = j & 255;

    let n0 = 0;
    let n1 = 0;
    let n2 = 0;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      t0 *= t0;
      const g0 = this.perm[(ii + this.perm[jj]) & 255] & 7;
      n0 = t0 * t0 * (GRAD_X[g0] * x0 + GRAD_Y[g0] * y0);
    }

    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      t1 *= t1;
      const g1 = this.perm[(ii + i1 + this.perm[(jj + j1) & 255]) & 255] & 7;
      n1 = t1 * t1 * (GRAD_X[g1] * x1 + GRAD_Y[g1] * y1);
    }

    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      t2 *= t2;
      const g2 = this.perm[(ii + 1 + this.perm[(jj + 1) & 255]) & 255] & 7;
      n2 = t2 * t2 * (GRAD_X[g2] * x2 + GRAD_Y[g2] * y2);
    }

    return 70.0 * (n0 + n1 + n2);
  }
}

function perlinGrad2D(hash: number, x: number, y: number): number {
  const h = hash & 7;
  const u = h < 4 ? x : y;
  const v = h < 4 ? y : x;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

export class PerlinNoise2D implements INoise2D {
  private readonly perm: Uint8Array;

  constructor(seed: number | string = 1337) {
    this.perm = buildPermutation(hashSeed(seed));
  }

  noise2D(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);

    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);

    const A = (this.perm[X] + Y) & 255;
    const B = (this.perm[(X + 1) & 255] + Y) & 255;

    const g00 = perlinGrad2D(this.perm[A], xf, yf);
    const g10 = perlinGrad2D(this.perm[B], xf - 1, yf);
    const g01 = perlinGrad2D(this.perm[(A + 1) & 255], xf, yf - 1);
    const g11 = perlinGrad2D(this.perm[(B + 1) & 255], xf - 1, yf - 1);

    const x1 = g00 + u * (g10 - g00);
    const x2 = g01 + u * (g11 - g01);
    return x1 + v * (x2 - x1);
  }
}

export function createNoise2D(
  algorithm: NoiseAlgorithm = "simplex",
  seed: number | string = 1337
): INoise2D {
  return algorithm === "perlin" ? new PerlinNoise2D(seed) : new SimplexNoise2D(seed);
}

export function sampleFbm2D(
  noise: INoise2D,
  x: number,
  y: number,
  octaves = 4,
  persistence = 0.5,
  lacunarity = 2.0
): number {
  let total = 0;
  let frequency = 1;
  let amplitude = 1;
  let maxAmplitude = 0;

  for (let i = 0; i < octaves; i += 1) {
    total += noise.noise2D(x * frequency, y * frequency) * amplitude;
    maxAmplitude += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return maxAmplitude > 0 ? total / maxAmplitude : 0;
}

export function sampleRidgedNoise2D(
  noise: INoise2D,
  x: number,
  y: number,
  octaves = 5,
  lacunarity = 2.0,
  gain = 0.5
): number {
  let frequency = 1.0;
  let amplitude = 1.0;
  let total = 0.0;
  let weight = 1.0;
  let maxAmp = 0.0;

  for (let i = 0; i < octaves; i += 1) {
    let signal = noise.noise2D(x * frequency, y * frequency);
    signal = 1.0 - Math.abs(signal);
    signal = signal * signal;
    signal *= weight;
    weight = Math.min(1.0, Math.max(0.0, signal * 2.0));
    total += signal * amplitude;
    maxAmp += amplitude;
    frequency *= lacunarity;
    amplitude *= gain;
  }

  return maxAmp > 0 ? total / maxAmp : 0;
}

export const BIOME_PRESETS: Record<BiomeType, BiomeConfig> = {
  plains: {
    biome: "plains",
    scale: 0.007,
    octaves: 3,
    persistence: 0.35,
    lacunarity: 2.0,
    baseHeight: 2.0,
    heightScale: 4.0,
    carveRivers: false,
  },
  hills: {
    biome: "hills",
    scale: 0.012,
    octaves: 4,
    persistence: 0.5,
    lacunarity: 2.0,
    baseHeight: 4.0,
    heightScale: 14.0,
    carveRivers: false,
  },
  mountains: {
    biome: "mountains",
    scale: 0.01,
    octaves: 5,
    persistence: 0.55,
    lacunarity: 2.2,
    baseHeight: 6.0,
    heightScale: 38.0,
    carveRivers: false,
  },
  plateau: {
    biome: "plateau",
    scale: 0.009,
    octaves: 4,
    persistence: 0.45,
    lacunarity: 2.0,
    baseHeight: 4.5,
    heightScale: 20.0,
    carveRivers: false,
  },
  mesa: {
    biome: "mesa",
    scale: 0.009,
    octaves: 4,
    persistence: 0.45,
    lacunarity: 2.0,
    baseHeight: 4.5,
    heightScale: 20.0,
    carveRivers: false,
  },
  valley: {
    biome: "valley",
    scale: 0.008,
    octaves: 4,
    persistence: 0.4,
    lacunarity: 2.0,
    baseHeight: -0.5,
    heightScale: 9.0,
    carveRivers: false,
  },
  river: {
    biome: "river",
    scale: 0.01,
    octaves: 4,
    persistence: 0.5,
    lacunarity: 2.0,
    baseHeight: 2.5,
    heightScale: 8.0,
    carveRivers: true,
    riverFrequency: 0.004,
    riverWidth: 0.07,
    riverDepth: 1.2,
  },
  mixed: {
    biome: "mixed",
    scale: 0.01,
    octaves: 4,
    persistence: 0.5,
    lacunarity: 2.0,
    baseHeight: 2.0,
    heightScale: 24.0,
    carveRivers: true,
    riverFrequency: 0.004,
    riverWidth: 0.07,
    riverDepth: 1.2,
  },
};

export const DEFAULT_PROCEDURAL_OPTIONS: Required<
  Omit<ProceduralGenOptions, "heightModifier" | "seed">
> & { seed: number | string } = {
  seed: 1337,
  algorithm: "simplex",
  biome: "mixed",
  scale: 0.01,
  octaves: 4,
  persistence: 0.5,
  lacunarity: 2.0,
  baseHeight: 2.0,
  heightScale: 24.0,
  waterLevel: 0.6,
  carveRivers: true,
  riverFrequency: 0.004,
  riverWidth: 0.07,
  riverDepth: 1.2,
  size: CHUNK_SIZE,
  resolution: CHUNK_RESOLUTION,
};

function terraceElevation(u: number, levels = 4, flatFraction = 0.65): number {
  const v = Math.max(0, Math.min(1, u)) * levels;
  const k = Math.floor(v);
  const f = v - k;
  let s = 0;
  if (f > flatFraction) {
    const t = (f - flatFraction) / (1 - flatFraction);
    s = t * t * (3 - 2 * t);
  }
  return (k + s) / levels;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export class ProceduralWorldGenerator {
  readonly options: ProceduralGenOptions;
  readonly baseNoise: INoise2D;
  readonly riverNoise: INoise2D;
  readonly continentalNoise: INoise2D;
  readonly mountainCragNoise: INoise2D;

  constructor(options: ProceduralGenOptions = {}) {
    this.options = options;
    const seed = options.seed ?? DEFAULT_PROCEDURAL_OPTIONS.seed;
    const algorithm = options.algorithm ?? DEFAULT_PROCEDURAL_OPTIONS.algorithm;
    const seedInt = hashSeed(seed);

    this.baseNoise = createNoise2D(algorithm, seedInt);
    this.riverNoise = createNoise2D(algorithm, (seedInt + 7919) >>> 0);
    this.continentalNoise = createNoise2D(algorithm, (seedInt + 15485863) >>> 0);
    this.mountainCragNoise = createNoise2D(algorithm, (seedInt + 32452843) >>> 0);
  }

  computeHeight(
    worldX: number,
    worldZ: number,
    chunkX: number,
    chunkZ: number
  ): { height: number; rawNoise: number; normalizedNoise: number; biome: BiomeType } {
    const biome = this.options.biome ?? DEFAULT_PROCEDURAL_OPTIONS.biome;
    const preset = BIOME_PRESETS[biome] ?? BIOME_PRESETS.mixed;

    const scale = this.options.scale ?? preset.scale ?? DEFAULT_PROCEDURAL_OPTIONS.scale;
    const octaves = this.options.octaves ?? preset.octaves ?? DEFAULT_PROCEDURAL_OPTIONS.octaves;
    const persistence =
      this.options.persistence ?? preset.persistence ?? DEFAULT_PROCEDURAL_OPTIONS.persistence;
    const lacunarity =
      this.options.lacunarity ?? preset.lacunarity ?? DEFAULT_PROCEDURAL_OPTIONS.lacunarity;
    const baseHeight =
      this.options.baseHeight ?? preset.baseHeight ?? DEFAULT_PROCEDURAL_OPTIONS.baseHeight;
    const heightScale =
      this.options.heightScale ?? preset.heightScale ?? DEFAULT_PROCEDURAL_OPTIONS.heightScale;
    const waterLevel = this.options.waterLevel ?? DEFAULT_PROCEDURAL_OPTIONS.waterLevel;
    const carveRivers = this.options.carveRivers ?? preset.carveRivers ?? false;
    const riverFreq =
      this.options.riverFrequency ??
      preset.riverFrequency ??
      DEFAULT_PROCEDURAL_OPTIONS.riverFrequency;
    const riverWidth =
      this.options.riverWidth ?? preset.riverWidth ?? DEFAULT_PROCEDURAL_OPTIONS.riverWidth;
    const riverDepth =
      this.options.riverDepth ?? preset.riverDepth ?? DEFAULT_PROCEDURAL_OPTIONS.riverDepth;

    const rawNoise = sampleFbm2D(
      this.baseNoise,
      worldX * scale,
      worldZ * scale,
      octaves,
      persistence,
      lacunarity
    );
    const norm = (rawNoise + 1) * 0.5;

    let height = baseHeight;

    if (biome === "plains") {
      // Gentle, smooth rolling meadows
      height = baseHeight + Math.pow(norm, 1.15) * heightScale;
    } else if (biome === "hills") {
      // Medium frequency, moderate elevation
      const s = norm * norm * (3 - 2 * norm);
      height = baseHeight + s * heightScale;
    } else if (biome === "mountains") {
      // High amplitude, ridge-like crags with slope accentuation
      const ridge = 1.0 - Math.abs(rawNoise);
      const cragSignal = sampleRidgedNoise2D(
        this.mountainCragNoise,
        worldX * (scale * 1.5),
        worldZ * (scale * 1.5),
        4,
        lacunarity,
        0.5
      );
      const crag = Math.pow(ridge, 2.0) * 0.6 + cragSignal * 0.4;
      const steepSlope = Math.pow(norm, 2.2);
      height = baseHeight + (crag * 0.6 + steepSlope * 0.4) * heightScale;
    } else if (biome === "plateau" || biome === "mesa") {
      // Flat-topped terraces using stepped thresholds
      const terraced = terraceElevation(norm, 4, 0.65);
      height = baseHeight + terraced * heightScale;
    } else if (biome === "valley") {
      // Valley basins dipping below water level
      const basin = Math.pow(norm, 1.5);
      height = baseHeight + basin * heightScale;
    } else if (biome === "river") {
      // River corridor terrain
      const s = norm * norm * (3 - 2 * norm);
      height = baseHeight + s * heightScale;
    } else {
      // "mixed": Macro-scale continentalness blending across all biomes
      const contNoise = this.continentalNoise.noise2D(
        worldX * (scale * 0.2),
        worldZ * (scale * 0.2)
      );
      const cont = (contNoise + 1) * 0.5;

      const hValley = -0.5 + Math.pow(norm, 1.5) * 8.0;
      const hPlains = 2.0 + Math.pow(norm, 1.15) * 4.0;
      const hHills = 3.5 + norm * norm * (3 - 2 * norm) * 14.0;
      const hPlateau = 4.5 + terraceElevation(norm, 4, 0.65) * 20.0;
      const ridge = 1.0 - Math.abs(rawNoise);
      const cragSignal = sampleRidgedNoise2D(
        this.mountainCragNoise,
        worldX * (scale * 1.5),
        worldZ * (scale * 1.5),
        4,
        lacunarity,
        0.5
      );
      const crag = Math.pow(ridge, 2.0) * 0.6 + cragSignal * 0.4;
      const hMountains = 6.0 + (crag * 0.6 + Math.pow(norm, 2.2) * 0.4) * 36.0;

      if (cont <= 0.25) {
        const t = smoothstep(0.0, 0.25, cont);
        height = hValley * (1 - t) + hPlains * t;
      } else if (cont <= 0.5) {
        const t = smoothstep(0.25, 0.5, cont);
        height = hPlains * (1 - t) + hHills * t;
      } else if (cont <= 0.75) {
        const t = smoothstep(0.5, 0.75, cont);
        height = hHills * (1 - t) + hPlateau * t;
      } else {
        const t = smoothstep(0.75, 1.0, cont);
        height = hPlateau * (1 - t) + hMountains * t;
      }
    }

    // Valley & River Carving: Carve river beds or valley basins below water level
    if (carveRivers) {
      const rNoise = Math.abs(this.riverNoise.noise2D(worldX * riverFreq, worldZ * riverFreq));
      if (rNoise < riverWidth) {
        const d = rNoise / riverWidth;
        const carveFactor = Math.pow(1 - d * d, 2);
        const riverBottom = waterLevel - riverDepth;
        if (height > riverBottom) {
          height -= (height - riverBottom) * carveFactor;
        }
      }
    }

    if (this.options.heightModifier) {
      height = this.options.heightModifier(height, {
        worldX,
        worldZ,
        chunkX,
        chunkZ,
        normalizedNoise: norm,
        rawNoise,
        biome,
      });
    }

    return { height, rawNoise, normalizedNoise: norm, biome };
  }
}

export function generateProceduralHeights(
  chunkX: number,
  chunkZ: number,
  resolution: number,
  size: number,
  options: ProceduralGenOptions = {}
): number[][] {
  if (resolution <= 0 || !Number.isInteger(resolution)) {
    throw new Error(`resolution must be a positive integer, received ${resolution}.`);
  }
  if (size <= 0) {
    throw new Error(`size must be a positive number, received ${size}.`);
  }

  const generator = new ProceduralWorldGenerator(options);
  const step = resolution > 1 ? size / (resolution - 1) : 0;
  const heights: number[][] = new Array(resolution);

  for (let row = 0; row < resolution; row += 1) {
    const hRow = new Array(resolution);
    const localZ = row === resolution - 1 ? size : row === 0 ? 0 : row * step;
    const worldZ = chunkZ * size + localZ;

    for (let col = 0; col < resolution; col += 1) {
      const localX = col === resolution - 1 ? size : col === 0 ? 0 : col * step;
      const worldX = chunkX * size + localX;
      hRow[col] = generator.computeHeight(worldX, worldZ, chunkX, chunkZ).height;
    }
    heights[row] = hRow;
  }

  return heights;
}

export function generateProceduralChunk(
  chunkX: number,
  chunkZ: number,
  options: ProceduralGenOptions = {}
): TerrainChunkDTO {
  const size = options.size ?? CHUNK_SIZE;
  const resolution = options.resolution ?? CHUNK_RESOLUTION;
  const waterLevel = options.waterLevel ?? DEFAULT_PROCEDURAL_OPTIONS.waterLevel;

  const heights = generateProceduralHeights(chunkX, chunkZ, resolution, size, options);
  const water: WaterMask = createWaterMask(resolution);

  for (let row = 0; row < resolution; row += 1) {
    for (let col = 0; col < resolution; col += 1) {
      water[row][col] = heights[row][col] <= waterLevel;
    }
  }

  return {
    id: getChunkId(chunkX, chunkZ),
    x: chunkX,
    z: chunkZ,
    size,
    resolution,
    heights,
    water,
  };
}

export function generateProceduralMap(options: ProceduralMapOptions = {}): MapAsset {
  const chunkSize = options.chunkSize ?? options.size ?? CHUNK_SIZE;
  const chunkResolution = options.chunkResolution ?? options.resolution ?? CHUNK_RESOLUTION;
  const waterLevel = options.waterLevel ?? DEFAULT_PROCEDURAL_OPTIONS.waterLevel;

  let chunkCoords: Array<{ x: number; z: number }> = [];

  if (options.chunks && options.chunks.length > 0) {
    chunkCoords = options.chunks;
  } else {
    let minX = 0;
    let maxX = 0;
    let minZ = 0;
    let maxZ = 0;

    if (options.bounds) {
      minX = options.bounds.minChunkX;
      maxX = options.bounds.maxChunkX;
      minZ = options.bounds.minChunkZ;
      maxZ = options.bounds.maxChunkZ;
    } else if (
      options.minChunkX !== undefined ||
      options.maxChunkX !== undefined ||
      options.minChunkZ !== undefined ||
      options.maxChunkZ !== undefined
    ) {
      minX = options.minChunkX ?? 0;
      maxX = options.maxChunkX ?? minX;
      minZ = options.minChunkZ ?? 0;
      maxZ = options.maxChunkZ ?? minZ;
    } else if (options.chunkCountX !== undefined) {
      minX = 0;
      maxX = Math.max(0, options.chunkCountX - 1);
      minZ = 0;
      maxZ = Math.max(0, (options.chunkCountZ ?? options.chunkCountX) - 1);
    }

    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        chunkCoords.push({ x, z });
      }
    }
  }

  if (chunkCoords.length === 0) {
    chunkCoords.push({ x: 0, z: 0 });
  }

  // Optimize multi-chunk generation by instantiating generator once
  const generator = new ProceduralWorldGenerator({
    ...options,
    size: chunkSize,
    resolution: chunkResolution,
    waterLevel,
  });

  const step = chunkResolution > 1 ? chunkSize / (chunkResolution - 1) : 0;
  const chunks: TerrainChunkDTO[] = chunkCoords.map(({ x, z }) => {
    const heights: number[][] = new Array(chunkResolution);
    const water: WaterMask = new Array(chunkResolution);

    for (let row = 0; row < chunkResolution; row += 1) {
      const hRow = new Array(chunkResolution);
      const wRow = new Array(chunkResolution);
      const localZ = row === chunkResolution - 1 ? chunkSize : row === 0 ? 0 : row * step;
      const worldZ = z * chunkSize + localZ;

      for (let col = 0; col < chunkResolution; col += 1) {
        const localX = col === chunkResolution - 1 ? chunkSize : col === 0 ? 0 : col * step;
        const worldX = x * chunkSize + localX;
        const h = generator.computeHeight(worldX, worldZ, x, z).height;
        hRow[col] = h;
        wRow[col] = h <= waterLevel;
      }

      heights[row] = hRow;
      water[row] = wRow;
    }

    return {
      id: getChunkId(x, z),
      x,
      z,
      size: chunkSize,
      resolution: chunkResolution,
      heights,
      water,
    };
  });

  const bounds = computeMapBounds(chunks);

  return {
    version: 1,
    mapId: options.mapId ?? "procedural-world",
    name: options.name ?? "Procedural World",
    chunkSize,
    chunkResolution,
    waterLevel,
    bounds,
    chunks,
    npcs: options.npcs ?? [],
  };
}
