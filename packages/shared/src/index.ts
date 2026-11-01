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

export type TerrainChunkDTO = {
  id: string;
  x: number;
  z: number;
  size: number;
  resolution: number;
  heights: number[][];
  water: WaterMask;
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

export type ChatChannel = "say" | "yell" | "whisper" | "lfg" | "emote";

export type ClientChatMessage = {
  type: "chat";
  channel: ChatChannel;
  text: string;
  targetNickname?: string;
};

export type ServerChatMessage = {
  type: "chatMessage";
  id: string;
  senderId: string;
  senderNickname: string;
  channel: ChatChannel;
  text: string;
  position?: Vector3Like;
  targetNickname?: string;
  timestamp: number;
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
    }
  | ClientChatMessage;

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
    }
  | ServerChatMessage;

export const PLAYER_SPEED = 6;
export const JUMP_VELOCITY = 7;
export const GRAVITY = 18;
export const TICK_RATE = 10;
export const CHUNK_SIZE = 128;
export const CHUNK_RESOLUTION = 64;

export const CHAT_SAY_DISTANCE = 25;
export const CHAT_YELL_DISTANCE = 100;
export const CHAT_EMOTE_DISTANCE = 25;
export const CHAT_RATE_LIMIT_MAX = 5;
export const CHAT_RATE_LIMIT_WINDOW_MS = 3000;

export function sanitizeNickname(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function parseChatInput(
  raw: string,
  defaultChannel: ChatChannel = "say"
): { channel: ChatChannel; text: string; targetNickname?: string } {
  const trimmed = raw.trim();

  const whisperMatch = trimmed.match(/^\/(?:w|whisper)(?:\s+(\S+)(?:\s+(.*))?)?$/i);
  if (whisperMatch) {
    return {
      channel: "whisper",
      targetNickname: whisperMatch[1] ?? "",
      text: (whisperMatch[2] ?? "").trim(),
    };
  }

  const sayMatch = trimmed.match(/^\/(?:s|say)(?:\s+(.*))?$/i);
  if (sayMatch) {
    return {
      channel: "say",
      text: (sayMatch[1] ?? "").trim(),
    };
  }

  const yellMatch = trimmed.match(/^\/(?:y|yell)(?:\s+(.*))?$/i);
  if (yellMatch) {
    return {
      channel: "yell",
      text: (yellMatch[1] ?? "").trim(),
    };
  }

  const lfgMatch = trimmed.match(/^\/(?:lfg|4)(?:\s+(.*))?$/i);
  if (lfgMatch) {
    return {
      channel: "lfg",
      text: (lfgMatch[1] ?? "").trim(),
    };
  }

  const emoteMatch = trimmed.match(/^\/(?:e|emote)(?:\s+(.*))?$/i);
  if (emoteMatch) {
    return {
      channel: "emote",
      text: (emoteMatch[1] ?? "").trim(),
    };
  }

  return {
    channel: defaultChannel,
    text: trimmed,
  };
}

export function formatChatMessage(message: ServerChatMessage, viewerNickname?: string): string {
  switch (message.channel) {
    case "say":
      return `[Say] ${message.senderNickname}: ${message.text}`;
    case "yell":
      return `[Yell] ${message.senderNickname}: ${message.text}`;
    case "whisper":
      if (
        viewerNickname &&
        message.senderNickname.toLowerCase() === viewerNickname.toLowerCase() &&
        message.targetNickname
      ) {
        return `To ${message.targetNickname}: ${message.text}`;
      }
      return `${message.senderNickname} whispers: ${message.text}`;
    case "lfg":
      return `[4. LFG] ${message.senderNickname}: ${message.text}`;
    case "emote":
      return `${message.senderNickname} ${message.text}`;
  }
}
