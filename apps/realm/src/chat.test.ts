import { describe, expect, it } from "vitest";
import {
  formatChatMessage,
  parseChatInput,
  type ClientChatMessage,
  type ServerChatMessage,
} from "@villages/shared";
import {
  ChatRateLimiter,
  handleIncomingChat,
  isWithinHorizontalDistance,
  type ChatParticipant,
  type SocketLike,
} from "./chat";

function createMockSocket(): SocketLike & { messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    readyState: 1,
    send(data: string) {
      messages.push(data);
    },
  };
}

describe("chat command parsing", () => {
  it("parses say commands correctly", () => {
    expect(parseChatInput("/s Hello world")).toEqual({
      channel: "say",
      text: "Hello world",
    });
    expect(parseChatInput("/say Looking good")).toEqual({
      channel: "say",
      text: "Looking good",
    });
  });

  it("parses yell commands correctly", () => {
    expect(parseChatInput("/y Incoming monsters!")).toEqual({
      channel: "yell",
      text: "Incoming monsters!",
    });
    expect(parseChatInput("/yell Beware the dragon")).toEqual({
      channel: "yell",
      text: "Beware the dragon",
    });
  });

  it("parses whisper commands correctly", () => {
    expect(parseChatInput("/w Valdis Meet me at the bridge")).toEqual({
      channel: "whisper",
      targetNickname: "Valdis",
      text: "Meet me at the bridge",
    });
    expect(parseChatInput("/whisper Eldon Need any herbs?")).toEqual({
      channel: "whisper",
      targetNickname: "Eldon",
      text: "Need any herbs?",
    });
    expect(parseChatInput("/w SoloPlayer")).toEqual({
      channel: "whisper",
      targetNickname: "SoloPlayer",
      text: "",
    });
  });

  it("parses lfg commands correctly", () => {
    expect(parseChatInput("/lfg LF healer for Sunken Temple")).toEqual({
      channel: "lfg",
      text: "LF healer for Sunken Temple",
    });
    expect(parseChatInput("/4 Any miners selling iron?")).toEqual({
      channel: "lfg",
      text: "Any miners selling iron?",
    });
  });

  it("parses emote commands correctly", () => {
    expect(parseChatInput("/e waves friendly")).toEqual({
      channel: "emote",
      text: "waves friendly",
    });
    expect(parseChatInput("/emote salutes respectfully")).toEqual({
      channel: "emote",
      text: "salutes respectfully",
    });
  });

  it("defaults to specified default channel when no slash command is used", () => {
    expect(parseChatInput("Just chatting here", "say")).toEqual({
      channel: "say",
      text: "Just chatting here",
    });
    expect(parseChatInput("Global announcement", "lfg")).toEqual({
      channel: "lfg",
      text: "Global announcement",
    });
  });

  it("formats chat messages in World of Warcraft style", () => {
    const sayMsg: ServerChatMessage = {
      type: "chatMessage",
      id: "1",
      senderId: "p1",
      senderNickname: "Arthur",
      channel: "say",
      text: "Greetings traveller.",
      timestamp: 1000,
    };
    expect(formatChatMessage(sayMsg)).toBe("[Say] Arthur: Greetings traveller.");

    const yellMsg: ServerChatMessage = {
      ...sayMsg,
      channel: "yell",
      text: "FOR THE REALM!",
    };
    expect(formatChatMessage(yellMsg)).toBe("[Yell] Arthur: FOR THE REALM!");

    const lfgMsg: ServerChatMessage = {
      ...sayMsg,
      channel: "lfg",
      text: "Need 2 DPS for dungeon",
    };
    expect(formatChatMessage(lfgMsg)).toBe("[4. LFG] Arthur: Need 2 DPS for dungeon");

    const emoteMsg: ServerChatMessage = {
      ...sayMsg,
      channel: "emote",
      text: "kneels before the king.",
    };
    expect(formatChatMessage(emoteMsg)).toBe("Arthur kneels before the king.");

    const whisperIncoming: ServerChatMessage = {
      ...sayMsg,
      channel: "whisper",
      targetNickname: "Merlin",
      text: "Meet at dawn.",
    };
    expect(formatChatMessage(whisperIncoming, "Merlin")).toBe("Arthur whispers: Meet at dawn.");

    const whisperOutgoing: ServerChatMessage = {
      ...sayMsg,
      channel: "whisper",
      targetNickname: "Merlin",
      text: "Meet at dawn.",
    };
    expect(formatChatMessage(whisperOutgoing, "Arthur")).toBe("To Merlin: Meet at dawn.");
  });
});

