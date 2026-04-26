import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { MapAsset } from "@villages/shared";
import { parseMapAsset, TEST_MAP_ID } from "./map";

function resolveAssetDirectory(): string {
  if (process.env.VILLAGES_WORLD_ASSETS_DIR) {
    return process.env.VILLAGES_WORLD_ASSETS_DIR;
  }

  let currentDirectory = process.cwd();
  while (true) {
    const candidate = resolve(currentDirectory, "packages", "world", "assets");
    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      throw new Error("Unable to locate packages/world/assets from the current working directory.");
    }
    currentDirectory = parentDirectory;
  }
}

const assetDirectory = resolveAssetDirectory();

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
