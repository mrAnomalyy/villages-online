"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatChannel, ClientChatMessage, ServerChatMessage } from "@villages/shared";
import { formatChatMessage, parseChatInput } from "@villages/shared";

export type ChatBoxProps = {
  messages: ServerChatMessage[];
  onSendMessage: (message: ClientChatMessage) => void;
  currentNickname?: string;
};

const CHANNELS: { id: ChatChannel; label: string; color: string }[] = [
  { id: "say", label: "Say", color: "#f0f0f0" },
  { id: "yell", label: "Yell", color: "#ff4d4f" },
  { id: "whisper", label: "Whisper", color: "#f759ab" },
  { id: "lfg", label: "LFG", color: "#13c2c2" },
  { id: "emote", label: "Emote", color: "#fa8c16" },
];

export function ChatBox({ messages, onSendMessage, currentNickname }: ChatBoxProps) {
  const [activeChannel, setActiveChannel] = useState<ChatChannel>("say");
  const [inputText, setInputText] = useState("");
  const [whisperTarget, setWhisperTarget] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messagesScrollRef.current) {
      messagesScrollRef.current.scrollTop = messagesScrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Global hotkey: Enter to focus chat
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && document.activeElement !== inputRef.current) {
        const activeTag = document.activeElement?.tagName.toLowerCase();
        if (activeTag === "input" || activeTag === "textarea" || activeTag === "select") {
          return;
        }
        event.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const val = event.target.value;

    // Auto-detect whisper: /w <name> or /whisper <name> followed by space
    const whisperMatch = val.match(/^\/(?:w|whisper)\s+(\S+)\s+(.*)$/i);
    if (whisperMatch) {
      setActiveChannel("whisper");
      setWhisperTarget(whisperMatch[1] ?? "");
      setInputText(whisperMatch[2] ?? "");
      return;
    }

    const whisperInitMatch = val.match(/^\/(?:w|whisper)\s+(\S+)\s$/i);
    if (whisperInitMatch) {
      setActiveChannel("whisper");
      setWhisperTarget(whisperInitMatch[1] ?? "");
      setInputText("");
      return;
    }

    // Auto-detect say: /s or /say followed by space
    if (/^\/(?:s|say)\s/i.test(val)) {
      setActiveChannel("say");
      setInputText(val.replace(/^\/(?:s|say)\s+/i, ""));
      return;
    }

    // Auto-detect yell: /y or /yell followed by space
    if (/^\/(?:y|yell)\s/i.test(val)) {
      setActiveChannel("yell");
      setInputText(val.replace(/^\/(?:y|yell)\s+/i, ""));
      return;
    }

    // Auto-detect LFG: /lfg or /4 followed by space
    if (/^\/(?:lfg|4)\s/i.test(val)) {
      setActiveChannel("lfg");
      setInputText(val.replace(/^\/(?:lfg|4)\s+/i, ""));
      return;
    }

    // Auto-detect emote: /e or /emote followed by space
    if (/^\/(?:e|emote)\s/i.test(val)) {
      setActiveChannel("emote");
      setInputText(val.replace(/^\/(?:e|emote)\s+/i, ""));
      return;
    }

    setInputText(val);
  };

  const submitMessage = () => {
    const trimmed = inputText.trim();
    if (!trimmed) {
      inputRef.current?.blur();
      return;
    }

    const parsed = parseChatInput(trimmed, activeChannel);
    const target =
      parsed.channel === "whisper" ? (parsed.targetNickname || whisperTarget).trim() : undefined;

    if (parsed.channel === "whisper" && !target) {
      return;
    }

    onSendMessage({
      type: "chat",
      channel: parsed.channel,
      text: parsed.text,
      targetNickname: target,
    });

    if (parsed.channel !== activeChannel) {
      setActiveChannel(parsed.channel);
    }
    if (parsed.channel === "whisper" && parsed.targetNickname) {
      setWhisperTarget(parsed.targetNickname);
    }

    setInputText("");
    inputRef.current?.blur();
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      inputRef.current?.blur();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      submitMessage();
    }
  };

  const activeChannelMeta =
    CHANNELS.find((channel) => channel.id === activeChannel) ?? CHANNELS[0]!;

  return (
    <div
      className={`chat-hud ${isFocused ? "chat-hud-focused" : ""}`}
      data-testid="chat-hud"
      aria-label="World Chat"
    >
      <div className="chat-messages-container" ref={messagesScrollRef} data-testid="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-empty-hint">Press Enter to chat. Type /s, /y, /w, /lfg, or /e.</div>
        ) : (
          messages.map((message) => {
            const formatted = formatChatMessage(message, currentNickname);
            const channelMeta = CHANNELS.find((c) => c.id === message.channel) ?? activeChannelMeta;
            const time = new Date(message.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            });

            return (
              <div
                key={message.id}
                className={`chat-row chat-channel-${message.channel}`}
                style={{ color: channelMeta.color }}
              >
                <span className="chat-timestamp">[{time}]</span>{" "}
                <span className="chat-text">{formatted}</span>
              </div>
            );
          })
        )}
      </div>

      <div className="chat-channel-pills">
        {CHANNELS.map((channel) => (
          <button
            key={channel.id}
            type="button"
            className={`chat-pill ${activeChannel === channel.id ? "chat-pill-active" : ""}`}
            style={{
              borderColor: activeChannel === channel.id ? channel.color : undefined,
              color: activeChannel === channel.id ? channel.color : undefined,
            }}
            data-testid={`chat-channel-${channel.id}`}
            onClick={() => {
              setActiveChannel(channel.id);
              inputRef.current?.focus();
            }}
          >
            [{channel.label}]
          </button>
        ))}
      </div>

      <div className="chat-input-bar">
        {activeChannel === "whisper" ? (
          <input
            type="text"
            className="chat-target-input"
            data-testid="chat-target-input"
            placeholder="To player..."
            value={whisperTarget}
            onChange={(e) => setWhisperTarget(e.target.value)}
          />
        ) : null}

        <input
          ref={inputRef}
          type="text"
          className="chat-input"
          data-testid="chat-input"
          placeholder={
            activeChannel === "whisper"
              ? whisperTarget
                ? `Whisper ${whisperTarget}...`
                : "Enter player name first..."
              : `Chat in [${activeChannelMeta.label}]... (/s, /y, /w, /lfg, /e)`
          }
          value={inputText}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
        />

        <button
          type="button"
          className="chat-send-btn"
          data-testid="chat-send-btn"
          onClick={submitMessage}
        >
          Send
        </button>
      </div>
    </div>
  );
}
