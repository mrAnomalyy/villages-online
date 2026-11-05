import { describe, expect, it, vi } from "vitest";
import type { EntityDespawnMessage, EntitySnapshot } from "@villages/shared";
import { handleEntityDespawnMessage } from "./scene-canvas";

describe("handleEntityDespawnMessage", () => {
  it("removes the entity from entitiesRef and invokes disposeFn", () => {
    const entities: EntitySnapshot[] = [
      {
        id: "player-1",
        kind: "player",
        label: "Alice",
        position: { x: 10, y: 1, z: 10 },
        chunkId: "0:0",
      },
      {
        id: "player-2",
        kind: "player",
        label: "Bob",
        position: { x: 20, y: 1, z: 20 },
        chunkId: "0:0",
      },
    ];

    const entitiesRef = { current: [...entities] };
    const disposeFn = vi.fn();

    const message: EntityDespawnMessage = {
      type: "entityDespawn",
      entityId: "player-1",
    };

    handleEntityDespawnMessage(entitiesRef, disposeFn, message);

    expect(entitiesRef.current).toHaveLength(1);
    expect(entitiesRef.current[0].id).toBe("player-2");
    expect(disposeFn).toHaveBeenCalledWith("player-1");
  });

  it("handles non-existent entity gracefully and invokes disposeFn for cleanup", () => {
    const entities: EntitySnapshot[] = [
      {
        id: "player-2",
        kind: "player",
        label: "Bob",
        position: { x: 20, y: 1, z: 20 },
        chunkId: "0:0",
      },
    ];

    const entitiesRef = { current: [...entities] };
    const disposeFn = vi.fn();

    const message: EntityDespawnMessage = {
      type: "entityDespawn",
      entityId: "unknown-entity",
    };

    handleEntityDespawnMessage(entitiesRef, disposeFn, message);

    expect(entitiesRef.current).toHaveLength(1);
    expect(entitiesRef.current[0].id).toBe("player-2");
    expect(disposeFn).toHaveBeenCalledWith("unknown-entity");
  });
});
