import type * as BabylonCore from "@babylonjs/core";
import type { Mesh, Scene, StandardMaterial } from "@babylonjs/core";
import type { MapAsset, TerrainChunkDTO } from "@villages/shared";
import { getChunkCellSize, getChunkResolution } from "./map";

type BabylonCoreModule = typeof BabylonCore;

type TerrainChunkVisual = {
  terrainMesh: Mesh;
  waterMeshes: Mesh[];
};

export type TerrainSceneBundle = {
  terrainMeshes: Mesh[];
  waterMeshes: Mesh[];
  syncMap: (
    map: Pick<MapAsset, "chunks" | "waterLevel">,
    previousMap?: Pick<MapAsset, "chunks" | "waterLevel">
  ) => void;
  dispose: () => void;
};

type TerrainSceneOptions = {
  dynamicTerrain?: boolean;
  flatShaded?: boolean;
};

function chunkTopologyEqual(left: TerrainChunkDTO, right: TerrainChunkDTO): boolean {
  return (
    left.id === right.id &&
    left.x === right.x &&
    left.z === right.z &&
    left.size === right.size &&
    getChunkResolution(left) === getChunkResolution(right) &&
    left.heights.length === right.heights.length &&
    left.water.length === right.water.length
  );
}

function heightsEqual(left: TerrainChunkDTO, right: TerrainChunkDTO): boolean {
  if (!chunkTopologyEqual(left, right)) {
    return false;
  }

  for (let row = 0; row < left.heights.length; row += 1) {
    for (let column = 0; column < left.heights[row].length; column += 1) {
      if (left.heights[row][column] !== right.heights[row][column]) {
        return false;
      }
    }
  }

  return true;
}

function waterEqual(left: TerrainChunkDTO, right: TerrainChunkDTO): boolean {
  if (!chunkTopologyEqual(left, right)) {
    return false;
  }

  for (let row = 0; row < left.water.length; row += 1) {
    for (let column = 0; column < left.water[row].length; column += 1) {
      if (left.water[row][column] !== right.water[row][column]) {
        return false;
      }
    }
  }

  return true;
}

function surfaceEqual(left: TerrainChunkDTO, right: TerrainChunkDTO): boolean {
  if (!chunkTopologyEqual(left, right)) {
    return false;
  }

  const leftSurface = left.surface;
  const rightSurface = right.surface;
  if (!leftSurface && !rightSurface) {
    return true;
  }

  const resolution = getChunkResolution(left);
  for (let row = 0; row < resolution; row += 1) {
    for (let column = 0; column < resolution; column += 1) {
      const leftVal = leftSurface?.[row]?.[column] ?? 0;
      const rightVal = rightSurface?.[row]?.[column] ?? 0;
      if (leftVal !== rightVal) {
        return false;
      }
    }
  }

  return true;
}

export const SURFACE_MATERIAL_COLORS: Record<number, [number, number, number, number]> = {
  0: [0.39, 0.55, 0.33, 1.0], // Grass: lush meadow green
  1: [0.55, 0.4, 0.25, 1.0], // Dirt: warm earthy brown
  2: [0.5, 0.5, 0.52, 1.0], // Cobblestone: stone paver grey
  3: [0.82, 0.74, 0.52, 1.0], // Sand: warm shoreline sand
  4: [0.32, 0.34, 0.36, 1.0], // Rock: mountain crag slate
};

function applyChunkSurfaceColors(
  core: BabylonCoreModule,
  chunk: TerrainChunkDTO,
  mesh: Mesh,
  dynamic: boolean
): void {
  const resolution = getChunkResolution(chunk);
  const totalVertices = resolution * resolution;
  const colors = new Float32Array(totalVertices * 4);

  for (let row = 0; row < resolution; row += 1) {
    const meshRow = resolution - 1 - row;
    for (let column = 0; column < resolution; column += 1) {
      const vertex = meshRow * resolution + column;
      const materialId = chunk.surface?.[row]?.[column] ?? 0;
      const color = SURFACE_MATERIAL_COLORS[materialId] ?? SURFACE_MATERIAL_COLORS[0];
      const offset = vertex * 4;
      colors[offset] = color[0];
      colors[offset + 1] = color[1];
      colors[offset + 2] = color[2];
      colors[offset + 3] = color[3];
    }
  }

  if (mesh.isVerticesDataPresent(core.VertexBuffer.ColorKind)) {
    mesh.updateVerticesData(core.VertexBuffer.ColorKind, colors);
  } else {
    mesh.setVerticesData(core.VertexBuffer.ColorKind, colors, dynamic);
  }
}

