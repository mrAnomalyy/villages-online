"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CharacterBodyType,
  CharacterSummary,
  GuestAuthResponse,
  InitialWorldPayload,
  RealmDescriptor,
  ServerSocketMessage,
} from "@villages/shared";
import { CHUNK_SIZE, type EntitySnapshot } from "@villages/shared";
import {
  createCharacter,
  fetchCharacter,
  fetchRealms,
  guestAuth,
  requestJoinTicket,
} from "../lib/api";
import { BabylonGameCanvas } from "./scene-canvas";

type Stage = "menu" | "character" | "loading" | "game";
type Direction = { x: number; z: number };

type SessionState = GuestAuthResponse & {
  realm: RealmDescriptor;
};

type DebugState = {
  currentRealmId: string | null;
  currentPlayerId: string | null;
  loadingComplete: boolean;
  playerPosition: { x: number; y: number; z: number } | null;
  loadedChunkIds: string[];
  visibleEntityIds: string[];
};

declare global {
  interface Window {
    __VILLAGES_TEST_STATE__?: DebugState;
    __VILLAGES_TEST_CONTROLS__?: {
      move: (direction: Direction) => void;
      jump: () => void;
    };
  }
}

const MOVE_MESSAGE_TYPE = "move";
const SELECTABLE_BODY_TYPES: CharacterBodyType[] = ["male", "female"];

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

