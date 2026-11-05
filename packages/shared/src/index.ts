export type RealmDescriptor = {
  id: string;
  name: string;
  httpUrl: string;
  wsUrl: string;
};

export type GuestAuthRequest = {
  nickname: string;
  existingToken?: string;
};

export type GuestAuthResponse = {
  playerId: string;
  nickname: string;
  token: string;
};

export type CharacterBodyType = "male" | "female";

export type CharacterSummary = {
  id: string;
  playerId: string;
  realmId: string;
  nickname: string;
  bodyType: CharacterBodyType;
  position: Vector3Like;
};

export type CreateCharacterRequest = {
  bodyType: CharacterBodyType;
};

export type RealmJoinTicket = {
  ticket: string;
  realm: RealmDescriptor;
  playerId: string;
  characterId: string;
};

export type Vector3Like = {
  x: number;
  y: number;
  z: number;
};

export type WaterMask = boolean[][];

export type SurfaceMaterialId = 0 | 1 | 2 | 3 | 4;

export const SURFACE_MATERIAL_GRASS: SurfaceMaterialId = 0;
export const SURFACE_MATERIAL_DIRT: SurfaceMaterialId = 1;
export const SURFACE_MATERIAL_COBBLESTONE: SurfaceMaterialId = 2;
export const SURFACE_MATERIAL_SAND: SurfaceMaterialId = 3;
export const SURFACE_MATERIAL_ROCK: SurfaceMaterialId = 4;

export const SURFACE_MATERIALS = [
  { id: 0 as SurfaceMaterialId, name: "Grass", color: "#648c54" },
  { id: 1 as SurfaceMaterialId, name: "Dirt", color: "#8c6640" },
  { id: 2 as SurfaceMaterialId, name: "Cobblestone", color: "#808085" },
  { id: 3 as SurfaceMaterialId, name: "Sand", color: "#d1bd85" },
  { id: 4 as SurfaceMaterialId, name: "Rock", color: "#52575c" },
] as const;

export type TerrainChunkDTO = {
  id: string;
  x: number;
  z: number;
  size: number;
  resolution: number;
  heights: number[][];
  water: WaterMask;
  surface?: number[][];
};

export type StandingNpcBehavior = {
  type: "standing";
};

export type PatrolNpcBehavior = {
  type: "patrol";
  points: Vector3Like[];
};

export type WanderingNpcBehavior = {
  type: "wandering";
  radius: number;
};

export type NpcBehavior = StandingNpcBehavior | PatrolNpcBehavior | WanderingNpcBehavior;

export type MapNpcDefinition = {
  id: string;
  label: string;
  position: Vector3Like;
  behavior: NpcBehavior;
};

export type MapBounds = {
  minChunkX: number;
  maxChunkX: number;
  minChunkZ: number;
  maxChunkZ: number;
};

export type MapAsset = {
  version: 1;
  mapId: string;
  name: string;
  chunkSize: number;
  chunkResolution: number;
  waterLevel: number;
  bounds: MapBounds;
  chunks: TerrainChunkDTO[];
  npcs: MapNpcDefinition[];
};

export type EntitySnapshot = {
  id: string;
  kind: "player" | "npc";
  label: string;
  bodyType?: CharacterBodyType;
  position: Vector3Like;
  velocityY?: number;
  chunkId: string;
};

export type InitialWorldPayload = {
  realmId: string;
  playerId: string;
  characterId: string;
  mapId: string;
  chunks: TerrainChunkDTO[];
  player: EntitySnapshot;
  entities: EntitySnapshot[];
};

export type ClientMovementInput = {
  type: "move";
  sequence: number;
  direction: {
    x: number;
    z: number;
  };
  running: boolean;
};

export type ClientJumpInput = {
  type: "jump";
  sequence: number;
};

export type ClientSocketMessage =
  | {
      type: "hello";
      ticket: string;
    }
  | ClientMovementInput
  | ClientJumpInput
  | {
      type: "subscribeChunks";
      centerChunkId: string;
    };

export type ServerSocketMessage =
  | {
      type: "welcome";
      payload: InitialWorldPayload;
    }
  | {
      type: "snapshot";
      self: EntitySnapshot;
      entities: EntitySnapshot[];
    }
  | {
      type: "chunks";
      chunks: TerrainChunkDTO[];
    }
  | {
      type: "error";
      message: string;
    };

export const PLAYER_SPEED = 6;
export const JUMP_VELOCITY = 7;
export const GRAVITY = 18;
export const TICK_RATE = 10;
export const CHUNK_SIZE = 128;
export const CHUNK_RESOLUTION = 64;

export function sanitizeNickname(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