describe("chat distance filtering", () => {
  it("calculates horizontal distance ignoring vertical elevation differences", () => {
    const origin = { x: 0, y: 0, z: 0 };
    const elevated = { x: 20, y: 150, z: 15 };
    // horizontal distance = sqrt(20^2 + 15^2) = 25
    expect(isWithinHorizontalDistance(origin, elevated, 25)).toBe(true);
    expect(isWithinHorizontalDistance(origin, elevated, 24.9)).toBe(false);
  });

  it("filters say messages within 25 units", async () => {
    const sender: ChatParticipant = {
      id: "char-1",
      playerId: "p1",
      label: "Alice",
      position: { x: 0, y: 1, z: 0 },
    };
    const inRange: ChatParticipant = {
      id: "char-2",
      playerId: "p2",
      label: "Bob",
      position: { x: 15, y: 5, z: 15 }, // dist ~21.2 <= 25
    };
    const outOfRange: ChatParticipant = {
      id: "char-3",
      playerId: "p3",
      label: "Charlie",
      position: { x: 20, y: 1, z: 20 }, // dist ~28.3 > 25
    };

    const socket1 = createMockSocket();
    const socket2 = createMockSocket();
    const socket3 = createMockSocket();

    const players = new Map<string, ChatParticipant>([
      [sender.id, sender],
      [inRange.id, inRange],
      [outOfRange.id, outOfRange],
    ]);
    const sockets = new Map<string, SocketLike>([
      [sender.id, socket1],
      [inRange.id, socket2],
      [outOfRange.id, socket3],
    ]);

    const result = await handleIncomingChat(
      {
        sender,
        senderSocket: socket1,
        players,
        sockets,
      },
      {
        type: "chat",
        channel: "say",
        text: "Can anybody hear me?",
      }
    );

    expect(result.deliveredCount).toBe(2);
    expect(socket1.messages.length).toBe(1);
    expect(socket2.messages.length).toBe(1);
    expect(socket3.messages.length).toBe(0);

    const received = JSON.parse(socket2.messages[0]) as ServerChatMessage;
    expect(received.channel).toBe("say");
    expect(received.senderNickname).toBe("Alice");
    expect(received.text).toBe("Can anybody hear me?");
    expect(received.position).toEqual(sender.position);
  });

  it("filters yell messages up to 100 units", async () => {
    const sender: ChatParticipant = {
      id: "char-1",
      playerId: "p1",
      label: "Alice",
      position: { x: 0, y: 1, z: 0 },
    };
    const midRange: ChatParticipant = {
      id: "char-2",
      playerId: "p2",
      label: "Bob",
      position: { x: 50, y: 1, z: 50 }, // dist ~70.7 <= 100
    };
    const extremeRange: ChatParticipant = {
      id: "char-3",
      playerId: "p3",
      label: "Charlie",
      position: { x: 75, y: 1, z: 75 }, // dist ~106.1 > 100
    };

    const socket1 = createMockSocket();
    const socket2 = createMockSocket();
    const socket3 = createMockSocket();

    const players = new Map<string, ChatParticipant>([
      [sender.id, sender],
      [midRange.id, midRange],
      [extremeRange.id, extremeRange],
    ]);
    const sockets = new Map<string, SocketLike>([
      [sender.id, socket1],
      [midRange.id, socket2],
      [extremeRange.id, socket3],
    ]);

    const result = await handleIncomingChat(
      {
        sender,
        senderSocket: socket1,
        players,
        sockets,
      },
      {
        type: "chat",
        channel: "yell",
        text: "DANGER IN THE VALLEY!",
      }
    );

    expect(result.deliveredCount).toBe(2);
    expect(socket1.messages.length).toBe(1);
    expect(socket2.messages.length).toBe(1);
    expect(socket3.messages.length).toBe(0);
  });

  it("broadcasts lfg realm-wide regardless of distance", async () => {
    const sender: ChatParticipant = {
      id: "char-1",
      playerId: "p1",
      label: "Alice",
      position: { x: 0, y: 1, z: 0 },
    };
    const farPlayer: ChatParticipant = {
      id: "char-2",
      playerId: "p2",
      label: "Bob",
      position: { x: 5000, y: 1, z: 5000 },
    };

    const socket1 = createMockSocket();
    const socket2 = createMockSocket();

    const players = new Map<string, ChatParticipant>([
      [sender.id, sender],
      [farPlayer.id, farPlayer],
    ]);
    const sockets = new Map<string, SocketLike>([
      [sender.id, socket1],
      [farPlayer.id, socket2],
    ]);

    const result = await handleIncomingChat(
      {
        sender,
        senderSocket: socket1,
        players,
        sockets,
      },
      {
        type: "chat",
        channel: "lfg",
        text: "LFM dungeon run",
      }
    );

    expect(result.deliveredCount).toBe(2);
    expect(socket1.messages.length).toBe(1);
    expect(socket2.messages.length).toBe(1);
  });
});

