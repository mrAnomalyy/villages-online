"use client";

import { useEffect, useRef } from "react";
import type { EntitySnapshot, InitialWorldPayload } from "@villages/shared";
import type { Engine, Mesh, Scene } from "@babylonjs/core";
import { buildTerrainScene } from "@villages/world";

type Props = {
  world: InitialWorldPayload;
  entities: EntitySnapshot[];
  onMove: (direction: { x: number; z: number }) => void;
  onJump: () => void;
};

const MOVEMENT_KEYS = ["KeyW", "KeyA", "KeyS", "KeyD"] as const;
const CONTROL_KEYS = [...MOVEMENT_KEYS, "Space"] as const;

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
    let engine: Engine | null = null;
    let scene: Scene | null = null;
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
        Vector3,
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
          z: rawZ / length,
        });
      };

      const keydown = (event: KeyboardEvent) => {
        if (CONTROL_KEYS.includes(event.code as (typeof CONTROL_KEYS)[number])) {
          event.preventDefault();
        }
        if (event.repeat) {
          return;
        }
        if (event.code === "Space") {
          onJumpRef.current();
          return;
        }
        if (MOVEMENT_KEYS.includes(event.code as (typeof MOVEMENT_KEYS)[number])) {
          pressedKeys.add(event.code);
          emitDirection();
        }
      };

      const keyup = (event: KeyboardEvent) => {
        if (MOVEMENT_KEYS.includes(event.code as (typeof MOVEMENT_KEYS)[number])) {
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

      const camera = new ArcRotateCamera(
        "camera",
        -Math.PI / 4,
        1.1,
        42,
        new Vector3(8, 0, 8),
        activeScene
      );
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

      const playerMaterial = new StandardMaterial("player", activeScene);
      playerMaterial.diffuseColor = new Color3(0.83, 0.67, 0.24);

      const femalePlayerMaterial = new StandardMaterial("player-female", activeScene);
      femalePlayerMaterial.diffuseColor = new Color3(0.94, 0.45, 0.73);

      const remotePlayerMaterial = new StandardMaterial("remote-player", activeScene);
      remotePlayerMaterial.diffuseColor = new Color3(0.36, 0.72, 0.93);

      const remoteFemalePlayerMaterial = new StandardMaterial("remote-player-female", activeScene);
      remoteFemalePlayerMaterial.diffuseColor = new Color3(0.97, 0.58, 0.8);

      const npcMaterial = new StandardMaterial("npc", activeScene);
      npcMaterial.diffuseColor = new Color3(0.76, 0.31, 0.27);

      const terrainBundle = buildTerrainScene(core, activeScene, {
        chunks: worldRef.current.chunks,
        waterLevel: 0.6,
      });

      const playerMesh = MeshBuilder.CreateBox("player", { size: 1.2, height: 2.2 }, activeScene);
      playerMesh.material =
        worldRef.current.player.bodyType === "female" ? femalePlayerMaterial : playerMaterial;
      const cameraTarget = new Vector3(
        worldRef.current.player.position.x,
        0,
        worldRef.current.player.position.z
      );

      const entityMeshes = new Map<string, Mesh>();
      const nameplates = new Map<string, Mesh>();

      const createNameplate = (id: string, label: string) => {
        const plane = MeshBuilder.CreatePlane(
          `${id}-nameplate`,
          { width: 2.8, height: 0.7 },
          activeScene
        );
        const texture = new core.DynamicTexture(
          `${id}-nameplate-texture`,
          { width: 512, height: 128 },
          activeScene
        );
        texture.hasAlpha = true;
        const context = texture.getContext() as unknown as CanvasRenderingContext2D;
        context.clearRect(0, 0, 512, 128);
        context.fillStyle = "rgba(7, 15, 28, 0.72)";
        context.fillRect(16, 18, 480, 92);
        context.strokeStyle = "rgba(242, 231, 211, 0.85)";
        context.lineWidth = 4;
        context.strokeRect(16, 18, 480, 92);
        context.font = "bold 52px Georgia";
        context.fillStyle = "#f7f2e8";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(label, 256, 64);
        texture.update();

        const material = new StandardMaterial(`${id}-nameplate-material`, activeScene);
        material.diffuseTexture = texture;
        material.emissiveColor = Color3.White();
        material.backFaceCulling = false;
        material.useAlphaFromDiffuseTexture = true;
        plane.material = material;
        plane.billboardMode = core.Mesh.BILLBOARDMODE_ALL;
        plane.isPickable = false;
        return plane;
      };

      const playerNameplate = createNameplate("player-self", worldRef.current.player.label);

      const syncEntities = (snapshots: EntitySnapshot[]) => {
        for (const snapshot of snapshots) {
          let mesh = entityMeshes.get(snapshot.id);
          if (!mesh) {
            mesh = MeshBuilder.CreateBox(
              snapshot.id,
              snapshot.kind === "player" ? { size: 1.15, height: 2.1 } : { size: 1.1, height: 2 },
              activeScene
            );
            mesh.material =
              snapshot.kind === "player"
                ? snapshot.bodyType === "female"
                  ? remoteFemalePlayerMaterial
                  : remotePlayerMaterial
                : npcMaterial;
            entityMeshes.set(snapshot.id, mesh);
          }
          mesh.position.copyFromFloats(
            snapshot.position.x,
            snapshot.position.y + 1,
            snapshot.position.z
          );

          let plate = nameplates.get(snapshot.id);
          if (!plate) {
            plate = createNameplate(snapshot.id, snapshot.label);
            nameplates.set(snapshot.id, plate);
          }
          plate.position.copyFromFloats(
            snapshot.position.x,
            snapshot.position.y + 3.1,
            snapshot.position.z
          );
        }

        for (const [id, mesh] of entityMeshes.entries()) {
          if (!snapshots.some((snapshot) => snapshot.id === id)) {
            mesh.dispose();
            entityMeshes.delete(id);
          }
        }

        for (const [id, plate] of nameplates.entries()) {
          if (!snapshots.some((snapshot) => snapshot.id === id)) {
            const material = plate.material;
            plate.dispose();
            if (material && "dispose" in material) {
              material.dispose();
            }
            nameplates.delete(id);
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
        const playerNameplateTarget = new Vector3(
          currentWorld.player.position.x,
          currentWorld.player.position.y + 3.2,
          currentWorld.player.position.z
        );
        const playerTarget = new Vector3(
          currentWorld.player.position.x,
          currentWorld.player.position.y + 1,
          currentWorld.player.position.z
        );
        playerMesh.position = Vector3.Lerp(playerMesh.position, playerTarget, 0.3);
        playerNameplate.position = Vector3.Lerp(
          playerNameplate.position,
          playerNameplateTarget,
          0.3
        );
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
        playerNameplate.dispose();
        terrainBundle.dispose();
        entityMeshes.forEach((mesh) => mesh.dispose());
        nameplates.forEach((plate) => {
          const material = plate.material;
          plate.dispose();
          if (material && "dispose" in material) {
            material.dispose();
          }
        });
      };
    }

    let cleanup: (() => void) | undefined;
    void boot().then((maybeCleanup) => {
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