function applyChunkHeights(
  core: BabylonCoreModule,
  chunk: TerrainChunkDTO,
  mesh: Mesh,
  flatShaded: boolean
): void {
  const positions = mesh.getVerticesData(core.VertexBuffer.PositionKind);
  if (!positions) {
    return;
  }

  for (let row = 0; row < chunk.heights.length; row += 1) {
    const meshRow = chunk.heights.length - 1 - row;
    for (let column = 0; column < chunk.heights[row].length; column += 1) {
      const vertex = meshRow * chunk.heights[row].length + column;
      positions[vertex * 3 + 1] = chunk.heights[row][column];
    }
  }

  mesh.updateVerticesData(core.VertexBuffer.PositionKind, positions);
  if (flatShaded) {
    mesh.convertToFlatShadedMesh();
    return;
  }

  const normals = mesh.getVerticesData(core.VertexBuffer.NormalKind);
  const indices = mesh.getIndices();
  if (normals && indices) {
    core.VertexData.ComputeNormals(positions, indices, normals);
    mesh.updateVerticesData(core.VertexBuffer.NormalKind, normals);
  }
  mesh.refreshBoundingInfo();
}

function syncChunkWaterMeshes(
  core: BabylonCoreModule,
  scene: Scene,
  chunk: TerrainChunkDTO,
  waterLevel: number,
  waterMaterial: StandardMaterial,
  existingWaterMeshes: Mesh[]
): Mesh[] {
  existingWaterMeshes.forEach((mesh) => mesh.dispose());

  const { MeshBuilder } = core;
  const nextWaterMeshes: Mesh[] = [];
  const resolution = getChunkResolution(chunk);
  const cellSize = getChunkCellSize(chunk);
  for (let row = 0; row < resolution; row += 1) {
    for (let column = 0; column < resolution; column += 1) {
      if (!chunk.water[row][column]) {
        continue;
      }

      const waterMesh = MeshBuilder.CreateGround(
        `water-${chunk.id}-${row}-${column}`,
        { width: cellSize, height: cellSize, subdivisions: 1 },
        scene
      );
      waterMesh.position.x = chunk.x * chunk.size + (column + 0.5) * cellSize;
      waterMesh.position.z = chunk.z * chunk.size + (row + 0.5) * cellSize;
      waterMesh.position.y = waterLevel + 0.05;
      waterMesh.material = waterMaterial;
      waterMesh.isPickable = false;
      nextWaterMeshes.push(waterMesh);
    }
  }

  return nextWaterMeshes;
}

function createChunkVisual(
  core: BabylonCoreModule,
  scene: Scene,
  chunk: TerrainChunkDTO,
  waterLevel: number,
  terrainMaterial: StandardMaterial,
  waterMaterial: StandardMaterial,
  options: Required<TerrainSceneOptions>
): TerrainChunkVisual {
  const { MeshBuilder } = core;
  const resolution = getChunkResolution(chunk);
  const terrainMesh = MeshBuilder.CreateGround(
    `chunk-${chunk.id}`,
    {
      width: chunk.size,
      height: chunk.size,
      subdivisions: resolution - 1,
      updatable: options.dynamicTerrain,
    },
    scene
  );
  terrainMesh.position.x = chunk.x * chunk.size + chunk.size / 2;
  terrainMesh.position.z = chunk.z * chunk.size + chunk.size / 2;
  terrainMesh.metadata = { kind: "chunk", chunkId: chunk.id };
  terrainMesh.material = terrainMaterial;
  applyChunkSurfaceColors(core, chunk, terrainMesh, options.dynamicTerrain);
  applyChunkHeights(core, chunk, terrainMesh, options.flatShaded);

  return {
    terrainMesh,
    waterMeshes: syncChunkWaterMeshes(core, scene, chunk, waterLevel, waterMaterial, []),
  };
}

function disposeChunkVisual(visual: TerrainChunkVisual): void {
  visual.terrainMesh.dispose();
  visual.waterMeshes.forEach((mesh) => mesh.dispose());
}

