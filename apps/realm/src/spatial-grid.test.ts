import { describe, expect, it } from "vitest";
import { get3x3ChunkIds, SpatialGrid } from "./spatial-grid";

describe("SpatialGrid", () => {
  it("inserts and tracks entities by chunk", () => {
    const grid = new SpatialGrid();
    grid.insert("player-1", "0:0");
    grid.insert("player-2", "0:0");
    grid.insert("player-3", "1:1");

    expect(grid.size).toBe(3);
    expect(grid.getChunkForEntity("player-1")).toBe("0:0");
    expect(grid.getChunkForEntity("player-2")).toBe("0:0");
    expect(grid.getChunkForEntity("player-3")).toBe("1:1");
    expect(grid.getChunkForEntity("player-unknown")).toBeUndefined();

    const entitiesIn00 = grid.getEntitiesInChunks(["0:0"]);
    expect(entitiesIn00.size).toBe(2);
    expect(entitiesIn00.has("player-1")).toBe(true);
    expect(entitiesIn00.has("player-2")).toBe(true);
    expect(entitiesIn00.has("player-3")).toBe(false);
  });

  it("updates entity chunk location and cleans up old chunk sets", () => {
    const grid = new SpatialGrid();
    grid.insert("player-1", "0:0");

    // Move from 0:0 to 1:0
    grid.update("player-1", "1:0");
    expect(grid.getChunkForEntity("player-1")).toBe("1:0");
    expect(grid.getEntitiesInChunks(["0:0"]).size).toBe(0);
    expect(grid.getEntitiesInChunks(["1:0"]).has("player-1")).toBe(true);

    // Update with same chunk is no-op
    grid.update("player-1", "1:0");
    expect(grid.getChunkForEntity("player-1")).toBe("1:0");

    // Update uninserted entity inserts it
    grid.update("player-2", "2:2");
    expect(grid.getChunkForEntity("player-2")).toBe("2:2");
    expect(grid.getEntitiesInChunks(["2:2"]).has("player-2")).toBe(true);
  });

  it("removes entities cleanly", () => {
    const grid = new SpatialGrid();
    grid.insert("player-1", "0:0");
    grid.insert("player-2", "0:0");

    grid.remove("player-1");
    expect(grid.getChunkForEntity("player-1")).toBeUndefined();
    expect(grid.getEntitiesInChunks(["0:0"]).size).toBe(1);
    expect(grid.getEntitiesInChunks(["0:0"]).has("player-2")).toBe(true);

    // Removing remaining entity removes chunk set completely
    grid.remove("player-2");
    expect(grid.getChunkForEntity("player-2")).toBeUndefined();
    expect(grid.getEntitiesInChunks(["0:0"]).size).toBe(0);

    // Removing non-existent entity does not throw
    expect(() => grid.remove("ghost")).not.toThrow();
  });

  it("re-inserting an entity moves it properly", () => {
    const grid = new SpatialGrid();
    grid.insert("player-1", "0:0");
    grid.insert("player-1", "1:1");

    expect(grid.size).toBe(1);
    expect(grid.getChunkForEntity("player-1")).toBe("1:1");
    expect(grid.getEntitiesInChunks(["0:0"]).size).toBe(0);
    expect(grid.getEntitiesInChunks(["1:1"]).has("player-1")).toBe(true);
  });

  it("clears all entities", () => {
    const grid = new SpatialGrid();
    grid.insert("player-1", "0:0");
    grid.insert("player-2", "1:1");
    grid.clear();

    expect(grid.size).toBe(0);
    expect(grid.getChunkForEntity("player-1")).toBeUndefined();
    expect(grid.getEntitiesInChunks(["0:0", "1:1"]).size).toBe(0);
  });

  describe("get3x3ChunkIds", () => {
    it("returns 9 neighbor chunks centered on the given chunk", () => {
      const neighbors = get3x3ChunkIds("0:0");
      expect(neighbors).toHaveLength(9);
      expect(neighbors).toEqual(
        expect.arrayContaining([
          "-1:-1",
          "0:-1",
          "1:-1",
          "-1:0",
          "0:0",
          "1:0",
          "-1:1",
          "0:1",
          "1:1",
        ])
      );
    });

    it("handles negative chunk coordinates correctly", () => {
      const neighbors = get3x3ChunkIds("-2:-3");
      expect(neighbors).toHaveLength(9);
      expect(neighbors).toContain("-3:-4");
      expect(neighbors).toContain("-2:-3");
      expect(neighbors).toContain("-1:-2");
    });
  });

  describe("neighborhood AoI querying", () => {
    it("returns only entities within the 3x3 neighborhood", () => {
      const grid = new SpatialGrid();

      // Center chunk 0:0
      grid.insert("player-center", "0:0");
      // Immediate neighbor in 1:1
      grid.insert("player-neighbor", "1:1");
      // Distant player in 3:3 (outside 3x3 of 0:0)
      grid.insert("player-distant", "3:3");

      const neighborChunks = get3x3ChunkIds("0:0");
      const visibleEntities = grid.getEntitiesInChunks(neighborChunks);

      expect(visibleEntities.has("player-center")).toBe(true);
      expect(visibleEntities.has("player-neighbor")).toBe(true);
      expect(visibleEntities.has("player-distant")).toBe(false);
    });
  });

  describe("load benchmark (100 players across 16 chunks)", () => {
    it("maintains tick processing time well under 10ms", () => {
      const grid = new SpatialGrid();
      const playerCount = 100;
      const chunks = [
        "0:0",
        "0:1",
        "0:2",
        "0:3",
        "1:0",
        "1:1",
        "1:2",
        "1:3",
        "2:0",
        "2:1",
        "2:2",
        "2:3",
        "3:0",
        "3:1",
        "3:2",
        "3:3",
      ];

      // Spawn 100 players across the 16 chunks
      const players: Array<{ id: string; chunk: string }> = [];
      for (let i = 0; i < playerCount; i += 1) {
        const chunk = chunks[i % chunks.length];
        const id = `player-${i}`;
        players.push({ id, chunk });
        grid.insert(id, chunk);
      }

      expect(grid.size).toBe(playerCount);

      // Simulate 20 ticks (1 second at 20Hz)
      const tickDurations: number[] = [];
      const socketSubscribed = new Map<string, Set<string>>();

      for (let tick = 0; tick < 20; tick += 1) {
        const tickStart = performance.now();

        // 1. Move some players to adjacent chunks
        for (let i = 0; i < playerCount; i += 5) {
          const nextChunk = chunks[(tick + i) % chunks.length];
          players[i].chunk = nextChunk;
          grid.update(players[i].id, nextChunk);
        }

        // 2. Perform AoI neighborhood query and despawn detection for every player
        for (const player of players) {
          const neighborChunks = get3x3ChunkIds(player.chunk);
          const inRange = grid.getEntitiesInChunks(neighborChunks);
          inRange.delete(player.id); // exclude self

          const prev = socketSubscribed.get(player.id) ?? new Set<string>();
          const despawned: string[] = [];
          for (const prevId of prev) {
            if (!inRange.has(prevId)) {
              despawned.push(prevId);
            }
          }

          socketSubscribed.set(player.id, inRange);
        }

        const tickDuration = performance.now() - tickStart;
        tickDurations.push(tickDuration);
      }

      const maxTickTime = Math.max(...tickDurations);
      const avgTickTime = tickDurations.reduce((acc, curr) => acc + curr, 0) / tickDurations.length;

      // Acceptance criterion: tick time < 10ms
      expect(maxTickTime).toBeLessThan(10);
      expect(avgTickTime).toBeLessThan(5);
    });
  });
});
