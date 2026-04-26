"use client";

import { useEffect, useRef } from "react";
import type { MapAsset } from "@villages/shared";
import type { Engine, Mesh, Scene } from "@babylonjs/core";
import { buildTerrainScene, getChunkAt, getChunkResolution, getHeightAt } from "@villages/world";

type TerrainPick = {
  chunkId: string;
  row: number;
  column: number;
  localX: number;
  localZ: number;
  worldX: number;
  worldY: number;
  worldZ: number;
};

type Props = {
  map: MapAsset;
  mode: "chunk" | "terrain" | "water" | "npc";
  brushRadius: number;
  selectedChunkId: string | null;
  selectedNpcId: string | null;
  spacePressed: boolean;
  onTerrainPick: (pick: TerrainPick) => void;
  onNpcPick: (npcId: string) => void;
  onCameraHeadingChange: (headingDegrees: number) => void;
};

type BabylonCoreModule = typeof import("@babylonjs/core");

type SceneHandles = {
  core: BabylonCoreModule;
  scene: Scene;
  terrainBundle: ReturnType<typeof buildTerrainScene> | null;
  npcMeshes: Mesh[];
  chunkHighlight: Mesh | null;
  patrolPath: Mesh | null;
  brushPreview: Mesh | null;
  brushPreviewMaterial: import("@babylonjs/core").StandardMaterial;
  chunkHighlightMaterial: import("@babylonjs/core").StandardMaterial;
  npcMaterial: import("@babylonjs/core").StandardMaterial;
  selectedNpcMaterial: import("@babylonjs/core").StandardMaterial;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function EditorCanvas({
  map,
  mode,
  brushRadius,
  selectedChunkId,
  selectedNpcId,
  spacePressed,
  onTerrainPick,
  onNpcPick,
  onCameraHeadingChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapRef = useRef(map);
  const modeRef = useRef(mode);
  const brushRadiusRef = useRef(brushRadius);
  const selectedChunkIdRef = useRef(selectedChunkId);
  const selectedNpcIdRef = useRef(selectedNpcId);
  const spacePressedRef = useRef(spacePressed);
  const onTerrainPickRef = useRef(onTerrainPick);
  const onNpcPickRef = useRef(onNpcPick);
  const onCameraHeadingChangeRef = useRef(onCameraHeadingChange);
  const sceneHandlesRef = useRef<SceneHandles | null>(null);
  const hoverPickRef = useRef<TerrainPick | null>(null);
  const renderedMapRef = useRef<MapAsset | null>(null);
  const leftPointerDownRef = useRef(false);
  const panningRef = useRef(false);
  const lastPointerPositionRef = useRef<{ x: number; y: number } | null>(null);
  const lastPaintAtRef = useRef(0);
  const movementKeysRef = useRef({
    forward: false,
    backward: false,
    left: false,
    right: false,
  });
  const spaceKeyDownRef = useRef(false);

  useEffect(() => {
    mapRef.current = map;
    modeRef.current = mode;
    brushRadiusRef.current = brushRadius;
    selectedChunkIdRef.current = selectedChunkId;
    selectedNpcIdRef.current = selectedNpcId;
    spacePressedRef.current = spacePressed;
    onTerrainPickRef.current = onTerrainPick;
    onNpcPickRef.current = onNpcPick;
    onCameraHeadingChangeRef.current = onCameraHeadingChange;
  }, [
    brushRadius,
    map,
    mode,
    onCameraHeadingChange,
    onNpcPick,
    onTerrainPick,
    selectedChunkId,
    selectedNpcId,
    spacePressed,
  ]);

  useEffect(() => {
    if (!spacePressed) {
      panningRef.current = false;
    }
  }, [spacePressed]);

  useEffect(() => {
    const handles = sceneHandlesRef.current;
    if (!handles) {
      return;
    }

    if (renderedMapRef.current !== map) {
      syncScene(handles);
      renderedMapRef.current = map;
      return;
    }

    syncSelectionState(handles);
  }, [map, mode, brushRadius, selectedChunkId, selectedNpcId]);

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
        Math.max(38, map.chunkSize * 0.95),
        new Vector3(map.chunkSize / 2, 0, map.chunkSize / 2),
        activeScene
      );
      camera.attachControl(canvasRef.current, true);
      camera.lowerRadiusLimit = Math.max(24, map.chunkSize * 0.25);
      camera.upperRadiusLimit = Math.max(96, map.chunkSize * 3);
      camera.wheelPrecision = 8;
      camera.panningSensibility = 0;
      const pointerInput = camera.inputs.attached.pointers as { buttons?: number[] } | undefined;
      if (pointerInput) {
        pointerInput.buttons = [1, 2];
      }

      const emitCameraHeading = () => {
        const forward = camera.target.subtract(camera.position);
        const headingRadians = Math.atan2(forward.x, -forward.z);
        const headingDegrees = (headingRadians * 180) / Math.PI;
        onCameraHeadingChangeRef.current((headingDegrees + 360) % 360);
      };
      emitCameraHeading();
      camera.onViewMatrixChangedObservable.add(emitCameraHeading);

      const light = new HemisphericLight("editor-light", new Vector3(0.2, 1, 0.1), activeScene);
      light.intensity = 1.2;

      const npcMaterial = new StandardMaterial("npc-marker", activeScene);
      npcMaterial.diffuseColor = new Color3(0.95, 0.58, 0.22);

      const selectedNpcMaterial = new StandardMaterial("npc-marker-selected", activeScene);
      selectedNpcMaterial.diffuseColor = new Color3(1, 0.86, 0.4);

      const chunkHighlightMaterial = new StandardMaterial("chunk-highlight", activeScene);
      chunkHighlightMaterial.diffuseColor = new Color3(0.68, 0.86, 0.95);
      chunkHighlightMaterial.alpha = 0.18;

      const brushPreviewMaterial = new StandardMaterial("brush-preview", activeScene);
      brushPreviewMaterial.diffuseColor = new Color3(0.53, 0.92, 0.94);
      brushPreviewMaterial.emissiveColor = new Color3(0.14, 0.32, 0.35);
      brushPreviewMaterial.alpha = 0.28;

      sceneHandlesRef.current = {
        core,
        scene: activeScene,
        terrainBundle: null,
        npcMeshes: [],
        chunkHighlight: null,
        patrolPath: null,
        brushPreview: null,
        brushPreviewMaterial,
        chunkHighlightMaterial,
        npcMaterial,
        selectedNpcMaterial,
      };

      syncScene(sceneHandlesRef.current);
      renderedMapRef.current = mapRef.current;

      const getPointerPosition = (event: PointerEvent | MouseEvent) => {
        if (!canvasRef.current) {
          return { x: 0, y: 0 };
        }

        const rect = canvasRef.current.getBoundingClientRect();
        return {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        };
      };

      const resolveTerrainPick = (pointerX: number, pointerY: number): TerrainPick | null => {
        const pick = activeScene.pick(pointerX, pointerY);
        if (!pick?.hit || !pick.pickedMesh) {
          return null;
        }

        const metadata = pick.pickedMesh.metadata as
          | { kind: "chunk"; chunkId: string }
          | { kind: "npc"; npcId: string }
          | undefined;

        if (metadata?.kind !== "chunk" || !pick.pickedPoint) {
          return null;
        }

        const [chunkX, chunkZ] = metadata.chunkId.split(":").map(Number);
        const activeMap = mapRef.current;
        const chunk = getChunkAt(activeMap, chunkX, chunkZ);
        if (!chunk) {
          return null;
        }

        const localX = pick.pickedPoint.x - chunk.x * chunk.size;
        const localZ = pick.pickedPoint.z - chunk.z * chunk.size;
        const resolution = getChunkResolution(chunk);
        const maxLocalCoordinate = Math.max(0, chunk.size - 1e-4);
        const preciseLocalX = clamp(localX, 0, maxLocalCoordinate);
        const preciseLocalZ = clamp(localZ, 0, maxLocalCoordinate);
        const sampleX = (preciseLocalX / chunk.size) * (resolution - 1);
        const sampleZ = (preciseLocalZ / chunk.size) * (resolution - 1);
        const column = clamp(Math.floor(sampleX), 0, resolution - 1);
        const row = clamp(Math.floor(sampleZ), 0, resolution - 1);
        const worldX = chunk.x * chunk.size + preciseLocalX;
        const worldZ = chunk.z * chunk.size + preciseLocalZ;

        return {
          chunkId: chunk.id,
          row,
          column,
          localX: preciseLocalX,
          localZ: preciseLocalZ,
          worldX,
          worldY: getHeightAt(activeMap, worldX, worldZ) + 1,
          worldZ,
        };
      };

      const isPanModifierActive = () => spacePressedRef.current || spaceKeyDownRef.current;

      const panCamera = (deltaX: number, deltaY: number, scaleMultiplier = 1) => {
        const forward = camera.target.subtract(camera.position);
        forward.y = 0;
        if (forward.lengthSquared() < 1e-6) {
          return;
        }

        forward.normalize();
        const right = new Vector3(-forward.z, 0, forward.x);
        const renderWidth = engine?.getRenderWidth() ?? 800;
        const renderHeight = engine?.getRenderHeight() ?? 800;
        const scale =
          (camera.radius / Math.max(320, Math.min(renderWidth, renderHeight))) * scaleMultiplier;
        camera.target.addInPlace(right.scale(deltaX * scale));
        camera.target.addInPlace(forward.scale(deltaY * scale));
      };

      const handlePointerDown = (event: PointerEvent) => {
        if (event.button !== 0) {
          return;
        }

        event.preventDefault();
        canvasRef.current?.focus();
        canvasRef.current?.setPointerCapture(event.pointerId);
        leftPointerDownRef.current = true;
        const pointerPosition = getPointerPosition(event);
        lastPointerPositionRef.current = pointerPosition;

        if (isPanModifierActive()) {
          panningRef.current = true;
          return;
        }

        const pick = activeScene.pick(pointerPosition.x, pointerPosition.y);
        if (!pick?.hit || !pick.pickedMesh) {
          return;
        }

        const metadata = pick.pickedMesh.metadata as
          | { kind: "chunk"; chunkId: string }
          | { kind: "npc"; npcId: string }
          | undefined;

        if (metadata?.kind === "npc") {
          onNpcPickRef.current(metadata.npcId);
          return;
        }

        const resolvedPick = resolveTerrainPick(pointerPosition.x, pointerPosition.y);
        if (!resolvedPick) {
          return;
        }

        hoverPickRef.current = resolvedPick;
        syncBrushPreview();
        onTerrainPickRef.current(resolvedPick);
        lastPaintAtRef.current = performance.now();
      };

      const handlePointerUp = (event: PointerEvent) => {
        if (event.button !== 0) {
          return;
        }

        leftPointerDownRef.current = false;
        panningRef.current = false;
        lastPointerPositionRef.current = null;
        if (canvasRef.current?.hasPointerCapture(event.pointerId)) {
          canvasRef.current.releasePointerCapture(event.pointerId);
        }
      };

      const handlePointerMove = (event: PointerEvent) => {
        const pointerPosition = getPointerPosition(event);
        if (leftPointerDownRef.current && isPanModifierActive()) {
          panningRef.current = true;
        }

        if (panningRef.current && lastPointerPositionRef.current) {
          const deltaX = pointerPosition.x - lastPointerPositionRef.current.x;
          const deltaY = pointerPosition.y - lastPointerPositionRef.current.y;
          panCamera(deltaX, deltaY);
          lastPointerPositionRef.current = pointerPosition;
          return;
        }

        hoverPickRef.current = resolveTerrainPick(pointerPosition.x, pointerPosition.y);
        syncBrushPreview();
        lastPointerPositionRef.current = pointerPosition;
      };

      const pointerUp = () => {
        leftPointerDownRef.current = false;
        panningRef.current = false;
        lastPointerPositionRef.current = null;
      };
      const blur = () => {
        leftPointerDownRef.current = false;
        panningRef.current = false;
        lastPointerPositionRef.current = null;
        spaceKeyDownRef.current = false;
      };
      const wheel = (event: WheelEvent) => {
        event.preventDefault();
      };
      const keydown = (event: KeyboardEvent) => {
        const target = event.target;
        if (
          target instanceof HTMLElement &&
          target.closest("input, textarea, select, [contenteditable='true']")
        ) {
          return;
        }

        if (event.code === "Space") {
          spaceKeyDownRef.current = true;
        }

        if (event.defaultPrevented) {
          return;
        }

        switch (event.code) {
          case "KeyW":
            movementKeysRef.current.forward = true;
            break;
          case "KeyS":
            movementKeysRef.current.backward = true;
            break;
          case "KeyA":
            movementKeysRef.current.left = true;
            break;
          case "KeyD":
            movementKeysRef.current.right = true;
            break;
          default:
            break;
        }
      };
      const keyup = (event: KeyboardEvent) => {
        if (event.code === "Space") {
          spaceKeyDownRef.current = false;
          if (!spacePressedRef.current) {
            panningRef.current = false;
          }
        }

        switch (event.code) {
          case "KeyW":
            movementKeysRef.current.forward = false;
            break;
          case "KeyS":
            movementKeysRef.current.backward = false;
            break;
          case "KeyA":
            movementKeysRef.current.left = false;
            break;
          case "KeyD":
            movementKeysRef.current.right = false;
            break;
          default:
            break;
        }
      };
      const resize = () => engine?.resize();
      const stopMovement = () => {
        movementKeysRef.current.forward = false;
        movementKeysRef.current.backward = false;
        movementKeysRef.current.left = false;
        movementKeysRef.current.right = false;
        spaceKeyDownRef.current = false;
      };

      canvasRef.current.addEventListener("pointerdown", handlePointerDown);
      canvasRef.current.addEventListener("pointermove", handlePointerMove);
      canvasRef.current.addEventListener("pointerup", handlePointerUp);
      canvasRef.current.addEventListener("wheel", wheel, { passive: false });
      window.addEventListener("pointerup", pointerUp);
      window.addEventListener("blur", blur);
      window.addEventListener("keydown", keydown);
      window.addEventListener("keyup", keyup);
      window.addEventListener("resize", resize);

      engine.runRenderLoop(() => {
        const movement = movementKeysRef.current;
        if (movement.forward || movement.backward || movement.left || movement.right) {
          const deltaSeconds = engine?.getDeltaTime() ? (engine.getDeltaTime() / 1000) : 0.016;
          const speed = Math.max(14, camera.radius * 0.9) * deltaSeconds;
          const horizontal = (movement.left ? 1 : 0) - (movement.right ? 1 : 0);
          const vertical = (movement.forward ? 1 : 0) - (movement.backward ? 1 : 0);
          if (horizontal !== 0 || vertical !== 0) {
            panCamera(horizontal, vertical, speed);
          }
        }

        if (
          leftPointerDownRef.current &&
          !panningRef.current &&
          (modeRef.current === "terrain" || modeRef.current === "water") &&
          hoverPickRef.current
        ) {
          const now = performance.now();
          if (now - lastPaintAtRef.current >= 70) {
            onTerrainPickRef.current(hoverPickRef.current);
            lastPaintAtRef.current = now;
          }
        }

        if (!stopped) {
          activeScene.render();
        }
      });

      return () => {
        canvasRef.current?.removeEventListener("pointerdown", handlePointerDown);
        canvasRef.current?.removeEventListener("pointermove", handlePointerMove);
        canvasRef.current?.removeEventListener("pointerup", handlePointerUp);
        canvasRef.current?.removeEventListener("wheel", wheel);
        window.removeEventListener("pointerup", pointerUp);
        window.removeEventListener("blur", blur);
        window.removeEventListener("keydown", keydown);
        window.removeEventListener("keyup", keyup);
        window.removeEventListener("resize", resize);
        stopMovement();
        camera.onViewMatrixChangedObservable.removeCallback(emitCameraHeading);
        sceneHandlesRef.current?.terrainBundle?.dispose();
        sceneHandlesRef.current?.npcMeshes.forEach((mesh) => mesh.dispose());
        sceneHandlesRef.current?.chunkHighlight?.dispose();
        sceneHandlesRef.current?.patrolPath?.dispose();
        sceneHandlesRef.current?.brushPreview?.dispose();
        sceneHandlesRef.current?.npcMaterial.dispose();
        sceneHandlesRef.current?.selectedNpcMaterial.dispose();
        sceneHandlesRef.current?.chunkHighlightMaterial.dispose();
        sceneHandlesRef.current?.brushPreviewMaterial.dispose();
        sceneHandlesRef.current = null;
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
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="editor-canvas"
      data-testid="editor-canvas"
      tabIndex={0}
    />
  );

  function syncScene(handles: SceneHandles) {
    const activeMap = mapRef.current;

    if (!handles.terrainBundle) {
      handles.terrainBundle = buildTerrainScene(
        handles.core,
        handles.scene,
        {
          chunks: activeMap.chunks,
          waterLevel: activeMap.waterLevel,
        },
        {
          dynamicTerrain: true,
          flatShaded: false,
        }
      );
    } else {
      handles.terrainBundle.syncMap(activeMap, renderedMapRef.current ?? undefined);
    }

    syncNpcMeshes(handles);
    syncSelectionState(handles);
  }

  function syncNpcMeshes(handles: SceneHandles) {
    const { core, scene } = handles;
    const { MeshBuilder } = core;
    const activeMap = mapRef.current;

    handles.npcMeshes.forEach((mesh) => mesh.dispose());
    handles.npcMeshes = activeMap.npcs.map((npc) => {
      const marker = MeshBuilder.CreateCylinder(
        `npc-${npc.id}`,
        { height: 2.2, diameter: selectedNpcIdRef.current === npc.id ? 1.3 : 1 },
        scene
      );
      marker.position.copyFromFloats(npc.position.x, npc.position.y + 1.1, npc.position.z);
      marker.material =
        selectedNpcIdRef.current === npc.id ? handles.selectedNpcMaterial : handles.npcMaterial;
      marker.metadata = { kind: "npc", npcId: npc.id };
      return marker;
    });
  }

  function syncSelectionState(handles: SceneHandles) {
    const { core, scene } = handles;
    const { Color3, MeshBuilder, Vector3 } = core;
    const activeMap = mapRef.current;

    handles.npcMeshes.forEach((mesh) => {
      const metadata = mesh.metadata as { kind: "npc"; npcId: string } | undefined;
      if (!metadata) {
        return;
      }

      const selected = metadata.npcId === selectedNpcIdRef.current;
      mesh.scaling.x = selected ? 1.3 : 1;
      mesh.scaling.z = selected ? 1.3 : 1;
      mesh.material = selected ? handles.selectedNpcMaterial : handles.npcMaterial;
    });

    handles.chunkHighlight?.dispose();
    handles.chunkHighlight = null;
    const selectedChunk = activeMap.chunks.find((chunk) => chunk.id === selectedChunkIdRef.current);
    if (selectedChunk) {
      const chunkHighlight = MeshBuilder.CreateBox(
        `highlight-${selectedChunk.id}`,
        {
          width: selectedChunk.size,
          depth: selectedChunk.size,
          height: 0.15,
        },
        scene
      );
      chunkHighlight.position.copyFromFloats(
        selectedChunk.x * selectedChunk.size + selectedChunk.size / 2,
        activeMap.waterLevel + 0.5,
        selectedChunk.z * selectedChunk.size + selectedChunk.size / 2
      );
      chunkHighlight.material = handles.chunkHighlightMaterial;
      chunkHighlight.isPickable = false;
      handles.chunkHighlight = chunkHighlight;
    }

    handles.patrolPath?.dispose();
    handles.patrolPath = null;
    const selectedNpc = activeMap.npcs.find((npc) => npc.id === selectedNpcIdRef.current);
    if (selectedNpc?.behavior.type === "patrol") {
      const patrolPath = MeshBuilder.CreateLines(
        `patrol-${selectedNpc.id}`,
        {
          points: selectedNpc.behavior.points.map(
            (point) => new Vector3(point.x, getHeightAt(activeMap, point.x, point.z) + 0.25, point.z)
          ),
        },
        scene
      );
      patrolPath.color = new Color3(0.96, 0.9, 0.56);
      patrolPath.isPickable = false;
      handles.patrolPath = patrolPath;
    }

    syncBrushPreview();
  }

  function syncBrushPreview() {
    const handles = sceneHandlesRef.current;
    if (!handles) {
      return;
    }

    const { core, scene } = handles;
    const { Color3, MeshBuilder } = core;
    const hoverPick = hoverPickRef.current;
    const activeMap = mapRef.current;
    const currentMode = modeRef.current;

    const shouldShowPreview = hoverPick && (currentMode === "terrain" || currentMode === "water");
    if (!shouldShowPreview || !hoverPick) {
      handles.brushPreview?.dispose();
      handles.brushPreview = null;
      return;
    }

    const brushDiameter = Math.max(1, brushRadiusRef.current * 2 + 1);
    let brushPreview = handles.brushPreview;
    if (!brushPreview) {
      brushPreview = MeshBuilder.CreateCylinder(
        "brush-preview",
        {
          height: 0.12,
          diameter: 1,
          tessellation: 48,
        },
        scene
      );
      brushPreview.material = handles.brushPreviewMaterial;
      brushPreview.isPickable = false;
      handles.brushPreview = brushPreview;
    }

    brushPreview.scaling.x = brushDiameter;
    brushPreview.scaling.z = brushDiameter;
    brushPreview.position.copyFromFloats(
      hoverPick.worldX,
      getHeightAt(activeMap, hoverPick.worldX, hoverPick.worldZ) + 0.18,
      hoverPick.worldZ
    );
    if (currentMode === "terrain") {
      handles.brushPreviewMaterial.diffuseColor = new Color3(0.53, 0.92, 0.94);
      handles.brushPreviewMaterial.emissiveColor = new Color3(0.14, 0.32, 0.35);
    } else {
      handles.brushPreviewMaterial.diffuseColor = new Color3(0.25, 0.48, 0.86);
      handles.brushPreviewMaterial.emissiveColor = new Color3(0.08, 0.16, 0.34);
    }
  }
}