export function GameShell() {
  const [realms, setRealms] = useState<RealmDescriptor[]>([]);
  const [nickname, setNickname] = useState("");
  const [selectedRealmId, setSelectedRealmId] = useState("alpha");
  const [selectedBodyType, setSelectedBodyType] = useState<CharacterBodyType>("male");
  const [token, setToken] = useState("");
  const [stage, setStage] = useState<Stage>("menu");
  const [session, setSession] = useState<SessionState | null>(null);
  const [character, setCharacter] = useState<CharacterSummary | null>(null);
  const [world, setWorld] = useState<InitialWorldPayload | null>(null);
  const [entities, setEntities] = useState<EntitySnapshot[]>([]);
  const [loadedChunkIds, setLoadedChunkIds] = useState<string[]>([]);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [status, setStatus] = useState("Waiting for a traveler.");
  const [error, setError] = useState<string | null>(null);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const lastSubscribedChunkIdRef = useRef<string | null>(null);

  const selectedRealm = useMemo(
    () => realms.find((realm) => realm.id === selectedRealmId) ?? null,
    [realms, selectedRealmId]
  );

  useEffect(() => {
    const storedNickname = window.localStorage.getItem("villages.nickname");
    const storedToken = window.localStorage.getItem("villages.token");
    if (storedNickname) {
      setNickname(storedNickname);
    }
    if (storedToken) {
      setToken(storedToken);
    }
  }, []);

  useEffect(() => {
    fetchRealms()
      .then((loadedRealms) => {
        setRealms(loadedRealms);
        if (loadedRealms[0]) {
          setSelectedRealmId((current) => current || loadedRealms[0].id);
        }
      })
      .catch((reason: Error) => {
        setError(reason.message);
      });
  }, []);

  useEffect(() => {
    window.__VILLAGES_TEST_STATE__ = {
      currentRealmId: session?.realm.id ?? null,
      currentPlayerId: session?.playerId ?? null,
      loadingComplete: stage === "game",
      playerPosition: world?.player.position ?? null,
      loadedChunkIds,
      visibleEntityIds: entities.map((entity) => entity.id),
    };
  }, [entities, loadedChunkIds, session, stage, world]);

  useEffect(() => {
    window.__VILLAGES_TEST_CONTROLS__ = {
      move: (direction) => {
        socketRef.current?.send(
          JSON.stringify({
            type: MOVE_MESSAGE_TYPE,
            sequence: Date.now(),
            direction,
            running: true,
          })
        );
      },
      jump: () => {
        socketRef.current?.send(
          JSON.stringify({
            type: "jump",
            sequence: Date.now(),
          })
        );
      },
    };

    return () => {
      delete window.__VILLAGES_TEST_CONTROLS__;
    };
  }, []);

  useEffect(() => {
    return () => {
      socketRef.current?.close();
    };
  }, []);

  async function connectGuest() {
    setError(null);
    setStatus("Binding your guest token to this browser...");
    const auth = await guestAuth(nickname, token || undefined);
    window.localStorage.setItem("villages.nickname", auth.nickname);
    window.localStorage.setItem("villages.token", auth.token);
    setToken(auth.token);
    setIssuedToken(auth.token);
    if (!selectedRealm) {
      throw new Error("No realm selected.");
    }
    setSession({
      ...auth,
      realm: selectedRealm,
    });

    const existingCharacter = await fetchCharacter(selectedRealm.id, auth.playerId, auth.token);
    if (existingCharacter) {
      setCharacter(existingCharacter);
      await beginJoin(selectedRealm, auth);
      return;
    }

    setCharacter(null);
    setStage("character");
    setStatus("Shape your first hero.");
  }

  async function beginJoin(realm: RealmDescriptor, auth: GuestAuthResponse) {
    setStage("loading");
    setLoadingProgress(10);
    setStatus("Gathering realm ticket and world state...");

    const [joinTicket] = await Promise.all([
      requestJoinTicket(realm.id, auth.playerId, auth.token),
      wait(450),
    ]);

    setLoadingProgress(45);
    setStatus(`Crossing into ${realm.name}...`);

    await wait(400);
    const socket = new WebSocket(resolveRealmSocketUrl(joinTicket.realm.id));
    socketRef.current = socket;

    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ type: "hello", ticket: joinTicket.ticket }));
      });

      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data as string) as ServerSocketMessage;
        if (message.type === "welcome") {
          setWorld(message.payload);
          setEntities(message.payload.entities);
          setLoadedChunkIds(message.payload.chunks.map((chunk) => chunk.id));
          lastSubscribedChunkIdRef.current = resolveChunkId(
            message.payload.player.position.x,
            message.payload.player.position.z
          );
          setLoadingProgress(100);
          setStatus("Realm ready.");
          setStage("game");
          resolve();
          return;
        }

        if (message.type === "snapshot") {
          const chunkId = resolveChunkId(message.self.position.x, message.self.position.z);
          setWorld((current) =>
            current
              ? {
                  ...current,
                  player: message.self,
                }
              : current
          );
          setEntities(message.entities);
          if (lastSubscribedChunkIdRef.current !== chunkId) {
            lastSubscribedChunkIdRef.current = chunkId;
            socket.send(JSON.stringify({ type: "subscribeChunks", centerChunkId: chunkId }));
          }
          return;
        }

        if (message.type === "chunks") {
          setLoadedChunkIds(message.chunks.map((chunk) => chunk.id));
          setWorld((current) =>
            current
              ? {
                  ...current,
                  chunks: message.chunks,
                }
              : current
          );
          return;
        }

        if (message.type === "error") {
          reject(new Error(message.message));
        }
      });

      socket.addEventListener("error", () => {
        reject(new Error("Realm socket failed."));
      });
    });
  }

  async function handleConnect() {
    try {
      await connectGuest();
    } catch (reason) {
      setStage("menu");
      setError(reason instanceof Error ? reason.message : "Unknown login error.");
    }
  }

  async function handleCreateCharacter() {
    if (!session) {
      return;
    }

    try {
      setError(null);
      setStatus("Forging your character...");
      const created = await createCharacter(
        session.realm.id,
        session.playerId,
        session.token,
        selectedBodyType
      );
      setCharacter(created);
      await beginJoin(session.realm, session);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Character creation failed.");
    }
  }

  function handleMove(direction: Direction) {
    window.__VILLAGES_TEST_CONTROLS__?.move(direction);
  }

  function handleJump() {
    window.__VILLAGES_TEST_CONTROLS__?.jump();
  }

  if (stage === "loading") {
    return (
      <div className="loading-screen" data-testid="loading-screen">
        <div className="loading-card">
          <h2>Preparing the realm</h2>
          <p>{status}</p>
          <div className="loading-bar" aria-hidden="true">
            <span style={{ width: `${loadingProgress}%` }} />
          </div>
        </div>
      </div>
    );
  }

  if (stage === "game" && world && session) {
    return (
      <div className="game-layout">
        <div className="hud" data-testid="game-hud">
          <div>
            <strong>{character?.nickname ?? session.nickname}</strong>
            <small>
              {" "}
              on {session.realm.name} | loaded chunks: {loadedChunkIds.join(", ")}
            </small>
          </div>
          <div>
            <small>
              Player position: {world.player.position.x.toFixed(2)},{" "}
              {world.player.position.y.toFixed(2)}, {world.player.position.z.toFixed(2)}
            </small>
          </div>
          {issuedToken ? (
            <div>
              <small>Browser token: {issuedToken}</small>
            </div>
          ) : null}
        </div>
        <div className="canvas-shell">
          <BabylonGameCanvas
            world={world}
            entities={entities}
            onMove={handleMove}
            onJump={handleJump}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="panel">
        <div className="menu-layout">
          <aside className="menu-copy">
            <h1>Villages Online</h1>
            <p>
              A browser MMO foundation with isolated realms, browser-bound guest identities, and a
              deterministic starter world.
            </p>
            <p>{status}</p>
          </aside>
          <main className="menu-form">
            {stage === "menu" ? (
              <>
                <div className="field">
                  <label htmlFor="nickname">Nickname</label>
                  <input
                    id="nickname"
                    data-testid="nickname-input"
                    value={nickname}
                    onChange={(event) => setNickname(event.target.value)}
                    placeholder="Enter your nickname"
                  />
                </div>
                <div className="field">
                  <label htmlFor="realm">Realm</label>
                  <select
                    id="realm"
                    data-testid="realm-select"
                    value={selectedRealmId}
                    onChange={(event) => setSelectedRealmId(event.target.value)}
                  >
                    {realms.map((realm) => (
                      <option key={realm.id} value={realm.id}>
                        {realm.name}
                      </option>
                    ))}
                  </select>
                </div>
                {token ? (
                  <div className="token-box" data-testid="token-box">
                    <strong>Stored token</strong>
                    <div>{token}</div>
                  </div>
                ) : null}
                {error ? <div className="error-box">{error}</div> : null}
                <div className="actions">
                  <button
                    className="primary-button"
                    data-testid="connect-button"
                    onClick={handleConnect}
                  >
                    Enter realm
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="status-box" data-testid="character-create-screen">
                  <strong>Create your hero for {session?.realm.name}</strong>
                  <p>
                    Nickname: <strong>{session?.nickname}</strong>
                  </p>
                </div>
                {issuedToken ? (
                  <div className="token-box" data-testid="issued-token-box">
                    <strong>Your browser token</strong>
                    <div>{issuedToken}</div>
                  </div>
                ) : null}
                <div className="character-grid">
                  {SELECTABLE_BODY_TYPES.map((bodyType) => (
                    <button
                      key={bodyType}
                      type="button"
                      className="character-card"
                      data-selected={selectedBodyType === bodyType}
                      data-testid={`body-${bodyType}`}
                      onClick={() => setSelectedBodyType(bodyType)}
                    >
                      <strong>{bodyType === "male" ? "Male wanderer" : "Female ranger"}</strong>
                      <p>Primitive avatar now, full model pipeline later.</p>
                    </button>
                  ))}
                </div>
                {error ? <div className="error-box">{error}</div> : null}
                <div className="actions">
                  <button
                    className="primary-button"
                    data-testid="create-character-button"
                    onClick={handleCreateCharacter}
                  >
                    Create and enter realm
                  </button>
                  <button className="secondary-button" onClick={() => setStage("menu")}>
                    Back
                  </button>
                </div>
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function resolveChunkId(x: number, z: number): string {
  return `${Math.floor(x / CHUNK_SIZE)}:${Math.floor(z / CHUNK_SIZE)}`;
}

function resolveRealmSocketUrl(realmId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.hostname;

  if (host === "web") {
    return `${protocol}://realm-${realmId}:${realmPortForId(realmId)}/ws`;
  }

  return `${protocol}://${host}:${realmPortForId(realmId)}/ws`;
}

function realmPortForId(realmId: string): number {
  return realmId === "beta" ? 4102 : 4101;
}
