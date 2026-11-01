"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { MapAsset, MapNpcDefinition, NpcBehavior } from "@villages/shared";
import {
  addChunk,
  appendPatrolPoint,
  createNpcDefinition,
  deleteNpcDefinition,
  getChunkById,
  getHeightAt,
  paintWater,
  removeChunk,
  removePatrolPoint,
  sculptTerrain,
  updateNpcDefinition,
} from "@villages/world";
import { EditorCanvas } from "./editor-canvas";

type Mode = "chunk" | "terrain" | "water" | "npc";

const DEFAULT_MAP_ID = "starter-valley";
const CARDINAL_DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

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

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

async function readJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const body = (await response.json()) as T & { message?: string };
  if (!response.ok) {
    throw new Error(body.message ?? "Request failed.");
  }
  return body;
}

function setNpcBehavior(npc: MapNpcDefinition, nextType: NpcBehavior["type"]): NpcBehavior {
  if (nextType === "standing") {
    return { type: "standing" };
  }

  if (nextType === "wandering") {
    return {
      type: "wandering",
      radius: npc.behavior.type === "wandering" ? npc.behavior.radius : 4,
    };
  }

  if (npc.behavior.type === "patrol") {
    return npc.behavior;
  }

  return {
    type: "patrol",
    points: [
      { ...npc.position },
      { x: npc.position.x + 1, y: npc.position.y, z: npc.position.z + 1 },
    ],
  };
}

