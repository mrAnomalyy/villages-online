"use client";

import { useEffect, useRef } from "react";
import type { MapAsset } from "@villages/shared";
import type { Engine, Scene } from "@babylonjs/core";
import { buildTerrainScene, getChunkAt, getHeightAt } from "@villages/world";

type TerrainPick = {
  chunkId: string;
  row: number;
  column: number;
  worldX: number;
  worldY: number;
  worldZ: number;
};

type Props = {
  map: MapAsset;
  selectedChunkId: string | null;
  selectedNpcId: string | null;
  onTerrainPick: (pick: TerrainPick) => void;
  onNpcPick: (npcId: string) => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function EditorCanvas({
  map,
  selectedChunkId,
  selectedNpcId,
  onTerrainPick,
  onNpcPick,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let engine: Engine | null = null;
    let scene: Scene | null = null;
    let stopped = false;

    async function boot() {
      if (!canvasRef.current) {
        return;
      }

      const core = await import("@babylonjs/core");
      const {
        ArcRotateCamera,
        Color3,
        Engine,
        HemisphericLight,
        MeshBuilder,
        Scene,
        StandardMaterial,
        Vector3,
      } = core;

      engine = new Engine(canvasRef.current, true);
      scene = new Scene(engine);
      const activeScene = scene;
      activeScene.clearColor.set(0.06, 0.11, 0.16, 1);

      const camera = new ArcRotateCamera(
        "editor-camera",
        -Math.PI / 4,
        1,
        38,
        new Vector3(map.chunkSize / 2, 0, map.chunkSize / 2),
        activeScene
      );
      camera.attachControl(canvasRef.current, true);
      camera.lowerRadiusLimit = 18;
      camera.upperRadiusLimit = 72;
      camera.wheelPrecision = 50;

      const light = new HemisphericLight("editor-light", new Vector3(0.2, 1, 0.1), activeScene);
      light.intensity = 1.2;

      const terrainBundle = buildTerrainScene(core, activeScene, {
        chunks: map.chunks,
        waterLevel: map.waterLevel,
      });

      const npcMaterial = new StandardMaterial("npc-marker", activeScene);
      npcMaterial.diffuseColor = new Color3(0.95, 0.58, 0.22);

      const selectedNpcMaterial = new StandardMaterial("npc-marker-selected", activeScene);
      selectedNpcMaterial.diffuseColor = new Color3(1, 0.86, 0.4);

      const chunkHighlightMaterial = new StandardMaterial("chunk-highlight", activeScene);
      chunkHighlightMaterial.diffuseColor = new Color3(0.68, 0.86, 0.95);
      chunkHighlightMaterial.alpha = 0.18;

      const npcMeshes = map.npcs.map((npc) => {
        const marker = MeshBuilder.CreateCylinder(
          `npc-${npc.id}`,
          { height: 2.2, diameter: selectedNpcId === npc.id ? 1.3 : 1 },
          activeScene
        );
        marker.position.copyFromFloats(npc.position.x, npc.position.y + 1.1, npc.position.z);
        marker.material = selectedNpcId === npc.id ? selectedNpcMaterial : npcMaterial;
        marker.metadata = { kind: "npc", npcId: npc.id };
        return marker;
      });

      let chunkHighlight = null as ReturnType<typeof MeshBuilder.CreateBox> | null;
      if (selectedChunkId) {
        const selectedChunk = map.chunks.find((chunk) => chunk.id === selectedChunkId);
        if (selectedChunk) {
          chunkHighlight = MeshBuilder.CreateBox(
            `highlight-${selectedChunk.id}`,
            {
              width: selectedChunk.size,
              depth: selectedChunk.size,
              height: 0.15,
            },
            activeScene
          );
          chunkHighlight.position.copyFromFloats(
            selectedChunk.x * selectedChunk.size + selectedChunk.size / 2,
            map.waterLevel + 0.5,
            selectedChunk.z * selectedChunk.size + selectedChunk.size / 2
          );
          chunkHighlight.material = chunkHighlightMaterial;
          chunkHighlight.isPickable = false;
        }
      }

      let patrolPath = null as ReturnType<typeof MeshBuilder.CreateLines> | null;
      const selectedNpc = map.npcs.find((npc) => npc.id === selectedNpcId);
      if (selectedNpc?.behavior.type === "patrol") {
        patrolPath = MeshBuilder.CreateLines(
          `patrol-${selectedNpc.id}`,
          {
            points: selectedNpc.behavior.points.map(
              (point) => new Vector3(point.x, getHeightAt(map, point.x, point.z) + 0.25, point.z)
            ),
          },
          activeScene
        );
        patrolPath.color = new Color3(0.96, 0.9, 0.56);
        patrolPath.isPickable = false;
      }

      activeScene.onPointerDown = (_event) => {
        const pick = activeScene.pick(activeScene.pointerX, activeScene.pointerY);
        if (!pick?.hit || !pick.pickedMesh) {
          return;
        }

        const metadata = pick.pickedMesh.metadata as
          | { kind: "chunk"; chunkId: string }
          | { kind: "npc"; npcId: string }
          | undefined;

        if (metadata?.kind === "npc") {
          onNpcPick(metadata.npcId);
          return;
        }

        if (metadata?.kind !== "chunk" || !pick.pickedPoint) {
          return;
        }

        const [chunkX, chunkZ] = metadata.chunkId.split(":").map(Number);
        const chunk = getChunkAt(map, chunkX, chunkZ);
        if (!chunk) {
          return;
        }

        const localX = pick.pickedPoint.x - chunk.x * chunk.size;
        const localZ = pick.pickedPoint.z - chunk.z * chunk.size;
        const column = clamp(Math.floor(localX), 0, chunk.size - 1);
        const row = clamp(Math.floor(localZ), 0, chunk.size - 1);
        const worldX = chunk.x * chunk.size + column + 0.5;
        const worldZ = chunk.z * chunk.size + row + 0.5;

        onTerrainPick({
          chunkId: chunk.id,
          row,
          column,
          worldX,
          worldY: getHeightAt(map, worldX, worldZ) + 1,
          worldZ,
        });
      };

      const resize = () => engine?.resize();
      window.addEventListener("resize", resize);

      engine.runRenderLoop(() => {
        if (!stopped) {
          activeScene.render();
        }
      });

      return () => {
        window.removeEventListener("resize", resize);
        patrolPath?.dispose();
        chunkHighlight?.dispose();
        npcMeshes.forEach((mesh) => mesh.dispose());
        terrainBundle.dispose();
      };
    }

    let cleanup: (() => void) | undefined;
    void boot().then((nextCleanup) => {
      cleanup = nextCleanup;
    });

    return () => {
      stopped = true;
      cleanup?.();
      scene?.dispose();
      engine?.dispose();
    };
  }, [map, onNpcPick, onTerrainPick, selectedChunkId, selectedNpcId]);

  return <canvas ref={canvasRef} className="editor-canvas" data-testid="editor-canvas" />;
}
