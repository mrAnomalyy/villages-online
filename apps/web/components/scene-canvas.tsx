"use client";

import { useEffect, useRef } from "react";
import type { EntitySnapshot, InitialWorldPayload } from "@villages/shared";

type Props = {
  world: InitialWorldPayload;
  entities: EntitySnapshot[];
  onMove: (direction: { x: number; z: number }) => void;
  onJump: () => void;
};

export function BabylonGameCanvas({ world, entities, onMove, onJump }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const worldRef = useRef(world);
  const entitiesRef = useRef(entities);

  useEffect(() => {
    worldRef.current = world;
    entitiesRef.current = entities;
  }, [entities, world]);

  useEffect(() => {
    let engine: import("@babylonjs/core").Engine | null = null;
    let scene: import("@babylonjs/core").Scene | null = null;
    let animationFrameActive = true;

    const direction = { x: 0, z: 0 };

    const keydown = (event: KeyboardEvent) => {
      if (event.code === "KeyW") direction.z = 1;
      if (event.code === "KeyS") direction.z = -1;
      if (event.code === "KeyA") direction.x = -1;
      if (event.code === "KeyD") direction.x = 1;
      if (event.code === "Space") onJump();
      onMove(direction);
    };

    const keyup = (event: KeyboardEvent) => {
      if (event.code === "KeyW" || event.code === "KeyS") direction.z = 0;
      if (event.code === "KeyA" || event.code === "KeyD") direction.x = 0;
      onMove(direction);
    };

    async function boot() {
      if (!canvasRef.current) {
        return;
      }

      const core = await import("@babylonjs/core");
      const { ArcRotateCamera, Color3, DirectionalLight, Engine, MeshBuilder, Scene, StandardMaterial, Vector3 } = core;

      engine = new Engine(canvasRef.current, true);
      scene = new Scene(engine);
      scene.clearColor.set(0.05, 0.09, 0.14, 1);
      const activeScene = scene;

      const camera = new ArcRotateCamera("camera", -Math.PI / 4, 1.1, 42, new Vector3(8, 0, 8), activeScene);
      camera.lowerRadiusLimit = 28;
      camera.upperRadiusLimit = 48;
      camera.wheelPrecision = 50;
      camera.inputs.clear();
      camera.attachControl(canvasRef.current, true);

      const light = new DirectionalLight("sun", new Vector3(-1, -2, -1), activeScene);
      light.intensity = 1.5;

      const terrainMaterial = new StandardMaterial("terrain", activeScene);
      terrainMaterial.diffuseColor = new Color3(0.39, 0.55, 0.33);

      const waterMaterial = new StandardMaterial("water", activeScene);
      waterMaterial.diffuseColor = new Color3(0.16, 0.28, 0.45);

      const playerMaterial = new StandardMaterial("player", activeScene);
      playerMaterial.diffuseColor = new Color3(0.83, 0.67, 0.24);

      const npcMaterial = new StandardMaterial("npc", activeScene);
      npcMaterial.diffuseColor = new Color3(0.76, 0.31, 0.27);

      const terrainMeshes = worldRef.current.chunks.map((chunk) => {
        const subdivisions = chunk.size - 1;
        const mesh = MeshBuilder.CreateGround(
          `chunk-${chunk.id}`,
          { width: chunk.size, height: chunk.size, subdivisions },
          activeScene
        );
        mesh.position.x = chunk.x * chunk.size + chunk.size / 2;
        mesh.position.z = chunk.z * chunk.size + chunk.size / 2;
        mesh.material = chunk.heights.some((row) => row.some((value) => value === 0)) ? waterMaterial : terrainMaterial;

        const positions = mesh.getVerticesData(core.VertexBuffer.PositionKind);
        if (positions) {
          for (let row = 0; row < chunk.heights.length; row += 1) {
            for (let column = 0; column < chunk.heights[row].length; column += 1) {
              const vertex = row * chunk.heights[row].length + column;
              positions[vertex * 3 + 1] = chunk.heights[row][column];
            }
          }
          mesh.updateVerticesData(core.VertexBuffer.PositionKind, positions);
          mesh.convertToFlatShadedMesh();
        }
        return mesh;
      });

      const playerMesh = MeshBuilder.CreateBox("player", { size: 1.2, height: 2.2 }, activeScene);
      playerMesh.material = playerMaterial;

      const npcMeshes = new Map<string, import("@babylonjs/core").Mesh>();

      const syncEntities = (snapshots: EntitySnapshot[]) => {
        for (const snapshot of snapshots) {
          let mesh = npcMeshes.get(snapshot.id);
          if (!mesh) {
            mesh = MeshBuilder.CreateBox(snapshot.id, { size: 1.1, height: 2 }, activeScene);
            mesh.material = npcMaterial;
            npcMeshes.set(snapshot.id, mesh);
          }
          mesh.position.copyFromFloats(snapshot.position.x, snapshot.position.y + 1, snapshot.position.z);
        }

        for (const [id, mesh] of npcMeshes.entries()) {
          if (!snapshots.some((snapshot) => snapshot.id === id)) {
            mesh.dispose();
            npcMeshes.delete(id);
          }
        }
      };

      syncEntities(entitiesRef.current);
      playerMesh.position.copyFromFloats(
        worldRef.current.player.position.x,
        worldRef.current.player.position.y + 1,
        worldRef.current.player.position.z
      );

      const resize = () => engine?.resize();

      engine.runRenderLoop(() => {
        if (!animationFrameActive || !scene) {
          return;
        }
        const currentWorld = worldRef.current;
        const currentEntities = entitiesRef.current;
        playerMesh.position.copyFromFloats(
          currentWorld.player.position.x,
          currentWorld.player.position.y + 1,
          currentWorld.player.position.z
        );
        syncEntities(currentEntities.filter((entity) => entity.kind === "npc"));
        camera.target = new Vector3(currentWorld.player.position.x, 0, currentWorld.player.position.z);
        scene.render();
      });

      window.addEventListener("keydown", keydown);
      window.addEventListener("keyup", keyup);
      window.addEventListener("resize", resize);

      return () => {
        window.removeEventListener("keydown", keydown);
        window.removeEventListener("keyup", keyup);
        window.removeEventListener("resize", resize);
        terrainMeshes.forEach((mesh) => mesh.dispose());
      };
    }

    let cleanup: (() => void) | undefined;
    boot().then((maybeCleanup) => {
      cleanup = maybeCleanup;
    });

    return () => {
      animationFrameActive = false;
      cleanup?.();
      scene?.dispose();
      engine?.dispose();
    };
  }, [onJump, onMove]);

  return <canvas ref={canvasRef} data-testid="game-canvas" />;
}
