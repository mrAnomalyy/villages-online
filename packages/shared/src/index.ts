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

export type TerrainChunkDTO = {
  id: string;
  x: number;
  z: number;
  size: number;
  heights: number[][];
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
export const CHUNK_SIZE = 16;

export function sanitizeNickname(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

