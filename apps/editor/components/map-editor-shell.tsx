"use client";

import { useEffect, useMemo, useState } from "react";
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

  const selectedChunk = useMemo(
    () => (map && selectedChunkId ? getChunkById(map, selectedChunkId) : null),
    [map, selectedChunkId]
  );
  const selectedNpc = useMemo(
    () => map?.npcs.find((npc) => npc.id === selectedNpcId) ?? null,
    [map, selectedNpcId]
  );

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
          chunkId: pick.chunkId,
          row: pick.row,
          column: pick.column,
          localX: pick.localX,
          localZ: pick.localZ,
          radius: brushRadius,
          intensity: brushIntensity,
          delta: terrainDelta,
        }),
        `${terrainDelta > 0 ? "Raised" : "Lowered"} terrain at ${pick.chunkId}:${pick.column},${pick.row}.`
      );
      return;
    }

    if (mode === "water") {
      applyMapUpdate(
        paintWater(map, {
          chunkId: pick.chunkId,
          row: pick.row,
          column: pick.column,
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
          y: getHeightAt(
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
      setStatus(action === "publish" ? "Published map asset. Restart realms to apply." : "Saved map asset.");
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
      <header className="editor-header">
        <div>
          <p className="eyebrow">Internal World Tools</p>
          <h1>Villages Map Editor</h1>
          <p>{status}</p>
        </div>
        <div className="header-actions">
          <button className="secondary-button" disabled={saving} onClick={() => void handleSave("save")}>
            Save
          </button>
          <button className="primary-button" disabled={saving} onClick={() => void handleSave("publish")}>
            Publish
          </button>
        </div>
      </header>

      <section className="editor-layout">
        <aside className="sidebar">
          <div className="panel">
            <strong>Tools</strong>
            <div className="mode-grid">
              {(["chunk", "terrain", "water", "npc"] as const).map((nextMode) => (
                <button
                  key={nextMode}
                  className="mode-button"
                  data-active={mode === nextMode}
                  onClick={() => setMode(nextMode)}
                >
                  {nextMode}
                </button>
              ))}
            </div>
            <p className="meta">{dirty ? "Unsaved changes" : "Published asset matches editor state"}</p>
          </div>

          <div className="panel">
            <strong>Chunk</strong>
            <p className="meta">Selected: {selectedChunkId ?? "none"}</p>
            <div className="chunk-grid">
              <button onClick={() => handleChunkExpansion(0, -1)}>Add North</button>
              <button onClick={() => handleChunkExpansion(-1, 0)}>Add West</button>
              <button onClick={() => handleChunkExpansion(1, 0)}>Add East</button>
              <button onClick={() => handleChunkExpansion(0, 1)}>Add South</button>
            </div>
            <button className="danger-button" onClick={handleChunkRemoval}>
              Remove Selected Chunk
            </button>
          </div>

          <div className="panel">
            <strong>Terrain</strong>
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
            <div className="segmented">
              <button data-active={paintWaterValue} onClick={() => setPaintWaterValue(true)}>
                Paint Water
              </button>
              <button data-active={!paintWaterValue} onClick={() => setPaintWaterValue(false)}>
                Clear Water
              </button>
            </div>
          </div>

          <div className="panel">
            <div className="panel-row">
              <strong>NPCs</strong>
              <button onClick={handleCreateNpc}>New NPC</button>
            </div>
            <div className="npc-list">
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
                        updateNpcDefinition(map, selectedNpc.id, { label: event.target.value }),
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
                {selectedNpc.behavior.type === "patrol" ? (
                  <div className="patrol-editor">
                    <div className="segmented">
                      <button
                        data-active={npcClickMode === "move"}
                        onClick={() => setNpcClickMode("move")}
                      >
                        Move on Click
                      </button>
                      <button
                        data-active={npcClickMode === "patrol"}
                        onClick={() => setNpcClickMode("patrol")}
                      >
                        Add Patrol Point
                      </button>
                    </div>
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
                  </div>
                ) : null}
                {selectedNpc.behavior.type !== "patrol" ? (
                  <div className="segmented">
                    <button
                      data-active={npcClickMode === "move"}
                      onClick={() => setNpcClickMode("move")}
                    >
                      Move on Click
                    </button>
                    <button
                      data-active={npcClickMode === "patrol"}
                      onClick={() => setNpcClickMode("patrol")}
                    >
                      Add Patrol Point
                    </button>
                  </div>
                ) : null}
                <button
                  className="danger-button"
                  onClick={() => {
                    applyMapUpdate(deleteNpcDefinition(map, selectedNpc.id), `Deleted ${selectedNpc.label}.`);
                    setSelectedNpcId(map.npcs.find((npc) => npc.id !== selectedNpc.id)?.id ?? null);
                  }}
                >
                  Delete NPC
                </button>
              </div>
            ) : null}
          </div>
        </aside>

        <section className="canvas-panel">
          <EditorCanvas
            map={map}
            mode={mode}
            brushRadius={brushRadius}
            selectedChunkId={selectedChunkId}
            selectedNpcId={selectedNpcId}
            onTerrainPick={handleTerrainPick}
            onNpcPick={(npcId) => {
              setSelectedNpcId(npcId);
              setMode("npc");
              setStatus(`Selected NPC ${npcId}.`);
            }}
          />
          <div className="legend">
            <span>Click terrain to select chunks or apply the active tool.</span>
            <span>In NPC mode, clicking terrain moves the selected NPC or adds patrol points.</span>
          </div>
        </section>
      </section>
    </main>
  );
}
