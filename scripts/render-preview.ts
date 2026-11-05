import sharp from "sharp";
import fs from "fs";
import { generateProceduralMap } from "../packages/world/src/generator";

fs.mkdirSync("./assets/screenshots", { recursive: true });

function renderMapToImage(map: any, outPath: string) {
  const minX = map.bounds.minChunkX;
  const maxX = map.bounds.maxChunkX;
  const minZ = map.bounds.minChunkZ;
  const maxZ = map.bounds.maxChunkZ;
  const res = map.chunkResolution;
  const numChunksX = maxX - minX + 1;
  const numChunksZ = maxZ - minZ + 1;
  const width = numChunksX * res;
  const height = numChunksZ * res;
  const buffer = Buffer.alloc(width * height * 3);

  const chunkMap = new Map();
  for (const c of map.chunks) {
    chunkMap.set(`${c.x}:${c.z}`, c);
  }

  for (let cz = minZ; cz <= maxZ; cz++) {
    for (let cx = minX; cx <= maxX; cx++) {
      const chunk = chunkMap.get(`${cx}:${cz}`);
      if (!chunk) continue;
      const chunkPixelOffsetX = (cx - minX) * res;
      const chunkPixelOffsetZ = (maxZ - cz) * res;

      for (let r = 0; r < res; r++) {
        for (let c = 0; c < res; c++) {
          const h = chunk.heights[r][c];
          const isWater = chunk.water[r][c];
          const imgX = chunkPixelOffsetX + c;
          const imgY = chunkPixelOffsetZ + (res - 1 - r);
          const pixelIndex = (imgY * width + imgX) * 3;

          let red = 0, green = 0, blue = 0;
          if (isWater || h <= map.waterLevel) {
            const depth = Math.min(1, Math.max(0, (map.waterLevel - h) / 10));
            red = Math.round(20 + 30 * (1 - depth));
            green = Math.round(80 + 60 * (1 - depth));
            blue = Math.round(180 + 75 * (1 - depth));
          } else if (h < map.waterLevel + 1.5) {
            red = 220; green = 205; blue = 150;
          } else if (h < 15) {
            const t = (h - (map.waterLevel + 1.5)) / (15 - (map.waterLevel + 1.5));
            red = Math.round(60 + 60 * t);
            green = Math.round(150 - 30 * t);
            blue = Math.round(50 + 20 * t);
          } else if (h < 28) {
            const t = (h - 15) / 13;
            red = Math.round(120 + 30 * t);
            green = Math.round(115 + 25 * t);
            blue = Math.round(110 + 20 * t);
          } else {
            const t = Math.min(1, (h - 28) / 15);
            red = Math.round(200 + 55 * t);
            green = Math.round(200 + 55 * t);
            blue = Math.round(210 + 45 * t);
          }

          buffer[pixelIndex] = red;
          buffer[pixelIndex + 1] = green;
          buffer[pixelIndex + 2] = blue;
        }
      }
    }
  }

  return sharp(buffer, { raw: { width, height, channels: 3 } })
    .resize(512, 512, { kernel: "nearest" })
    .png()
    .toFile(outPath);
}

async function main() {
  const plainsMap = generateProceduralMap({
    mapId: "plains-river",
    name: "Plains & River Valley",
    biome: "plains",
    seed: 12345,
    minChunkX: 0, maxChunkX: 3,
    minChunkZ: 0, maxChunkZ: 3,
    enableRivers: true
  });
  await renderMapToImage(plainsMap, "./assets/screenshots/procedural-plains-river.png");

  const mountainMap = generateProceduralMap({
    mapId: "mountain-crags",
    name: "Mountain Crags & Peaks",
    biome: "mountains",
    seed: 99999,
    minChunkX: 0, maxChunkX: 3,
    minChunkZ: 0, maxChunkZ: 3,
  });
  await renderMapToImage(mountainMap, "./assets/screenshots/procedural-mountain-peaks.png");

  const mixedMap = generateProceduralMap({
    mapId: "mixed-world",
    name: "Mixed Biome Archipelago",
    biome: "mixed",
    seed: 424242,
    minChunkX: 0, maxChunkX: 3,
    minChunkZ: 0, maxChunkZ: 3,
    enableRivers: true
  });
  await renderMapToImage(mixedMap, "./assets/screenshots/procedural-mixed-world.png");

  console.log("Screenshots rendered successfully!");
}

main();
