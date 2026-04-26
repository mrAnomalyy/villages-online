"use client";

import { useEffect, useRef } from "react";
import type { MapAsset } from "@villages/shared";
import type { Engine, Mesh, Scene } from "@babylonjs/core";
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
  mode: "chunk" | "terrain" | "water" | "npc";
  brushRadius: number;
  selectedChunkId: string | null;
  selectedNpcId: string | null;
  onTerrainPick: (pick: TerrainPick) => void;
  onNpcPick: (npcId: string) => void;
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
  onTerrainPick,
  onNpcPick,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapRef = useRef(map);
  const modeRef = useRef(mode);
  const brushRadiusRef = useRef(brushRadius);
  const selectedChunkIdRef = useRef(selectedChunkId);
  const selectedNpcIdRef = useRef(selectedNpcId);
  const onTerrainPickRef = useRef(onTerrainPick);
  const onNpcPickRef = useRef(onNpcPick);
  const sceneHandlesRef = useRef<SceneHandles | null>(null);
  const hoverPickRef = useRef<TerrainPick | null>(null);
  const renderedMapRef = useRef<MapAsset | null>(null);

  useEffect(() => {
    mapRef.current = map;
    modeRef.current = mode;
    brushRadiusRef.current = brushRadius;
    selectedChunkIdRef.current = selectedChunkId;
    selectedNpcIdRef.current = selectedNpcId;
    onTerrainPickRef.current = onTerrainPick;
    onNpcPickRef.current = onNpcPick;
  }, [brushRadius, map, mode, onNpcPick, onTerrainPick, selectedChunkId, selectedNpcId]);

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
          onNpcPickRef.current(metadata.npcId);
          return;
        }

        if (metadata?.kind !== "chunk" || !pick.pickedPoint) {
          return;
        }

        const [chunkX, chunkZ] = metadata.chunkId.split(":").map(Number);
        const activeMap = mapRef.current;
        const chunk = getChunkAt(activeMap, chunkX, chunkZ);
        if (!chunk) {
          return;
        }

        const localX = pick.pickedPoint.x - chunk.x * chunk.size;
        const localZ = pick.pickedPoint.z - chunk.z * chunk.size;
        const column = clamp(Math.floor(localX), 0, chunk.size - 1);
        const row = clamp(Math.floor(localZ), 0, chunk.size - 1);
        const worldX = chunk.x * chunk.size + column + 0.5;
        const worldZ = chunk.z * chunk.size + row + 0.5;

        onTerrainPickRef.current({
          chunkId: chunk.id,
          row,
          column,
          worldX,
          worldY: getHeightAt(activeMap, worldX, worldZ) + 1,
          worldZ,
        });
      };

      activeScene.onPointerMove = () => {
        const activeMap = mapRef.current;
        const pick = activeScene.pick(activeScene.pointerX, activeScene.pointerY);
        if (!pick?.hit || !pick.pickedMesh) {
          hoverPickRef.current = null;
          syncBrushPreview();
          return;
        }

        const metadata = pick.pickedMesh.metadata as { kind: "chunk"; chunkId: string } | undefined;
        if (metadata?.kind !== "chunk" || !pick.pickedPoint) {
          hoverPickRef.current = null;
          syncBrushPreview();
          return;
        }

        const [chunkX, chunkZ] = metadata.chunkId.split(":").map(Number);
        const chunk = getChunkAt(activeMap, chunkX, chunkZ);
        if (!chunk) {
          hoverPickRef.current = null;
          syncBrushPreview();
          return;
        }

        const localX = pick.pickedPoint.x - chunk.x * chunk.size;
        const localZ = pick.pickedPoint.z - chunk.z * chunk.size;
        const column = clamp(Math.floor(localX), 0, chunk.size - 1);
        const row = clamp(Math.floor(localZ), 0, chunk.size - 1);
        const worldX = chunk.x * chunk.size + column + 0.5;
        const worldZ = chunk.z * chunk.size + row + 0.5;
        hoverPickRef.current = {
          chunkId: chunk.id,
          row,
          column,
          worldX,
          worldY: getHeightAt(activeMap, worldX, worldZ) + 1,
          worldZ,
        };
        syncBrushPreview();
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

  return <canvas ref={canvasRef} className="editor-canvas" data-testid="editor-canvas" />;

  function syncScene(handles: SceneHandles) {
    const { core, scene } = handles;
    const { MeshBuilder, Vector3 } = core;
    const activeMap = mapRef.current;

    handles.terrainBundle?.dispose();
    handles.terrainBundle = buildTerrainScene(core, scene, {
      chunks: activeMap.chunks,
      waterLevel: activeMap.waterLevel,
    });

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

    if (handles.brushPreview) {
      handles.brushPreview.dispose();
      handles.brushPreview = null;
    }

    const brushDiameter = Math.max(1, brushRadiusRef.current * 2 + 1);
    const brushPreview = MeshBuilder.CreateCylinder(
      "brush-preview",
      {
        height: 0.12,
        diameter: brushDiameter,
        tessellation: 48,
      },
      scene
    );
    brushPreview.position.copyFromFloats(
      hoverPick.worldX,
      getHeightAt(activeMap, hoverPick.worldX, hoverPick.worldZ) + 0.18,
      hoverPick.worldZ
    );
    brushPreview.material = handles.brushPreviewMaterial;
    brushPreview.isPickable = false;
    if (currentMode === "terrain") {
      handles.brushPreviewMaterial.diffuseColor = new Color3(0.53, 0.92, 0.94);
      handles.brushPreviewMaterial.emissiveColor = new Color3(0.14, 0.32, 0.35);
    } else {
      handles.brushPreviewMaterial.diffuseColor = new Color3(0.25, 0.48, 0.86);
      handles.brushPreviewMaterial.emissiveColor = new Color3(0.08, 0.16, 0.34);
    }
    handles.brushPreview = brushPreview;
  }
}