export function MapEditorShell() {
  const [map, setMap] = useState<MapAsset | null>(null);
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(null);
  const [selectedNpcId, setSelectedNpcId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("chunk");
  const [brushRadius, setBrushRadius] = useState(1);
  const [brushIntensity, setBrushIntensity] = useState(1);
  const [terrainDelta, setTerrainDelta] = useState<1 | -1>(1);
  const [paintWaterValue, setPaintWaterValue] = useState(true);
  const [npcClickMode, setNpcClickMode] = useState<"move" | "patrol">("move");
  const [status, setStatus] = useState("Loading published map...");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cameraHeading, setCameraHeading] = useState(0);
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const [altPressed, setAltPressed] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const loaded = await readJson<MapAsset>(`/api/maps/${DEFAULT_MAP_ID}`);
        setMap(loaded);
        setSelectedChunkId(loaded.chunks[0]?.id ?? null);
        setSelectedNpcId(loaded.npcs[0]?.id ?? null);
        setStatus(`Loaded ${loaded.name}.`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Map load failed.");
      }
    })();
  }, []);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (isEditableElement(event.target)) {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        setSpacePressed(true);
        return;
      }

      if (event.altKey || event.code === "AltLeft" || event.code === "AltRight") {
        setAltPressed(true);
      }

      if (event.repeat) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "c") {
        event.preventDefault();
        setMode("chunk");
      } else if (key === "q") {
        event.preventDefault();
        setMode("terrain");
      } else if (key === "e") {
        event.preventDefault();
        setMode("water");
      } else if (key === "n") {
        event.preventDefault();
        setMode("npc");
      }
    };

    const keyup = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setSpacePressed(false);
      }
      if (!event.altKey && (event.code === "AltLeft" || event.code === "AltRight")) {
        setAltPressed(false);
      }
    };

    const blur = () => {
      setSpacePressed(false);
      setAltPressed(false);
    };

    window.addEventListener("keydown", keydown, true);
    window.addEventListener("keyup", keyup, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("keyup", keyup, true);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const selectedChunk = useMemo(
    () => (map && selectedChunkId ? getChunkById(map, selectedChunkId) : null),
    [map, selectedChunkId]
  );
  const selectedNpc = useMemo(
    () => map?.npcs.find((npc) => npc.id === selectedNpcId) ?? null,
    [map, selectedNpcId]
  );
  const headingLabel = useMemo(() => {
    const segment = Math.round(cameraHeading / 45) % CARDINAL_DIRECTIONS.length;
    return CARDINAL_DIRECTIONS[segment];
  }, [cameraHeading]);
  const effectiveTerrainDelta = altPressed ? (terrainDelta === 1 ? -1 : 1) : terrainDelta;

  const applyMapUpdate = (nextMap: MapAsset, nextStatus: string) => {
    setMap(nextMap);
    setDirty(true);
    setStatus(nextStatus);
  };

  const handleTerrainPick = (pick: TerrainPick) => {
    if (!map) {
      return;
    }

    setSelectedChunkId(pick.chunkId);

    if (mode === "terrain") {
      applyMapUpdate(
        sculptTerrain(map, {
          worldX: pick.worldX,
          worldZ: pick.worldZ,
          radius: brushRadius,
          intensity: brushIntensity,
          delta: effectiveTerrainDelta,
        }),
        `${effectiveTerrainDelta > 0 ? "Raised" : "Lowered"} terrain at ${pick.chunkId}:${pick.column},${pick.row}.`
      );
      return;
    }

    if (mode === "water") {
      applyMapUpdate(
        paintWater(map, {
          worldX: pick.worldX,
          worldZ: pick.worldZ,
          radius: brushRadius,
          value: paintWaterValue,
        }),
        `${paintWaterValue ? "Painted" : "Cleared"} water at ${pick.chunkId}:${pick.column},${pick.row}.`
      );
      return;
    }

    if (mode === "npc") {
      const snappedPosition = {
        x: pick.worldX,
        y: getHeightAt(map, pick.worldX, pick.worldZ) + 1,
        z: pick.worldZ,
      };

      if (!selectedNpcId) {
        const created = createNpcDefinition(map, {
          position: snappedPosition,
          label: `NPC ${map.npcs.length + 1}`,
        });
        setSelectedNpcId(created.npc.id);
        applyMapUpdate(created.map, `Created ${created.npc.label}.`);
        return;
      }

      if (npcClickMode === "patrol") {
        applyMapUpdate(
          appendPatrolPoint(map, selectedNpcId, snappedPosition),
          `Added patrol point for ${selectedNpc?.label ?? selectedNpcId}.`
        );
        return;
      }

      applyMapUpdate(
        updateNpcDefinition(map, selectedNpcId, { position: snappedPosition }),
        `Moved ${selectedNpc?.label ?? selectedNpcId}.`
      );
      return;
    }

    setStatus(`Selected chunk ${pick.chunkId}.`);
  };

  const handleChunkExpansion = (dx: number, dz: number) => {
    if (!map || !selectedChunk) {
      return;
    }
    const next = addChunk(map, selectedChunk.x + dx, selectedChunk.z + dz);
    setSelectedChunkId(`${selectedChunk.x + dx}:${selectedChunk.z + dz}`);
    applyMapUpdate(next, "Added adjacent chunk.");
  };

  const handleChunkRemoval = () => {
    if (!map || !selectedChunkId) {
      return;
    }
    const next = removeChunk(map, selectedChunkId);
    setSelectedChunkId(next.chunks[0]?.id ?? null);
    applyMapUpdate(next, `Removed chunk ${selectedChunkId}.`);
  };

  const handleCreateNpc = () => {
    if (!map) {
      return;
    }
    const position = selectedChunk
      ? {
          x: selectedChunk.x * selectedChunk.size + selectedChunk.size / 2,
          y:
            getHeightAt(
              map,
              selectedChunk.x * selectedChunk.size + selectedChunk.size / 2,
              selectedChunk.z * selectedChunk.size + selectedChunk.size / 2
            ) + 1,
          z: selectedChunk.z * selectedChunk.size + selectedChunk.size / 2,
        }
      : { x: 8, y: 1, z: 8 };
    const created = createNpcDefinition(map, { position });
    setSelectedNpcId(created.npc.id);
    setMode("npc");
    applyMapUpdate(created.map, `Created ${created.npc.label}.`);
  };

  const handleSave = async (action: "save" | "publish") => {
    if (!map) {
      return;
    }

    setSaving(true);
    try {
      const response = await readJson<{ map: MapAsset; action: string }>(`/api/maps/${map.mapId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ map, action }),
      });
      setMap(response.map);
      setDirty(false);
      setStatus(
        action === "publish" ? "Published map asset. Restart realms to apply." : "Saved map asset."
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Map save failed.");
    } finally {
      setSaving(false);
    }
  };

  if (!map) {
    return (
      <main className="editor-page">
        <section className="loading-card">{status}</section>
      </main>
    );
  }

  return (
    <main className="editor-page">
      <section className="canvas-panel canvas-panel-full">
        <div className="floating-toolbar" data-collapsed={controlsCollapsed}>
          <div className="floating-toolbar-head">
            <div>
              <p className="eyebrow">Internal World Tools</p>
              <strong>Villages Editor</strong>
            </div>
            <div className="toolbar-actions">
              <button
                className="secondary-button"
                onClick={() => setControlsCollapsed((value) => !value)}
              >
                {controlsCollapsed ? "Expand" : "Collapse"}
              </button>
              <button
                className="secondary-button"
                disabled={saving}
                onClick={() => void handleSave("save")}
              >
                Save
              </button>
              <button
                className="primary-button"
                disabled={saving}
                onClick={() => void handleSave("publish")}
              >
                Publish
              </button>
            </div>
          </div>
          <p className="toolbar-status">{status}</p>
          {!controlsCollapsed ? (
            <div className="floating-toolbar-body">
              <div className="compact-panel">
                <div className="panel-row">
                  <strong>Tools</strong>
                  <span className="meta">{dirty ? "Unsaved" : "Saved"}</span>
                </div>
                <div className="mode-grid">
                  {(
                    [
                      ["chunk", "C"],
                      ["terrain", "Q"],
                      ["water", "E"],
                      ["npc", "N"],
                    ] as const
                  ).map(([nextMode, key]) => (
                    <button
                      key={nextMode}
                      className="mode-button"
                      data-active={mode === nextMode}
                      onClick={() => setMode(nextMode)}
                    >
                      <span>{nextMode}</span>
                      <small>{key}</small>
                    </button>
                  ))}
                </div>
              </div>

              <div className="compact-panel">
                <div className="panel-row">
                  <strong>Chunk</strong>
                  <span className="meta">{selectedChunkId ?? "none"}</span>
                </div>
                <div className="chunk-grid">
                  <button onClick={() => handleChunkExpansion(0, -1)}>North</button>
                  <button onClick={() => handleChunkExpansion(-1, 0)}>West</button>
                  <button onClick={() => handleChunkExpansion(1, 0)}>East</button>
                  <button onClick={() => handleChunkExpansion(0, 1)}>South</button>
                </div>
                <button className="danger-button" onClick={handleChunkRemoval}>
                  Remove
                </button>
              </div>

              <div className="compact-panel">
                <div className="panel-row">
                  <strong>Brush</strong>
                  <span className="meta">{spacePressed ? "Panning" : "Editing"}</span>
                </div>
                <label>
                  Radius
                  <input
                    type="range"
                    min="0"
                    max="4"
                    value={brushRadius}
                    onChange={(event) => setBrushRadius(Number(event.target.value))}
                  />
                </label>
                <label>
                  Intensity
                  <input
                    type="range"
                    min="1"
                    max="4"
                    value={brushIntensity}
                    onChange={(event) => setBrushIntensity(Number(event.target.value))}
                  />
                </label>
                <div className="segmented">
                  <button data-active={terrainDelta === 1} onClick={() => setTerrainDelta(1)}>
                    Raise
                  </button>
                  <button data-active={terrainDelta === -1} onClick={() => setTerrainDelta(-1)}>
                    Lower
                  </button>
                </div>
                <p className="meta">
                  Hold `Alt` to invert temporarily.{" "}
                  {effectiveTerrainDelta > 0 ? "Currently raising." : "Currently lowering."}
                </p>
                <div className="segmented">
                  <button data-active={paintWaterValue} onClick={() => setPaintWaterValue(true)}>
                    Paint Water
                  </button>
                  <button data-active={!paintWaterValue} onClick={() => setPaintWaterValue(false)}>
                    Clear Water
                  </button>
                </div>
              </div>

              <div className="compact-panel">
                <div className="panel-row">
                  <strong>NPCs</strong>
                  <button onClick={handleCreateNpc}>New</button>
                </div>
                <div className="npc-list npc-list-compact">
                  {map.npcs.map((npc) => (
                    <button
                      key={npc.id}
                      className="npc-row"
                      data-active={selectedNpcId === npc.id}
                      onClick={() => {
                        setSelectedNpcId(npc.id);
                        setMode("npc");
                      }}
                    >
                      <span>{npc.label}</span>
                      <small>{npc.behavior.type}</small>
                    </button>
                  ))}
                </div>
                {selectedNpc ? (
                  <div className="npc-editor">
                    <label>
                      Label
                      <input
                        value={selectedNpc.label}
                        onChange={(event) =>
                          applyMapUpdate(
                            updateNpcDefinition(map, selectedNpc.id, {
                              label: event.target.value,
                            }),
                            `Renamed ${selectedNpc.id}.`
                          )
                        }
                      />
                    </label>
                    <label>
                      Behavior
                      <select
                        value={selectedNpc.behavior.type}
                        onChange={(event) =>
                          applyMapUpdate(
                            updateNpcDefinition(map, selectedNpc.id, {
                              behavior: setNpcBehavior(
                                selectedNpc,
                                event.target.value as NpcBehavior["type"]
                              ),
                            }),
                            `Changed ${selectedNpc.label} behavior.`
                          )
                        }
                      >
                        <option value="standing">standing</option>
                        <option value="patrol">patrol</option>
                        <option value="wandering">wandering</option>
                      </select>
                    </label>
                    {selectedNpc.behavior.type === "wandering" ? (
                      <label>
                        Radius
                        <input
                          type="number"
                          min="1"
                          max="20"
                          value={selectedNpc.behavior.radius}
                          onChange={(event) =>
                            applyMapUpdate(
                              updateNpcDefinition(map, selectedNpc.id, {
                                behavior: {
                                  type: "wandering",
                                  radius: Number(event.target.value),
                                },
                              }),
                              `Updated ${selectedNpc.label} wander radius.`
                            )
                          }
                        />
                      </label>
                    ) : null}
                    <div className="segmented">
                      <button
                        data-active={npcClickMode === "move"}
                        onClick={() => setNpcClickMode("move")}
                      >
                        Move
                      </button>
                      <button
                        data-active={npcClickMode === "patrol"}
                        onClick={() => setNpcClickMode("patrol")}
                      >
                        Patrol
                      </button>
                    </div>
                    {selectedNpc.behavior.type === "patrol" ? (
                      <div className="point-list">
                        {selectedNpc.behavior.points.map((point, index) => (
                          <div key={`${point.x}-${point.z}-${index}`} className="point-row">
                            <span>
                              {index + 1}. {point.x.toFixed(1)}, {point.z.toFixed(1)}
                            </span>
                            <button
                              onClick={() =>
                                applyMapUpdate(
                                  removePatrolPoint(map, selectedNpc.id, index),
                                  `Removed patrol point ${index + 1}.`
                                )
                              }
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <button
                      className="danger-button"
                      onClick={() => {
                        applyMapUpdate(
                          deleteNpcDefinition(map, selectedNpc.id),
                          `Deleted ${selectedNpc.label}.`
                        );
                        setSelectedNpcId(
                          map.npcs.find((npc) => npc.id !== selectedNpc.id)?.id ?? null
                        );
                      }}
                    >
                      Delete NPC
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="compact-panel hotkey-panel">
                <strong>Hotkeys</strong>
                <div className="hotkey-grid">
                  <span>`Q` terrain</span>
                  <span>`E` water</span>
                  <span>`C` chunks</span>
                  <span>`N` NPC</span>
                  <span>`WASD` pan</span>
                  <span>`Space` pan</span>
                  <span>`Alt` invert</span>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="compass-overlay" aria-live="polite">
          <div
            className="compass-ring"
            style={{ "--compass-rotation": `${-cameraHeading}deg` } as CSSProperties}
          >
            <span className="compass-mark compass-mark-n">N</span>
            <span className="compass-mark compass-mark-e">E</span>
            <span className="compass-mark compass-mark-s">S</span>
            <span className="compass-mark compass-mark-w">W</span>
            <span className="compass-needle" />
          </div>
          <div className="compass-readout">
            <strong>{headingLabel}</strong>
            <span>{Math.round(cameraHeading)}°</span>
          </div>
        </div>

        <EditorCanvas
          map={map}
          mode={mode}
          brushRadius={brushRadius}
          selectedChunkId={selectedChunkId}
          selectedNpcId={selectedNpcId}
          spacePressed={spacePressed}
          onTerrainPick={handleTerrainPick}
          onNpcPick={(npcId) => {
            setSelectedNpcId(npcId);
            setMode("npc");
            setStatus(`Selected NPC ${npcId}.`);
          }}
          onCameraHeadingChange={setCameraHeading}
        />

        <div className="legend legend-overlay">
          <span>Hold left mouse to keep painting. Mouse wheel only zooms the canvas.</span>
          <span>
            `WASD` pans anytime. `Space` + drag also pans. NPC mode still clicks to move or add
            patrol points.
          </span>
        </div>
      </section>
    </main>
  );
}