export function buildTerrainScene(
  core: BabylonCoreModule,
  scene: Scene,
  map: Pick<MapAsset, "chunks" | "waterLevel">,
  options: TerrainSceneOptions = {}
): TerrainSceneBundle {
  const { Color3, StandardMaterial } = core;
  const resolvedOptions: Required<TerrainSceneOptions> = {
    dynamicTerrain: options.dynamicTerrain ?? false,
    flatShaded: options.flatShaded ?? true,
  };
  const terrainMaterial = new StandardMaterial("terrain", scene);
  terrainMaterial.diffuseColor = new Color3(1, 1, 1);
  terrainMaterial.specularColor = new Color3(0.04, 0.04, 0.04);

  const waterMaterial = new StandardMaterial("water", scene);
  waterMaterial.diffuseColor = new Color3(0.16, 0.28, 0.45);
  waterMaterial.alpha = 0.78;

  const chunkVisuals = new Map<string, TerrainChunkVisual>();

  const terrainBundle: TerrainSceneBundle = {
    terrainMeshes: [],
    waterMeshes: [],
    syncMap: (nextMap, previousMap) => {
      const nextChunkIds = new Set(nextMap.chunks.map((chunk) => chunk.id));

      for (const [chunkId, visual] of chunkVisuals.entries()) {
        if (!nextChunkIds.has(chunkId)) {
          disposeChunkVisual(visual);
          chunkVisuals.delete(chunkId);
        }
      }

      for (const chunk of nextMap.chunks) {
        const existingVisual = chunkVisuals.get(chunk.id);
        const previousChunk = previousMap?.chunks.find((candidate) => candidate.id === chunk.id);

        if (!existingVisual) {
          chunkVisuals.set(
            chunk.id,
            createChunkVisual(
              core,
              scene,
              chunk,
              nextMap.waterLevel,
              terrainMaterial,
              waterMaterial,
              resolvedOptions
            )
          );
          continue;
        }

        existingVisual.terrainMesh.position.x = chunk.x * chunk.size + chunk.size / 2;
        existingVisual.terrainMesh.position.z = chunk.z * chunk.size + chunk.size / 2;
        existingVisual.terrainMesh.metadata = { kind: "chunk", chunkId: chunk.id };

        if (!previousChunk || !chunkTopologyEqual(previousChunk, chunk)) {
          disposeChunkVisual(existingVisual);
          chunkVisuals.set(
            chunk.id,
            createChunkVisual(
              core,
              scene,
              chunk,
              nextMap.waterLevel,
              terrainMaterial,
              waterMaterial,
              resolvedOptions
            )
          );
          continue;
        }

        const chunkHeightsChanged = !heightsEqual(previousChunk, chunk);
        const chunkWaterChanged = !waterEqual(previousChunk, chunk);
        const chunkSurfaceChanged = !surfaceEqual(previousChunk, chunk);

        if (chunkHeightsChanged || chunkWaterChanged || chunkSurfaceChanged) {
          if (resolvedOptions.dynamicTerrain && !resolvedOptions.flatShaded) {
            if (chunkHeightsChanged) {
              applyChunkHeights(core, chunk, existingVisual.terrainMesh, false);
            }
            if (chunkSurfaceChanged) {
              applyChunkSurfaceColors(core, chunk, existingVisual.terrainMesh, true);
            }
            if (chunkWaterChanged) {
              existingVisual.waterMeshes = syncChunkWaterMeshes(
                core,
                scene,
                chunk,
                nextMap.waterLevel,
                waterMaterial,
                existingVisual.waterMeshes
              );
            } else if (previousMap && previousMap.waterLevel !== nextMap.waterLevel) {
              existingVisual.waterMeshes.forEach((mesh) => {
                mesh.position.y = nextMap.waterLevel + 0.05;
              });
            }
          } else {
            disposeChunkVisual(existingVisual);
            chunkVisuals.set(
              chunk.id,
              createChunkVisual(
                core,
                scene,
                chunk,
                nextMap.waterLevel,
                terrainMaterial,
                waterMaterial,
                resolvedOptions
              )
            );
          }
        } else if (previousMap && previousMap.waterLevel !== nextMap.waterLevel) {
          existingVisual.waterMeshes.forEach((mesh) => {
            mesh.position.y = nextMap.waterLevel + 0.05;
          });
        }
      }

      terrainBundle.terrainMeshes = Array.from(
        chunkVisuals.values(),
        (visual) => visual.terrainMesh
      );
      terrainBundle.waterMeshes = Array.from(chunkVisuals.values()).flatMap(
        (visual) => visual.waterMeshes
      );
    },
    dispose: () => {
      chunkVisuals.forEach((visual) => disposeChunkVisual(visual));
      terrainMaterial.dispose();
      waterMaterial.dispose();
    },
  };

  terrainBundle.syncMap(map);

  return terrainBundle;
}
