import type { Mesh, Scene } from "@babylonjs/core";
import type { MapAsset, TerrainChunkDTO } from "@villages/shared";

type BabylonCoreModule = typeof import("@babylonjs/core");

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
  waterMaterial: import("@babylonjs/core").StandardMaterial,
  existingWaterMeshes: Mesh[]
): Mesh[] {
  existingWaterMeshes.forEach((mesh) => mesh.dispose());

  const { MeshBuilder } = core;
  const nextWaterMeshes: Mesh[] = [];
  for (let row = 0; row < chunk.size; row += 1) {
    for (let column = 0; column < chunk.size; column += 1) {
      if (!chunk.water[row][column]) {
        continue;
      }

      const waterMesh = MeshBuilder.CreateGround(
        `water-${chunk.id}-${row}-${column}`,
        { width: 1, height: 1, subdivisions: 1 },
        scene
      );
      waterMesh.position.x = chunk.x * chunk.size + column + 0.5;
      waterMesh.position.z = chunk.z * chunk.size + row + 0.5;
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
  terrainMaterial: import("@babylonjs/core").StandardMaterial,
  waterMaterial: import("@babylonjs/core").StandardMaterial,
  options: Required<TerrainSceneOptions>
): TerrainChunkVisual {
  const { MeshBuilder } = core;
  const terrainMesh = MeshBuilder.CreateGround(
    `chunk-${chunk.id}`,
    {
      width: chunk.size,
      height: chunk.size,
      subdivisions: chunk.size - 1,
      updatable: options.dynamicTerrain,
    },
    scene
  );
  terrainMesh.position.x = chunk.x * chunk.size + chunk.size / 2;
  terrainMesh.position.z = chunk.z * chunk.size + chunk.size / 2;
  terrainMesh.metadata = { kind: "chunk", chunkId: chunk.id };
  terrainMesh.material = terrainMaterial;
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

function chunksEqual(left: TerrainChunkDTO, right: TerrainChunkDTO): boolean {
  if (
    left.id !== right.id ||
    left.x !== right.x ||
    left.z !== right.z ||
    left.size !== right.size ||
    left.heights.length !== right.heights.length ||
    left.water.length !== right.water.length
  ) {
    return false;
  }

  for (let row = 0; row < left.heights.length; row += 1) {
    for (let column = 0; column < left.heights[row].length; column += 1) {
      if (left.heights[row][column] !== right.heights[row][column]) {
        return false;
      }
      if (left.water[row][column] !== right.water[row][column]) {
        return false;
      }
    }
  }

  return true;
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
  terrainMaterial.diffuseColor = new Color3(0.39, 0.55, 0.33);

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

        if (!previousChunk || !chunksEqual(previousChunk, chunk)) {
          if (resolvedOptions.dynamicTerrain && !resolvedOptions.flatShaded) {
            applyChunkHeights(core, chunk, existingVisual.terrainMesh, false);
            existingVisual.waterMeshes = syncChunkWaterMeshes(
              core,
              scene,
              chunk,
              nextMap.waterLevel,
              waterMaterial,
              existingVisual.waterMeshes
            );
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

      terrainBundle.terrainMeshes = Array.from(chunkVisuals.values(), (visual) => visual.terrainMesh);
      terrainBundle.waterMeshes = Array.from(chunkVisuals.values()).flatMap((visual) => visual.waterMeshes);
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
