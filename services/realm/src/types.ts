import type { CharacterBodyType, EntitySnapshot, Vector3Like } from "@villages/shared";

export type PlayerEntity = {
  id: string;
  playerId: string;
  label: string;
  bodyType: CharacterBodyType;
  position: Vector3Like;
  velocityY: number;
  direction: {
    x: number;
    z: number;
  };
};

export type NpcEntity = {
  id: string;
  label: string;
  position: Vector3Like;
  patrolPath: Vector3Like[];
  patrolIndex: number;
  velocityY: number;
};

export function toSnapshot(entity: PlayerEntity | NpcEntity): EntitySnapshot {
  if ("playerId" in entity) {
    return {
      id: entity.id,
      kind: "player",
      label: entity.label,
      bodyType: entity.bodyType,
      position: entity.position,
      velocityY: entity.velocityY,
      chunkId: ""
    };
  }

  return {
    id: entity.id,
    kind: "npc",
    label: entity.label,
    position: entity.position,
    velocityY: entity.velocityY,
    chunkId: ""
  };
}