describe("chat whisper lookup", () => {
  it("delivers whisper to target and echoes back to sender (case-insensitive)", async () => {
    const sender: ChatParticipant = {
      id: "char-1",
      playerId: "p1",
      label: "Geralt",
      position: { x: 0, y: 1, z: 0 },
    };
    const target: ChatParticipant = {
      id: "char-2",
      playerId: "p2",
      label: "Yennefer",
      position: { x: 300, y: 1, z: 300 },
    };

    const senderSocket = createMockSocket();
    const targetSocket = createMockSocket();

    const players = new Map<string, ChatParticipant>([
      [sender.id, sender],
      [target.id, target],
    ]);
    const sockets = new Map<string, SocketLike>([
      [sender.id, senderSocket],
      [target.id, targetSocket],
    ]);

    const result = await handleIncomingChat(
      {
        sender,
        senderSocket,
        players,
        sockets,
      },
      {
        type: "chat",
        channel: "whisper",
        targetNickname: "yEnNeFeR",
        text: "Are you ready?",
      }
    );

    expect(result.deliveredCount).toBe(2);
    expect(targetSocket.messages.length).toBe(1);
    expect(senderSocket.messages.length).toBe(1);

    const receivedTarget = JSON.parse(targetSocket.messages[0]) as ServerChatMessage;
    expect(receivedTarget.channel).toBe("whisper");
    expect(receivedTarget.senderNickname).toBe("Geralt");
    expect(receivedTarget.targetNickname).toBe("Yennefer");
    expect(receivedTarget.text).toBe("Are you ready?");

    const receivedEcho = JSON.parse(senderSocket.messages[0]) as ServerChatMessage;
    expect(receivedEcho.targetNickname).toBe("Yennefer");
    expect(receivedEcho.text).toBe("Are you ready?");
  });

  it("returns error message when whisper target is not online", async () => {
    const sender: ChatParticipant = {
      id: "char-1",
      playerId: "p1",
      label: "Geralt",
      position: { x: 0, y: 1, z: 0 },
    };

    const senderSocket = createMockSocket();
    const players = new Map<string, ChatParticipant>([[sender.id, sender]]);
    const sockets = new Map<string, SocketLike>([[sender.id, senderSocket]]);

    const result = await handleIncomingChat(
      {
        sender,
        senderSocket,
        players,
        sockets,
      },
      {
        type: "chat",
        channel: "whisper",
        targetNickname: "Ciri",
        text: "Where are you?",
      }
    );

    expect(result.deliveredCount).toBe(0);
    expect(senderSocket.messages.length).toBe(1);
    const errorMsg = JSON.parse(senderSocket.messages[0]);
    expect(errorMsg.type).toBe("error");
    expect(errorMsg.message).toBe("Player Ciri is not online.");
  });

  it("delivers once when whispering oneself", async () => {
    const sender: ChatParticipant = {
      id: "char-1",
      playerId: "p1",
      label: "Narcissus",
      position: { x: 0, y: 1, z: 0 },
    };

    const senderSocket = createMockSocket();
    const players = new Map<string, ChatParticipant>([[sender.id, sender]]);
    const sockets = new Map<string, SocketLike>([[sender.id, senderSocket]]);

    const result = await handleIncomingChat(
      {
        sender,
        senderSocket,
        players,
        sockets,
      },
      {
        type: "chat",
        channel: "whisper",
        targetNickname: "Narcissus",
        text: "Note to self",
      }
    );

    expect(result.deliveredCount).toBe(1);
    expect(senderSocket.messages.length).toBe(1);
  });
});

