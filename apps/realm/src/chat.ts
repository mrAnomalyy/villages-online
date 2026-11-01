import { randomUUID } from "node:crypto";
import type {
  ClientChatMessage,
  ServerChatMessage,
  ServerSocketMessage,
  Vector3Like,
} from "@villages/shared";
import {
  CHAT_EMOTE_DISTANCE,
  CHAT_RATE_LIMIT_MAX,
  CHAT_RATE_LIMIT_WINDOW_MS,
  CHAT_SAY_DISTANCE,
  CHAT_YELL_DISTANCE,
} from "@villages/shared";

export type SocketLike = {
  send: (data: string) => void;
  readyState?: number;
};

export type ChatParticipant = {
  id: string;
  playerId: string;
  label: string;
  position: Vector3Like;
};

export interface IRateLimiter {
  isRateLimited(playerId: string, now?: number): boolean | Promise<boolean>;
  reset(playerId?: string): void;
}

export class ChatRateLimiter implements IRateLimiter {
  private readonly history = new Map<string, number[]>();

  constructor(
    private readonly maxMessages = CHAT_RATE_LIMIT_MAX,
    private readonly windowMs = CHAT_RATE_LIMIT_WINDOW_MS
  ) {}

  isRateLimited(playerId: string, now = Date.now()): boolean {
    const timestamps = this.history.get(playerId) ?? [];
    const valid = timestamps.filter((t) => now - t < this.windowMs);
    if (valid.length >= this.maxMessages) {
      this.history.set(playerId, valid);
      return true;
    }
    valid.push(now);
    this.history.set(playerId, valid);
    return false;
  }

  reset(playerId?: string): void {
    if (playerId) {
      this.history.delete(playerId);
    } else {
      this.history.clear();
    }
  }
}

export function isWithinHorizontalDistance(
  a: Vector3Like,
  b: Vector3Like,
  maxDistance: number
): boolean {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz) <= maxDistance;
}

export type ChatRouterContext = {
  sender: ChatParticipant;
  senderSocket: SocketLike;
  players: Map<string, ChatParticipant>;
  sockets: Map<string, SocketLike>;
  rateLimiter?: IRateLimiter;
  generateId?: () => string;
  now?: () => number;
};

export type ChatDispatchResult = {
  deliveredCount: number;
  rateLimited?: boolean;
  error?: string;
  serverMessage?: ServerChatMessage;
};

function isSocketOpen(socket?: SocketLike): boolean {
  if (!socket) return false;
  return socket.readyState === undefined || socket.readyState === 1;
}

export async function handleIncomingChat(
  context: ChatRouterContext,
  message: ClientChatMessage
): Promise<ChatDispatchResult> {
  const { sender, senderSocket, players, sockets, rateLimiter } = context;

  const currentTime = context.now ? context.now() : Date.now();

  if (rateLimiter) {
    const limited = await rateLimiter.isRateLimited(sender.playerId, currentTime);
    if (limited) {
      senderSocket.send(
        JSON.stringify({
          type: "error",
          message: "You are sending messages too quickly.",
        } satisfies ServerSocketMessage)
      );
      return { deliveredCount: 0, rateLimited: true, error: "Rate limit exceeded" };
    }
  }

  const rawText = message.text?.trim() ?? "";
  if (!rawText) {
    return { deliveredCount: 0, error: "Empty message" };
  }

  const generateId = context.generateId ?? randomUUID;

  const baseServerMessage = {
    type: "chatMessage" as const,
    id: generateId(),
    senderId: sender.id,
    senderNickname: sender.label,
    text: rawText,
    timestamp: currentTime,
  };

  switch (message.channel) {
    case "say": {
      const serverMessage: ServerChatMessage = {
        ...baseServerMessage,
        channel: "say",
        position: sender.position,
      };
      const payload = JSON.stringify(serverMessage satisfies ServerSocketMessage);
      let count = 0;
      for (const [characterId, participant] of players.entries()) {
        if (isWithinHorizontalDistance(sender.position, participant.position, CHAT_SAY_DISTANCE)) {
          const socket = sockets.get(characterId);
          if (isSocketOpen(socket)) {
            socket!.send(payload);
            count++;
          }
        }
      }
      return { deliveredCount: count, serverMessage };
    }

    case "yell": {
      const serverMessage: ServerChatMessage = {
        ...baseServerMessage,
        channel: "yell",
        position: sender.position,
      };
      const payload = JSON.stringify(serverMessage satisfies ServerSocketMessage);
      let count = 0;
      for (const [characterId, participant] of players.entries()) {
        if (isWithinHorizontalDistance(sender.position, participant.position, CHAT_YELL_DISTANCE)) {
          const socket = sockets.get(characterId);
          if (isSocketOpen(socket)) {
            socket!.send(payload);
            count++;
          }
        }
      }
      return { deliveredCount: count, serverMessage };
    }

    case "emote": {
      const serverMessage: ServerChatMessage = {
        ...baseServerMessage,
        channel: "emote",
        position: sender.position,
      };
      const payload = JSON.stringify(serverMessage satisfies ServerSocketMessage);
      let count = 0;
      for (const [characterId, participant] of players.entries()) {
        if (
          isWithinHorizontalDistance(sender.position, participant.position, CHAT_EMOTE_DISTANCE)
        ) {
          const socket = sockets.get(characterId);
          if (isSocketOpen(socket)) {
            socket!.send(payload);
            count++;
          }
        }
      }
      return { deliveredCount: count, serverMessage };
    }

    case "lfg": {
      const serverMessage: ServerChatMessage = {
        ...baseServerMessage,
        channel: "lfg",
      };
      const payload = JSON.stringify(serverMessage satisfies ServerSocketMessage);
      let count = 0;
      for (const [characterId] of players.entries()) {
        const socket = sockets.get(characterId);
        if (isSocketOpen(socket)) {
          socket!.send(payload);
          count++;
        }
      }
      return { deliveredCount: count, serverMessage };
    }

    case "whisper": {
      const targetNickname = (message.targetNickname ?? "").trim();
      const normalizedTarget = targetNickname.toLowerCase();
      let targetCharacterId: string | undefined;
      let targetParticipant: ChatParticipant | undefined;

      for (const [charId, participant] of players.entries()) {
        if (participant.label.trim().toLowerCase() === normalizedTarget) {
          targetCharacterId = charId;
          targetParticipant = participant;
          break;
        }
      }

      if (!targetParticipant || !targetCharacterId) {
        senderSocket.send(
          JSON.stringify({
            type: "error",
            message: `Player ${targetNickname} is not online.`,
          } satisfies ServerSocketMessage)
        );
        return { deliveredCount: 0, error: `Player ${targetNickname} is not online.` };
      }

      const serverMessage: ServerChatMessage = {
        ...baseServerMessage,
        channel: "whisper",
        targetNickname: targetParticipant.label,
      };
      const payload = JSON.stringify(serverMessage satisfies ServerSocketMessage);
      const targetSocket = sockets.get(targetCharacterId);

      let count = 0;
      if (isSocketOpen(targetSocket)) {
        targetSocket!.send(payload);
        count++;
      }

      if (targetCharacterId !== sender.id && isSocketOpen(senderSocket)) {
        senderSocket.send(payload);
        count++;
      }

      return { deliveredCount: count, serverMessage };
    }
  }
}
