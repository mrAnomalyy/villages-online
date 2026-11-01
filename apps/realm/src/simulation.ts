import {
  GRAVITY,
  JUMP_VELOCITY,
  type MapNpcDefinition,
  PLAYER_SPEED,
  type EntitySnapshot,
  type MapAsset,
  type Vector3Like,
} from "@villages/shared";
import { getHeightAt, resolveChunkIdForPosition } from "@villages/world";
import type { NpcEntity, PlayerEntity } from "./types";

export function applyMovement(entity: PlayerEntity, deltaSeconds: number, map: MapAsset): void {
  entity.position.x += entity.direction.x * PLAYER_SPEED * deltaSeconds;
  entity.position.z += entity.direction.z * PLAYER_SPEED * deltaSeconds;

  entity.velocityY -= GRAVITY * deltaSeconds;
  entity.position.y += entity.velocityY * deltaSeconds;

  const ground = getHeightAt(map, entity.position.x, entity.position.z) + 1;
  if (entity.position.y <= ground) {
    entity.position.y = ground;
    entity.velocityY = 0;
  }
}

export function applyJump(entity: PlayerEntity, map: MapAsset): void {
  const ground = getHeightAt(map, entity.position.x, entity.position.z) + 1;
  if (Math.abs(entity.position.y - ground) < 0.01) {
    entity.velocityY = JUMP_VELOCITY;
  }
}

function moveToward(
  entity: NpcEntity,
  target: Vector3Like,
  deltaSeconds: number,
  map: MapAsset
): number {
  const dx = target.x - entity.position.x;
  const dz = target.z - entity.position.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.001) {
    entity.position.y = getHeightAt(map, entity.position.x, entity.position.z) + 1;
    return distance;
  }

  entity.position.x += (dx / distance) * 1.8 * deltaSeconds;
  entity.position.z += (dz / distance) * 1.8 * deltaSeconds;
  entity.position.y = getHeightAt(map, entity.position.x, entity.position.z) + 1;
  return distance;
}

function nextWanderTarget(
  entity: Extract<NpcEntity, { behavior: { type: "wandering" } }>
): Vector3Like {
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.random() * entity.behavior.radius;
  return {
    x: entity.behavior.home.x + Math.cos(angle) * radius,
    y: entity.behavior.home.y,
    z: entity.behavior.home.z + Math.sin(angle) * radius,
  };
}

export function stepNpc(entity: NpcEntity, deltaSeconds: number, map: MapAsset): void {
  if (entity.behavior.type === "standing") {
    entity.position.y = getHeightAt(map, entity.position.x, entity.position.z) + 1;
    return;
  }

  if (entity.behavior.type === "patrol") {
    const target = entity.behavior.points[entity.behavior.patrolIndex];
    const distance = moveToward(entity, target, deltaSeconds, map);
    if (distance < 0.25) {
      entity.behavior.patrolIndex =
        (entity.behavior.patrolIndex + 1) % entity.behavior.points.length;
    }
    return;
  }

  const wanderingNpc = entity as Extract<NpcEntity, { behavior: { type: "wandering" } }>;
  if (!wanderingNpc.behavior.target) {
    wanderingNpc.behavior.target = nextWanderTarget(wanderingNpc);
  }

  const distance = moveToward(wanderingNpc, wanderingNpc.behavior.target, deltaSeconds, map);
  if (distance < 0.35) {
    wanderingNpc.behavior.target = nextWanderTarget(wanderingNpc);
  }
}

export function withChunk(
  snapshot: Omit<EntitySnapshot, "chunkId">,
  chunkSize?: number
): EntitySnapshot {
  return {
    ...snapshot,
    chunkId: resolveChunkIdForPosition(snapshot.position.x, snapshot.position.z, chunkSize),
  };
}

export function createNpc(definition: MapNpcDefinition, map: MapAsset): NpcEntity {
  const base = {
    id: definition.id,
    label: definition.label,
    position: {
      x: definition.position.x,
      y: getHeightAt(map, definition.position.x, definition.position.z) + 1,
      z: definition.position.z,
    },
    velocityY: 0,
  };

  if (definition.behavior.type === "standing") {
    return {
      ...base,
      behavior: { type: "standing" },
    };
  }

  if (definition.behavior.type === "patrol") {
    return {
      ...base,
      behavior: {
        type: "patrol",
        points: definition.behavior.points.map((point) => ({ ...point })),
        patrolIndex: 1 % definition.behavior.points.length,
      },
    };
  }

  return {
    ...base,
    behavior: {
      type: "wandering",
      home: { ...definition.position },
      radius: definition.behavior.radius,
      target: null,
    },
  };
}
