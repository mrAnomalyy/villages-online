import { describe, expect, it } from "vitest";
import { addChunk, appendPatrolPoint, createNpcDefinition, deleteNpcDefinition, paintWater, removeChunk, removePatrolPoint, sculptTerrain, updateNpcDefinition } from "./editor";
import { loadPublishedMapAsset } from "./asset-store";

describe("editor map mutations", () => {
  it("adds and removes chunks", () => {
    const map = loadPublishedMapAsset();
    const withChunk = addChunk(map, 1, 0);
    expect(withChunk.chunks).toHaveLength(2);
    expect(withChunk.bounds.maxChunkX).toBe(1);

    const removed = removeChunk(withChunk, "1:0");
    expect(removed.chunks).toHaveLength(1);
  });

  it("sculpts terrain up and down", () => {
    const map = loadPublishedMapAsset();
    const raised = sculptTerrain(map, {
      chunkId: "0:0",
      row: 7,
      column: 7,
      radius: 1,
      delta: 1,
      intensity: 2,
    });
    expect(raised.chunks[0].heights[7][7]).toBeGreaterThan(map.chunks[0].heights[7][7]);

    const lowered = sculptTerrain(raised, {
      chunkId: "0:0",
      row: 7,
      column: 7,
      radius: 1,
      delta: -1,
      intensity: 2,
    });
    expect(lowered.chunks[0].heights[7][7]).toBeLessThan(raised.chunks[0].heights[7][7]);
  });

  it("paints and clears water", () => {
    const map = loadPublishedMapAsset();
    const painted = paintWater(map, {
      chunkId: "0:0",
      row: 4,
      column: 4,
      radius: 0,
      value: true,
    });
    expect(painted.chunks[0].water[4][4]).toBe(true);

    const cleared = paintWater(painted, {
      chunkId: "0:0",
      row: 12,
      column: 4,
      radius: 0,
      value: false,
    });
    expect(cleared.chunks[0].water[12][4]).toBe(false);
  });

  it("creates, updates, and deletes NPCs", () => {
    const map = loadPublishedMapAsset();
    const created = createNpcDefinition(map, {
      label: "Scout",
      position: { x: 4, y: 1, z: 4 },
    });

    expect(created.map.npcs).toHaveLength(3);
    expect(created.npc.label).toBe("Scout");

    const updated = updateNpcDefinition(created.map, created.npc.id, {
      behavior: { type: "wandering", radius: 6 },
      label: "Scout Prime",
    });
    expect(updated.npcs.at(-1)?.label).toBe("Scout Prime");
    expect(updated.npcs.at(-1)?.behavior.type).toBe("wandering");

    const deleted = deleteNpcDefinition(updated, created.npc.id);
    expect(deleted.npcs).toHaveLength(2);
  });

  it("edits patrol points and falls back to standing", () => {
    const map = loadPublishedMapAsset();
    const appended = appendPatrolPoint(map, "guide", { x: 8, y: 1, z: 8 });
    const guide = appended.npcs.find((npc) => npc.id === "guide");
    expect(guide?.behavior.type).toBe("patrol");

    const withoutFirst = removePatrolPoint(appended, "guide", 0);
    const downgraded = removePatrolPoint(withoutFirst, "guide", 0);
    expect(downgraded.npcs.find((npc) => npc.id === "guide")?.behavior.type).toBe("standing");
  });
});
