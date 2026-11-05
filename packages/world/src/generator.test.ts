import { describe, expect, it } from "vitest";
import { getHeightAt, parseMapAsset } from "./map";
import {
  BIOME_PRESETS,
  DEFAULT_PROCEDURAL_OPTIONS,
  PerlinNoise2D,
  ProceduralWorldGenerator,
  SimplexNoise2D,
  generateProceduralChunk,
  generateProceduralHeights,
  generateProceduralMap,
  hashSeed,
  sampleFbm2D,
  sampleRidgedNoise2D,
  type BiomeType,
} from "./generator";

describe("Procedural World & Biome Generator", () => {
  describe("Deterministic Noise Algorithms", () => {
    it("generates deterministic hashes from numbers and strings", () => {
      expect(hashSeed(1337)).toBe(hashSeed(1337));
      expect(hashSeed("starter-seed")).toBe(hashSeed("starter-seed"));
      expect(hashSeed("seed-a")).not.toBe(hashSeed("seed-b"));
      expect(hashSeed(1234)).not.toBe(hashSeed(5678));
    });

    it("evaluates deterministic 2D Simplex noise bounded within [-1, 1]", () => {
      const noiseA = new SimplexNoise2D(42);
      const noiseB = new SimplexNoise2D(42);

      for (let x = -10; x <= 10; x += 1) {
        for (let y = -10; y <= 10; y += 1) {
          const vA = noiseA.noise2D(x * 0.1, y * 0.1);
          const vB = noiseB.noise2D(x * 0.1, y * 0.1);
          expect(vA).toBe(vB);
          expect(vA).toBeGreaterThanOrEqual(-1.0);
          expect(vA).toBeLessThanOrEqual(1.0);
        }
      }
    });

    it("evaluates deterministic 2D Perlin noise bounded within [-1, 1]", () => {
      const noiseA = new PerlinNoise2D("test-realm");
      const noiseB = new PerlinNoise2D("test-realm");

      for (let x = -10; x <= 10; x += 1) {
        for (let y = -10; y <= 10; y += 1) {
          const vA = noiseA.noise2D(x * 0.1, y * 0.1);
          const vB = noiseB.noise2D(x * 0.1, y * 0.1);
          expect(vA).toBe(vB);
          expect(vA).toBeGreaterThanOrEqual(-1.0);
          expect(vA).toBeLessThanOrEqual(1.0);
        }
      }
    });

    it("evaluates multi-octave fractal noise (fBm)", () => {
      const noise = new SimplexNoise2D(101);
      const val1 = sampleFbm2D(noise, 5.0, 5.0, 1);
      const val4 = sampleFbm2D(noise, 5.0, 5.0, 4);

      expect(typeof val1).toBe("number");
      expect(typeof val4).toBe("number");
      expect(val4).toBeGreaterThanOrEqual(-1.0);
      expect(val4).toBeLessThanOrEqual(1.0);
    });

    it("evaluates ridged multifractal noise bounded within [0, 1]", () => {
      const noise = new SimplexNoise2D(202);
      for (let i = 0; i < 50; i += 1) {
        const r = sampleRidgedNoise2D(noise, i * 0.2, i * 0.3);
        expect(r).toBeGreaterThanOrEqual(0.0);
        expect(r).toBeLessThanOrEqual(1.0);
      }
    });
  });

  describe("Determinism & Seeding", () => {
    it("produces bit-identical height arrays with identical numeric seeds", () => {
      const heightsA = generateProceduralHeights(2, 3, 32, 128, { seed: 98765 });
      const heightsB = generateProceduralHeights(2, 3, 32, 128, { seed: 98765 });

      expect(heightsA).toEqual(heightsB);
    });

    it("produces bit-identical height arrays with identical string seeds", () => {
      const heightsA = generateProceduralHeights(-1, 0, 32, 128, { seed: "ancient-forest" });
      const heightsB = generateProceduralHeights(-1, 0, 32, 128, { seed: "ancient-forest" });

      expect(heightsA).toEqual(heightsB);
    });

    it("produces different heights for different seeds", () => {
      const heightsA = generateProceduralHeights(0, 0, 16, 128, { seed: 100 });
      const heightsB = generateProceduralHeights(0, 0, 16, 128, { seed: 200 });

      expect(heightsA).not.toEqual(heightsB);
    });

    it("produces bit-identical TerrainChunkDTO objects with generateProceduralChunk", () => {
      const chunkA = generateProceduralChunk(1, -2, { seed: 4444, resolution: 32 });
      const chunkB = generateProceduralChunk(1, -2, { seed: 4444, resolution: 32 });

      expect(chunkA).toEqual(chunkB);
    });

    it("produces bit-identical MapAsset objects with generateProceduralMap", () => {
      const mapA = generateProceduralMap({
        seed: 777,
        bounds: { minChunkX: 0, maxChunkX: 1, minChunkZ: 0, maxChunkZ: 1 },
      });
      const mapB = generateProceduralMap({
        seed: 777,
        bounds: { minChunkX: 0, maxChunkX: 1, minChunkZ: 0, maxChunkZ: 1 },
      });

      expect(mapA).toEqual(mapB);
    });
  });

  describe("Seamless Chunk Stitching (Edge Continuity)", () => {
    const biomes: BiomeType[] = [
      "plains",
      "hills",
      "mountains",
      "plateau",
      "mesa",
      "valley",
      "river",
      "mixed",
    ];

    it.each(biomes)("matches shared boundary edges with zero cracks for biome '%s'", (biome) => {
      const resolution = 32;
      const size = 128;
      const seed = 54321;

      // Two horizontally adjacent chunks: (0, 0) and (1, 0)
      const chunk00 = generateProceduralChunk(0, 0, {
        seed,
        biome,
        resolution,
        size,
      });
      const chunk10 = generateProceduralChunk(1, 0, {
        seed,
        biome,
        resolution,
        size,
      });

      // The right edge of (0, 0) is column resolution - 1
      // The left edge of (1, 0) is column 0
      for (let row = 0; row < resolution; row += 1) {
        const hLeft = chunk00.heights[row][resolution - 1];
        const hRight = chunk10.heights[row][0];
        const diff = Math.abs(hLeft - hRight);
        expect(diff).toBeLessThan(1e-4);
        expect(diff).toBe(0);
      }

      // Two vertically adjacent chunks: (0, 0) and (0, 1)
      const chunk01 = generateProceduralChunk(0, 1, {
        seed,
        biome,
        resolution,
        size,
      });

      // The top edge of (0, 0) is row resolution - 1
      // The bottom edge of (0, 1) is row 0
      for (let col = 0; col < resolution; col += 1) {
        const hBottom = chunk00.heights[resolution - 1][col];
        const hTop = chunk01.heights[0][col];
        const diff = Math.abs(hBottom - hTop);
        expect(diff).toBeLessThan(1e-4);
        expect(diff).toBe(0);
      }

      // Four-corner diagonal continuity at junction: (0,0), (1,0), (0,1), (1,1)
      const chunk11 = generateProceduralChunk(1, 1, {
        seed,
        biome,
        resolution,
        size,
      });

      const corner00 = chunk00.heights[resolution - 1][resolution - 1];
      const corner10 = chunk10.heights[resolution - 1][0];
      const corner01 = chunk01.heights[0][resolution - 1];
      const corner11 = chunk11.heights[0][0];

      expect(Math.abs(corner00 - corner10)).toBeLessThan(1e-4);
      expect(Math.abs(corner00 - corner01)).toBeLessThan(1e-4);
      expect(Math.abs(corner00 - corner11)).toBeLessThan(1e-4);
    });

    it("matches shared boundary edges seamlessly across negative coordinates", () => {
      const resolution = 32;
      const size = 128;
      const seed = 999;

      const chunkNeg1Neg1 = generateProceduralChunk(-1, -1, { seed, resolution, size });
      const chunk0Neg1 = generateProceduralChunk(0, -1, { seed, resolution, size });
      const chunkNeg10 = generateProceduralChunk(-1, 0, { seed, resolution, size });
      const chunk00 = generateProceduralChunk(0, 0, { seed, resolution, size });

      // Horizontal edge between (-1, -1) and (0, -1)
      for (let row = 0; row < resolution; row += 1) {
        const diff = Math.abs(
          chunkNeg1Neg1.heights[row][resolution - 1] - chunk0Neg1.heights[row][0]
        );
        expect(diff).toBeLessThan(1e-4);
      }

      // Vertical edge between (-1, -1) and (-1, 0)
      for (let col = 0; col < resolution; col += 1) {
        const diff = Math.abs(
          chunkNeg1Neg1.heights[resolution - 1][col] - chunkNeg10.heights[0][col]
        );
        expect(diff).toBeLessThan(1e-4);
      }

      // Diagonal junction at (0, 0) world origin
      expect(
        Math.abs(chunkNeg1Neg1.heights[resolution - 1][resolution - 1] - chunk00.heights[0][0])
      ).toBeLessThan(1e-4);
    });

    it("preserves seam continuity when Perlin noise algorithm is selected", () => {
      const resolution = 32;
      const chunkA = generateProceduralChunk(0, 0, { algorithm: "perlin", resolution });
      const chunkB = generateProceduralChunk(1, 0, { algorithm: "perlin", resolution });

      for (let row = 0; row < resolution; row += 1) {
        const diff = Math.abs(chunkA.heights[row][resolution - 1] - chunkB.heights[row][0]);
        expect(diff).toBeLessThan(1e-4);
      }
    });

    it("preserves seam continuity with active river carving", () => {
      const resolution = 32;
      const chunkA = generateProceduralChunk(0, 0, { carveRivers: true, resolution });
      const chunkB = generateProceduralChunk(1, 0, { carveRivers: true, resolution });

      for (let row = 0; row < resolution; row += 1) {
        const diff = Math.abs(chunkA.heights[row][resolution - 1] - chunkB.heights[row][0]);
        expect(diff).toBeLessThan(1e-4);
      }
    });
  });

  describe("Biome Height Modifiers", () => {
    it("generates gentle, rolling plains elevation", () => {
      const heights = generateProceduralHeights(0, 0, 32, 128, { biome: "plains" });
      const preset = BIOME_PRESETS.plains;

      let min = Infinity;
      let max = -Infinity;
      for (const row of heights) {
        for (const h of row) {
          if (h < min) min = h;
          if (h > max) max = h;
        }
      }

      // Plains should stay within a gentle, rolling range
      expect(min).toBeGreaterThanOrEqual(preset.baseHeight!);
      expect(max).toBeLessThanOrEqual(preset.baseHeight! + preset.heightScale! + 0.5);
      expect(max - min).toBeLessThan(preset.heightScale! + 1);
    });

    it("generates medium frequency, moderate elevation hills", () => {
      const heights = generateProceduralHeights(0, 0, 32, 128, { biome: "hills" });
      const preset = BIOME_PRESETS.hills;

      let min = Infinity;
      let max = -Infinity;
      for (const row of heights) {
        for (const h of row) {
          if (h < min) min = h;
          if (h > max) max = h;
        }
      }

      expect(min).toBeGreaterThanOrEqual(preset.baseHeight!);
      expect(max).toBeLessThanOrEqual(preset.baseHeight! + preset.heightScale! + 1);
      // Hills should exhibit moderate elevation span
      expect(max - min).toBeGreaterThan(2);
    });

    it("generates high amplitude, ridge-like mountain crags", () => {
      const heights = generateProceduralHeights(0, 0, 32, 128, { biome: "mountains" });
      const preset = BIOME_PRESETS.mountains;

      let min = Infinity;
      let max = -Infinity;
      for (const row of heights) {
        for (const h of row) {
          if (h < min) min = h;
          if (h > max) max = h;
        }
      }

      expect(min).toBeGreaterThanOrEqual(preset.baseHeight!);
      // Mountain peaks reach high elevations
      expect(max).toBeGreaterThan(15);
      expect(max - min).toBeGreaterThan(10);
    });

    it("generates flat-topped terraces for plateau/mesa biomes using stepped thresholds", () => {
      const heights = generateProceduralHeights(0, 0, 64, 128, { biome: "plateau" });

      // Across the plateau terrain, flat terraces mean multiple vertices have near-zero slope
      let flatStepCount = 0;
      for (let r = 0; r < heights.length - 1; r += 1) {
        for (let c = 0; c < heights[r].length - 1; c += 1) {
          const deltaX = Math.abs(heights[r][c + 1] - heights[r][c]);
          const deltaZ = Math.abs(heights[r + 1][c] - heights[r][c]);
          if (deltaX < 0.05 && deltaZ < 0.05) {
            flatStepCount += 1;
          }
        }
      }

      // Significant portion of plateau terrain should consist of flat terrace tops
      expect(flatStepCount).toBeGreaterThan(100);
    });

    it("carves river beds and valley basins below water level and updates water mask", () => {
      const waterLevel = 0.6;
      const chunk = generateProceduralChunk(0, 0, {
        biome: "river",
        carveRivers: true,
        waterLevel,
        riverFrequency: 0.01,
        riverWidth: 0.15,
        riverDepth: 2.0,
      });

      let submergedCount = 0;
      let carvedBelowWater = false;

      for (let r = 0; r < chunk.resolution; r += 1) {
        for (let c = 0; c < chunk.resolution; c += 1) {
          if (chunk.heights[r][c] <= waterLevel) {
            carvedBelowWater = true;
          }
          if (chunk.water[r][c]) {
            submergedCount += 1;
            // Any vertex flagged as water must be at or below waterLevel
            expect(chunk.heights[r][c]).toBeLessThanOrEqual(waterLevel);
          }
        }
      }

      expect(carvedBelowWater).toBe(true);
      expect(submergedCount).toBeGreaterThan(0);
    });

    it("supports custom height modifier callback", () => {
      const heights = generateProceduralHeights(0, 0, 16, 64, {
        heightModifier: (h) => h + 1000,
      });

      for (const row of heights) {
        for (const val of row) {
          expect(val).toBeGreaterThan(500);
        }
      }
    });
  });

  describe("Bounds Safety & Map Asset Validation", () => {
    it("ensures height arrays and water masks match requested dimensions", () => {
      for (const res of [8, 16, 32, 64]) {
        const chunk = generateProceduralChunk(0, 0, { resolution: res });
        expect(chunk.heights.length).toBe(res);
        expect(chunk.heights[0].length).toBe(res);
        expect(chunk.water.length).toBe(res);
        expect(chunk.water[0].length).toBe(res);
      }
    });

    it("validates that all generated heights are finite numbers without NaN or Infinity", () => {
      const heights = generateProceduralHeights(0, 0, 32, 128);
      for (const row of heights) {
        for (const val of row) {
          expect(Number.isFinite(val)).toBe(true);
          expect(Number.isNaN(val)).toBe(false);
        }
      }
    });

    it("throws clear error on invalid non-positive resolution or size", () => {
      expect(() => generateProceduralHeights(0, 0, 0, 128)).toThrowError(
        /resolution must be a positive integer/
      );
      expect(() => generateProceduralHeights(0, 0, -5, 128)).toThrowError(
        /resolution must be a positive integer/
      );
      expect(() => generateProceduralHeights(0, 0, 16, 0)).toThrowError(
        /size must be a positive number/
      );
    });

    it("generates a valid MapAsset that passes parseMapAsset validation", () => {
      const map = generateProceduralMap({
        mapId: "procedural-test-map",
        name: "Procedural Test Realm",
        chunkSize: 128,
        chunkResolution: 32,
        bounds: { minChunkX: -1, maxChunkX: 1, minChunkZ: -1, maxChunkZ: 1 },
      });

      const parsed = parseMapAsset(map);
      expect(parsed.version).toBe(1);
      expect(parsed.mapId).toBe("procedural-test-map");
      expect(parsed.name).toBe("Procedural Test Realm");
      expect(parsed.chunkSize).toBe(128);
      expect(parsed.chunkResolution).toBe(32);
      expect(parsed.chunks.length).toBe(9);
      expect(parsed.bounds).toEqual({
        minChunkX: -1,
        maxChunkX: 1,
        minChunkZ: -1,
        maxChunkZ: 1,
      });
    });

    it("integrates seamlessly with getHeightAt world query function", () => {
      const map = generateProceduralMap({
        chunkSize: 128,
        chunkResolution: 64,
        bounds: { minChunkX: 0, maxChunkX: 1, minChunkZ: 0, maxChunkZ: 1 },
      });

      // Sample at exact chunk vertex
      const h0 = getHeightAt(map, 0, 0);
      expect(h0).toBe(map.chunks[0].heights[0][0]);

      // Sample along shared boundary: x = 128
      const hBorder = getHeightAt(map, 128, 64);
      expect(Number.isFinite(hBorder)).toBe(true);
      expect(hBorder).toBeGreaterThan(0);
    });
  });

  describe("Performance Benchmarking", () => {
    it("generates a 4x4 chunk map (16 chunks of 64x64 = 65,536 vertices) in < 100ms", () => {
      // Warm up JIT
      generateProceduralMap({
        chunkSize: 128,
        chunkResolution: 32,
        chunkCountX: 2,
        chunkCountZ: 2,
      });

      const start = performance.now();
      const map = generateProceduralMap({
        chunkSize: 128,
        chunkResolution: 64,
        chunkCountX: 4,
        chunkCountZ: 4,
      });
      const elapsed = performance.now() - start;

      expect(map.chunks.length).toBe(16);
      expect(map.chunks[0].heights.length).toBe(64);
      expect(map.chunks[0].heights[0].length).toBe(64);

      // Verify execution time is strictly under 100ms
      expect(elapsed).toBeLessThan(100);
    });

    it("generates an individual 64x64 chunk in < 10ms", () => {
      const start = performance.now();
      const chunk = generateProceduralChunk(0, 0, {
        resolution: 64,
        size: 128,
      });
      const elapsed = performance.now() - start;

      expect(chunk.heights.length).toBe(64);
      expect(elapsed).toBeLessThan(10);
    });
  });

  describe("Export Presets & Options", () => {
    it("exports DEFAULT_PROCEDURAL_OPTIONS and BIOME_PRESETS", () => {
      expect(DEFAULT_PROCEDURAL_OPTIONS).toBeDefined();
      expect(DEFAULT_PROCEDURAL_OPTIONS.resolution).toBe(64);
      expect(DEFAULT_PROCEDURAL_OPTIONS.size).toBe(128);

      expect(BIOME_PRESETS.plains).toBeDefined();
      expect(BIOME_PRESETS.hills).toBeDefined();
      expect(BIOME_PRESETS.mountains).toBeDefined();
      expect(BIOME_PRESETS.plateau).toBeDefined();
      expect(BIOME_PRESETS.mesa).toBeDefined();
      expect(BIOME_PRESETS.valley).toBeDefined();
      expect(BIOME_PRESETS.river).toBeDefined();
      expect(BIOME_PRESETS.mixed).toBeDefined();
    });

    it("can instantiate ProceduralWorldGenerator directly", () => {
      const generator = new ProceduralWorldGenerator({ biome: "hills" });
      const sample = generator.computeHeight(10, 20, 0, 0);
      expect(Number.isFinite(sample.height)).toBe(true);
      expect(sample.biome).toBe("hills");
    });
  });
});
