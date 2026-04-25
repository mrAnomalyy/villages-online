import type { Mesh, Scene } from "@babylonjs/core";
import type { MapAsset, TerrainChunkDTO } from "@villages/shared";

type BabylonCoreModule = typeof import("@babylonjs/core");

export type TerrainSceneBundle = {
  terrainMeshes: Mesh[];
  waterMeshes: Mesh[];
  dispose: () => void;
};

function applyChunkHeights(core: BabylonCoreModule, chunk: TerrainChunkDTO, mesh: Mesh): void {
  const positions = mesh.getVerticesData(core.VertexBuffer.PositionKind);
  if (!positions) {
    return;
  }

  for (let row = 0; row < chunk.heights.length; row += 1) {
    for (let column = 0; column < chunk.heights[row].length; column += 1) {
      const vertex = row * chunk.heights[row].length + column;
      positions[vertex * 3 + 1] = chunk.heights[row][column];
    }
  }

  mesh.updateVerticesData(core.VertexBuffer.PositionKind, positions);
  mesh.convertToFlatShadedMesh();
}

export function buildTerrainScene(
  core: BabylonCoreModule,
  scene: Scene,
  map: Pick<MapAsset, "chunks" | "waterLevel">
): TerrainSceneBundle {
  const { Color3, MeshBuilder, StandardMaterial } = core;
  const terrainMaterial = new StandardMaterial("terrain", scene);
  terrainMaterial.diffuseColor = new Color3(0.39, 0.55, 0.33);

  const waterMaterial = new StandardMaterial("water", scene);
  waterMaterial.diffuseColor = new Color3(0.16, 0.28, 0.45);
  waterMaterial.alpha = 0.78;

  const terrainMeshes: Mesh[] = [];
  const waterMeshes: Mesh[] = [];

  for (const chunk of map.chunks) {
    const terrainMesh = MeshBuilder.CreateGround(
      `chunk-${chunk.id}`,
      { width: chunk.size, height: chunk.size, subdivisions: chunk.size - 1 },
      scene
    );
    terrainMesh.position.x = chunk.x * chunk.size + chunk.size / 2;
    terrainMesh.position.z = chunk.z * chunk.size + chunk.size / 2;
    terrainMesh.metadata = { kind: "chunk", chunkId: chunk.id };
    terrainMesh.material = terrainMaterial;
    applyChunkHeights(core, chunk, terrainMesh);
    terrainMeshes.push(terrainMesh);

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
        waterMesh.position.y = map.waterLevel + 0.05;
        waterMesh.material = waterMaterial;
        waterMesh.isPickable = false;
        waterMeshes.push(waterMesh);
      }
    }
  }

  return {
    terrainMeshes,
    waterMeshes,
    dispose: () => {
      terrainMeshes.forEach((mesh) => mesh.dispose());
      waterMeshes.forEach((mesh) => mesh.dispose());
      terrainMaterial.dispose();
      waterMaterial.dispose();
    },
  };
}
