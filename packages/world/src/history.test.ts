import { describe, expect, it } from "vitest";
import {
  addChunk,
  createNpcDefinition,
  deleteNpcDefinition,
  paintWater,
  removeChunk,
  sculptTerrain,
  updateNpcDefinition,
} from "./index";
import { loadPublishedMapAsset } from "./asset-store";
import {
  canRedo,
  canUndo,
  createHistoryState,
  diffMapHeights,
  diffMapWater,
  pushTransaction,
  redo,
  undo,
} from "./history";

describe("sparse delta history system", () => {
  it("restores map to bit-identical state after 20 terrain sculpt mutations", () => {
    let map = loadPublishedMapAsset();
    const initialJson = JSON.stringify(map);
    let history = createHistoryState(50);

    // Apply 20 terrain sculpting operations
    for (let i = 0; i < 20; i += 1) {
      const before = map;
      const worldX = 20 + (i % 5) * 4;
      const worldZ = 20 + Math.floor(i / 5) * 4;
      const delta = i % 2 === 0 ? 1 : -1;

      map = sculptTerrain(map, {
        worldX,
        worldZ,
        radius: 2,
        intensity: 0.8,
        delta,
      });

      const changes = diffMapHeights(before, map);
      expect(changes.length).toBeGreaterThan(0);

      history = pushTransaction(history, {
        type: "sculpt_terrain",
        changes,
        description: `Sculpt #${i + 1}`,
      });
    }

    expect(history.undoStack).toHaveLength(20);
    expect(history.redoStack).toHaveLength(0);
    expect(canUndo(history)).toBe(true);
    expect(canRedo(history)).toBe(false);

    // Undo all 20 operations
    for (let i = 0; i < 20; i += 1) {
      const result = undo(map, history);
      expect(result).not.toBeNull();
      map = result!.map;
      history = result!.state;
    }

    expect(history.undoStack).toHaveLength(0);
    expect(history.redoStack).toHaveLength(20);
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(true);

    // Assert bit-identical restoration
    expect(JSON.stringify(map)).toBe(initialJson);

    // Redo all 20 operations
    for (let i = 0; i < 20; i += 1) {
      const result = redo(map, history);
      expect(result).not.toBeNull();
      map = result!.map;
      history = result!.state;
    }

    expect(history.undoStack).toHaveLength(20);
    expect(history.redoStack).toHaveLength(0);

    // Undo again to initial
    for (let i = 0; i < 20; i += 1) {
      const result = undo(map, history);
      map = result!.map;
      history = result!.state;
    }

    expect(JSON.stringify(map)).toBe(initialJson);
  });

  it("handles water painting undo and redo", () => {
    let map = loadPublishedMapAsset();
    const initialJson = JSON.stringify(map);
    let history = createHistoryState(10);

    const before = map;
    map = paintWater(map, { worldX: 20, worldZ: 20, radius: 4, value: true });
    const changes = diffMapWater(before, map);

    history = pushTransaction(history, {
      type: "paint_water",
      changes,
    });

    // Undo
    const undoRes = undo(map, history);
    expect(undoRes).not.toBeNull();
    map = undoRes!.map;
    history = undoRes!.state;
    expect(JSON.stringify(map)).toBe(initialJson);

    // Redo
    const redoRes = redo(map, history);
    expect(redoRes).not.toBeNull();
    map = redoRes!.map;
    history = redoRes!.state;
    expect(map.chunks[0].water.some((row) => row.some((w) => w))).toBe(true);
  });

  it("handles chunk addition and removal undo and redo", () => {
    let map = loadPublishedMapAsset();
    const initialChunksCount = map.chunks.length;
    const initialBounds = map.bounds;
    let history = createHistoryState(10);

    // Add chunk (1, 0)
    const beforeAdd = map;
    map = addChunk(map, 1, 0);
    const addedChunk = map.chunks.find((c) => c.x === 1 && c.z === 0)!;

    history = pushTransaction(history, {
      type: "add_chunk",
      chunk: addedChunk,
      previousBounds: beforeAdd.bounds,
      newBounds: map.bounds,
    });

    expect(map.chunks).toHaveLength(initialChunksCount + 1);

    // Undo add chunk
    let res = undo(map, history);
    expect(res).not.toBeNull();
    map = res!.map;
    history = res!.state;
    expect(map.chunks).toHaveLength(initialChunksCount);
    expect(map.bounds).toEqual(initialBounds);

    // Redo add chunk
    res = redo(map, history);
    expect(res).not.toBeNull();
    map = res!.map;
    history = res!.state;
    expect(map.chunks).toHaveLength(initialChunksCount + 1);

    // Remove chunk (1, 0)
    const beforeRemove = map;
    map = removeChunk(map, addedChunk.id);
    history = pushTransaction(history, {
      type: "remove_chunk",
      chunk: addedChunk,
      previousBounds: beforeRemove.bounds,
      newBounds: map.bounds,
    });

    expect(map.chunks).toHaveLength(initialChunksCount);

    // Undo remove chunk -> chunk re-added
    res = undo(map, history);
    expect(res!.map.chunks).toHaveLength(initialChunksCount + 1);
    expect(res!.map.chunks.some((c) => c.id === addedChunk.id)).toBe(true);
  });

  it("handles NPC mutations (create, update, delete)", () => {
    let map = loadPublishedMapAsset();
    const initialNpcCount = map.npcs.length;
    let history = createHistoryState(10);

    // Create NPC
    const created = createNpcDefinition(map, { label: "Bob" });
    map = created.map;
    history = pushTransaction(history, {
      type: "npc_mutate",
      newNpc: created.npc,
    });
    expect(map.npcs).toHaveLength(initialNpcCount + 1);

    // Undo create -> NPC removed
    let res = undo(map, history);
    map = res!.map;
    history = res!.state;
    expect(map.npcs).toHaveLength(initialNpcCount);

    // Redo create -> NPC restored
    res = redo(map, history);
    map = res!.map;
    history = res!.state;
    expect(map.npcs).toHaveLength(initialNpcCount + 1);

    // Update NPC position
    const oldNpc = map.npcs[0];
    map = updateNpcDefinition(map, oldNpc.id, { position: { x: 12, y: 1, z: 12 } });
    const updatedNpc = map.npcs[0];
    history = pushTransaction(history, {
      type: "npc_mutate",
      oldNpc,
      newNpc: updatedNpc,
    });

    // Undo update
    res = undo(map, history);
    map = res!.map;
    history = res!.state;
    expect(map.npcs[0].position.x).toBe(oldNpc.position.x);

    // Delete NPC
    const toDelete = map.npcs[0];
    map = deleteNpcDefinition(map, toDelete.id);
    history = pushTransaction(history, {
      type: "npc_mutate",
      oldNpc: toDelete,
    });
    expect(map.npcs).toHaveLength(initialNpcCount);

    // Undo delete -> NPC re-appears
    res = undo(map, history);
    map = res!.map;
    expect(map.npcs).toHaveLength(initialNpcCount + 1);
  });

  it("respects circular buffer maxDepth and clears redoStack on new transactions", () => {
    const map = loadPublishedMapAsset();
    let history = createHistoryState(3);

    for (let i = 0; i < 5; i += 1) {
      history = pushTransaction(history, {
        type: "sculpt_terrain",
        changes: [],
        description: `Tx ${i}`,
      });
    }

    // Depth was capped at 3
    expect(history.undoStack).toHaveLength(3);
    expect(history.undoStack[0].description).toBe("Tx 2");
    expect(history.undoStack[2].description).toBe("Tx 4");

    // Undo once
    const undoRes = undo(map, history)!;
    history = undoRes.state;
    expect(history.undoStack).toHaveLength(2);
    expect(history.redoStack).toHaveLength(1);

    // Pushing a new transaction clears redoStack
    history = pushTransaction(history, {
      type: "sculpt_terrain",
      changes: [],
      description: "Tx New",
    });
    expect(history.redoStack).toHaveLength(0);
    expect(history.undoStack).toHaveLength(3);
  });
});
