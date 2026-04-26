import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MapAsset } from "@villages/shared";
import { parseMapAsset, TEST_MAP_ID } from "./map";

const assetDirectory = fileURLToPath(new URL("../assets", import.meta.url));

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
