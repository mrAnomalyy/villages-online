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
  const onMoveRef = useRef(onMove);
  const onJumpRef = useRef(onJump);

  useEffect(() => {
    worldRef.current = world;
    entitiesRef.current = entities;
  }, [entities, world]);

  useEffect(() => {
    onMoveRef.current = onMove;
    onJumpRef.current = onJump;
  }, [onJump, onMove]);

  useEffect(() => {
    let engine: import("@babylonjs/core").Engine | null = null;
    let scene: import("@babylonjs/core").Scene | null = null;
    let animationFrameActive = true;
    const pressedKeys = new Set<string>();

    async function boot() {
      if (!canvasRef.current) {
        return;
      }

      const core = await import("@babylonjs/core");
      const {
        ArcRotateCamera,
        Color3,
        DirectionalLight,
        Engine,
        Logger,
        MeshBuilder,
        Scene,
        StandardMaterial,
        Vector3
      } = core;

      Logger.LogLevels = Logger.WarningLogLevel | Logger.ErrorLogLevel;

      engine = new Engine(canvasRef.current, true);
      scene = new Scene(engine);
      scene.clearColor.set(0.05, 0.09, 0.14, 1);
      const activeScene = scene;
      let cameraForward = { x: 0, z: 1 };
      let cameraRight = { x: 1, z: 0 };

      const emitDirection = () => {
        const vertical = Number(pressedKeys.has("KeyW")) - Number(pressedKeys.has("KeyS"));
        const horizontal = Number(pressedKeys.has("KeyA")) - Number(pressedKeys.has("KeyD"));
        const rawX = cameraForward.x * vertical + cameraRight.x * horizontal;
        const rawZ = cameraForward.z * vertical + cameraRight.z * horizontal;
        const length = Math.hypot(rawX, rawZ);
        if (length === 0) {
          onMoveRef.current({ x: 0, z: 0 });
          return;
        }
        onMoveRef.current({
          x: rawX / length,
          z: rawZ / length
        });
      };

      const keydown = (event: KeyboardEvent) => {
        if (["KeyW", "KeyA", "KeyS", "KeyD", "Space"].includes(event.code)) {
          event.preventDefault();
        }
        if (event.repeat) {
          return;
        }
        if (event.code === "Space") {
          onJumpRef.current();
          return;
        }
        if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) {
          pressedKeys.add(event.code);
          emitDirection();
        }
      };

      const keyup = (event: KeyboardEvent) => {
        if (["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) {
          pressedKeys.delete(event.code);
          emitDirection();
        }
      };

      const blur = () => {
        if (pressedKeys.size === 0) {
          return;
        }
        pressedKeys.clear();
        onMoveRef.current({ x: 0, z: 0 });
      };

      const camera = new ArcRotateCamera("camera", -Math.PI / 4, 1.1, 42, new Vector3(8, 0, 8), activeScene);
      camera.lowerRadiusLimit = 28;
      camera.upperRadiusLimit = 48;
      camera.wheelPrecision = 50;
      camera.inputs.clear();
      camera.attachControl(canvasRef.current, true);

      const updateCameraBasis = () => {
        const viewDirection = camera.position.subtract(camera.target);
        const groundForward = new Vector3(-viewDirection.x, 0, -viewDirection.z).normalize();
        cameraForward = { x: groundForward.x, z: groundForward.z };
        cameraRight = { x: -groundForward.z, z: groundForward.x };
      };
      updateCameraBasis();

      const light = new DirectionalLight("sun", new Vector3(-1, -2, -1), activeScene);
      light.intensity = 1.5;

      const terrainMaterial = new StandardMaterial("terrain", activeScene);
      terrainMaterial.diffuseColor = new Color3(0.39, 0.55, 0.33);

      const waterMaterial = new StandardMaterial("water", activeScene);
      waterMaterial.diffuseColor = new Color3(0.16, 0.28, 0.45);

      const playerMaterial = new StandardMaterial("player", activeScene);
      playerMaterial.diffuseColor = new Color3(0.83, 0.67, 0.24);

      const remotePlayerMaterial = new StandardMaterial("remote-player", activeScene);
      remotePlayerMaterial.diffuseColor = new Color3(0.36, 0.72, 0.93);

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
      const cameraTarget = new Vector3(
        worldRef.current.player.position.x,
        0,
        worldRef.current.player.position.z
      );

      const entityMeshes = new Map<string, import("@babylonjs/core").Mesh>();

      const syncEntities = (snapshots: EntitySnapshot[]) => {
        for (const snapshot of snapshots) {
          let mesh = entityMeshes.get(snapshot.id);
          if (!mesh) {
            mesh = MeshBuilder.CreateBox(
              snapshot.id,
              snapshot.kind === "player" ? { size: 1.15, height: 2.1 } : { size: 1.1, height: 2 },
              activeScene
            );
            mesh.material = snapshot.kind === "player" ? remotePlayerMaterial : npcMaterial;
            entityMeshes.set(snapshot.id, mesh);
          }
          mesh.position.copyFromFloats(snapshot.position.x, snapshot.position.y + 1, snapshot.position.z);
        }

        for (const [id, mesh] of entityMeshes.entries()) {
          if (!snapshots.some((snapshot) => snapshot.id === id)) {
            mesh.dispose();
            entityMeshes.delete(id);
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
        updateCameraBasis();
        const playerTarget = new Vector3(
          currentWorld.player.position.x,
          currentWorld.player.position.y + 1,
          currentWorld.player.position.z
        );
        playerMesh.position = Vector3.Lerp(playerMesh.position, playerTarget, 0.3);
        syncEntities(currentEntities);
        cameraTarget.x += (currentWorld.player.position.x - cameraTarget.x) * 0.15;
        cameraTarget.z += (currentWorld.player.position.z - cameraTarget.z) * 0.15;
        camera.target.copyFrom(cameraTarget);
        scene.render();
      });

      window.addEventListener("keydown", keydown);
      window.addEventListener("keyup", keyup);
      window.addEventListener("blur", blur);
      window.addEventListener("resize", resize);

      return () => {
        pressedKeys.clear();
        onMoveRef.current({ x: 0, z: 0 });
        window.removeEventListener("keydown", keydown);
        window.removeEventListener("keyup", keyup);
        window.removeEventListener("blur", blur);
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
  }, []);

  return <canvas ref={canvasRef} data-testid="game-canvas" />;
}