describe("chat spam rate limiting", () => {
  it("allows up to 5 messages per 3 seconds and blocks the 6th", async () => {
    const rateLimiter = new ChatRateLimiter(5, 3000);
    const playerId = "spammer-1";
    let now = 10000;

    for (let i = 0; i < 5; i++) {
      expect(rateLimiter.isRateLimited(playerId, now)).toBe(false);
      now += 100;
    }

    // 6th message within 3s window is blocked
    expect(rateLimiter.isRateLimited(playerId, now)).toBe(true);

    // After 3001ms from the earliest messages, allowed again
    now += 3000;
    expect(rateLimiter.isRateLimited(playerId, now)).toBe(false);
  });

  it("sends rate limit error message to client when rate limited", async () => {
    const rateLimiter = new ChatRateLimiter(2, 3000);
    const sender: ChatParticipant = {
      id: "char-1",
      playerId: "p1",
      label: "FastTyper",
      position: { x: 0, y: 1, z: 0 },
    };
    const socket = createMockSocket();
    const players = new Map([[sender.id, sender]]);
    const sockets = new Map([[sender.id, socket]]);

    const chatMsg: ClientChatMessage = {
      type: "chat",
      channel: "say",
      text: "Spam message",
    };

    // Msg 1 - OK
    await handleIncomingChat(
      { sender, senderSocket: socket, players, sockets, rateLimiter },
      chatMsg
    );
    // Msg 2 - OK
    await handleIncomingChat(
      { sender, senderSocket: socket, players, sockets, rateLimiter },
      chatMsg
    );
    expect(socket.messages.length).toBe(2);

    // Msg 3 - Blocked
    const blockedResult = await handleIncomingChat(
      { sender, senderSocket: socket, players, sockets, rateLimiter },
      chatMsg
    );
    expect(blockedResult.rateLimited).toBe(true);
    expect(socket.messages.length).toBe(3);

    const lastMsg = JSON.parse(socket.messages[2]);
    expect(lastMsg.type).toBe("error");
    expect(lastMsg.message).toBe("You are sending messages too quickly.");
  });

  it("handles empty messages gracefully without broadcasting", async () => {
    const sender: ChatParticipant = {
      id: "char-1",
      playerId: "p1",
      label: "Silent",
      position: { x: 0, y: 1, z: 0 },
    };
    const socket = createMockSocket();
    const players = new Map([[sender.id, sender]]);
    const sockets = new Map([[sender.id, socket]]);

    const result = await handleIncomingChat(
      { sender, senderSocket: socket, players, sockets },
      { type: "chat", channel: "say", text: "   " }
    );

    expect(result.deliveredCount).toBe(0);
    expect(socket.messages.length).toBe(0);
  });
});
