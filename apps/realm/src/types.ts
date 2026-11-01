import type {
  CharacterBodyType,
  EntitySnapshot,
  MapNpcDefinition,
  Vector3Like,
} from "@villages/shared";

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

type NpcBaseEntity = {
  id: string;
  label: string;
  position: Vector3Like;
  velocityY: number;
};

export type StandingNpcEntity = NpcBaseEntity & {
  behavior: { type: "standing" };
};

export type PatrolNpcEntity = NpcBaseEntity & {
  behavior: {
    type: "patrol";
    points: Vector3Like[];
    patrolIndex: number;
  };
};

export type WanderingNpcEntity = NpcBaseEntity & {
  behavior: {
    type: "wandering";
    home: Vector3Like;
    radius: number;
    target: Vector3Like | null;
  };
};

export type NpcEntity = StandingNpcEntity | PatrolNpcEntity | WanderingNpcEntity;

export type NpcDefinition = MapNpcDefinition;

export function toSnapshot(entity: PlayerEntity | NpcEntity): EntitySnapshot {
  if ("playerId" in entity) {
    return {
      id: entity.id,
      kind: "player",
      label: entity.label,
      bodyType: entity.bodyType,
      position: entity.position,
      velocityY: entity.velocityY,
      chunkId: "",
    };
  }

  return {
    id: entity.id,
    kind: "npc",
    label: entity.label,
    position: entity.position,
    velocityY: entity.velocityY,
    chunkId: "",
  };
}
