import { GRAVITY, JUMP_VELOCITY, PLAYER_SPEED, type EntitySnapshot, type Vector3Like } from "@villages/shared";
import { getHeightAt, resolveChunkIdForPosition } from "@villages/world";
import type { NpcEntity, PlayerEntity } from "./types";

export function applyMovement(entity: PlayerEntity, deltaSeconds: number): void {
  entity.position.x += entity.direction.x * PLAYER_SPEED * deltaSeconds;
  entity.position.z += entity.direction.z * PLAYER_SPEED * deltaSeconds;

  entity.velocityY -= GRAVITY * deltaSeconds;
  entity.position.y += entity.velocityY * deltaSeconds;

  const ground = getHeightAt(entity.position.x, entity.position.z) + 1;
  if (entity.position.y <= ground) {
    entity.position.y = ground;
    entity.velocityY = 0;
  }
}

export function applyJump(entity: PlayerEntity): void {
  const ground = getHeightAt(entity.position.x, entity.position.z) + 1;
  if (Math.abs(entity.position.y - ground) < 0.01) {
    entity.velocityY = JUMP_VELOCITY;
  }
}

export function stepNpc(entity: NpcEntity, deltaSeconds: number): void {
  const target = entity.patrolPath[entity.patrolIndex];
  const dx = target.x - entity.position.x;
  const dz = target.z - entity.position.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.2) {
    entity.patrolIndex = (entity.patrolIndex + 1) % entity.patrolPath.length;
    return;
  }

  entity.position.x += (dx / distance) * 1.8 * deltaSeconds;
  entity.position.z += (dz / distance) * 1.8 * deltaSeconds;
  entity.position.y = getHeightAt(entity.position.x, entity.position.z) + 1;
}

export function withChunk(snapshot: Omit<EntitySnapshot, "chunkId">): EntitySnapshot {
  return {
    ...snapshot,
    chunkId: resolveChunkIdForPosition(snapshot.position.x, snapshot.position.z)
  };
}

export function createNpc(id: string, label: string, patrolPath: Vector3Like[]): NpcEntity {
  return {
    id,
    label,
    position: { ...patrolPath[0] },
    patrolPath,
    patrolIndex: 1,
    velocityY: 0
  };
}

