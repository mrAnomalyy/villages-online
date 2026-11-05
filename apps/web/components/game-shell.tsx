"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CharacterBodyType,
  CharacterProfile,
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
  fetchMyCharacters,
  fetchRealms,
  guestAuth,
  requestJoinTicket,
  saveCharacterCustomization,
} from "../lib/api";
import { BabylonGameCanvas } from "./scene-canvas";

type Stage = "menu" | "character" | "loading" | "game";
type Direction = { x: number; z: number };

type SessionState = GuestAuthResponse & {
  realm: RealmDescriptor;
};

export const SKIN_TONES = [
  { id: "fair", label: "Fair", hex: "#f5d0a9" },
  { id: "warm", label: "Warm", hex: "#d4a373" },
  { id: "olive", label: "Olive", hex: "#a37c52" },
  { id: "deep", label: "Deep", hex: "#5c3a21" },
];

export const ARMOR_TINTS = [
  { id: "steel", label: "Steel", hex: "#718096" },
  { id: "crimson", label: "Crimson", hex: "#9b2c2c" },
  { id: "forest", label: "Forest", hex: "#276749" },
  { id: "gold", label: "Gold", hex: "#d69e2e" },
  { id: "obsidian", label: "Obsidian", hex: "#2d3748" },
];

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
  const [savedCharacters, setSavedCharacters] = useState<CharacterProfile[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [customName, setCustomName] = useState("");
  const [selectedSkinTone, setSelectedSkinTone] = useState(SKIN_TONES[0].hex);
  const [selectedArmorTint, setSelectedArmorTint] = useState(ARMOR_TINTS[0].hex);
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
    setCustomName(auth.nickname);

    let myChars: CharacterProfile[] = [];
    try {
      myChars = await fetchMyCharacters(auth.token);
      setSavedCharacters(myChars);
    } catch {
      // If none or error, keep empty
    }

    const existingCharacter = await fetchCharacter(selectedRealm.id, auth.playerId, auth.token);
    if (existingCharacter) {
      setCharacter(existingCharacter);
      setSelectedBodyType(existingCharacter.bodyType);
    } else {
      setCharacter(null);
    }

    setStage("character");
    setStatus(myChars.length > 0 ? "Select or customize your hero." : "Shape your first hero.");
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
      const heroName = customName.trim() || session.nickname;

      // 1. Persist customizations to /api/characters
      try {
        await saveCharacterCustomization(session.token, {
          id: selectedCharacterId ?? undefined,
          name: heroName,
          appearance: {
            bodyType: selectedBodyType,
            skinTone: selectedSkinTone,
            armorTint: selectedArmorTint,
          },
        });
      } catch {
        // Continue even if customization store fails
      }

      // 2. Link to realm character session
      const created = await createCharacter(
        session.realm.id,
        session.playerId,
        session.token,
        selectedBodyType
      );
      setCharacter(created);

      // 3. Enter realm
      await beginJoin(session.realm, session);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Character creation failed.");
    }
  }

  async function handleSelectSavedCharacter(hero: CharacterProfile) {
    if (!session) {
      return;
    }

    try {
      setError(null);
      setStatus(`Summoning ${hero.name}...`);
      const bType = (hero.appearance?.bodyType as CharacterBodyType) ?? "male";
      setSelectedBodyType(bType);
      setSelectedCharacterId(hero.id);
      setCustomName(hero.name);
      if (typeof hero.appearance?.skinTone === "string") {
        setSelectedSkinTone(hero.appearance.skinTone);
      }
      if (typeof hero.appearance?.armorTint === "string") {
        setSelectedArmorTint(hero.appearance.armorTint);
      }

      const created = await createCharacter(
        session.realm.id,
        session.playerId,
        session.token,
        bType
      );
      setCharacter(created);
      await beginJoin(session.realm, session);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to enter realm with saved hero.");
    }
  }

  function handleEditSavedCharacter(hero: CharacterProfile) {
    setSelectedCharacterId(hero.id);
    setCustomName(hero.name);
    if (hero.appearance?.bodyType === "male" || hero.appearance?.bodyType === "female") {
      setSelectedBodyType(hero.appearance.bodyType);
    }
    if (typeof hero.appearance?.skinTone === "string") {
      setSelectedSkinTone(hero.appearance.skinTone);
    }
    if (typeof hero.appearance?.armorTint === "string") {
      setSelectedArmorTint(hero.appearance.armorTint);
    }
    setStatus(`Editing customizations for ${hero.name}.`);
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
                  <strong>Create or choose your hero for {session?.realm.name}</strong>
                  <p>
                    Account: <strong>{session?.nickname}</strong>
                  </p>
                </div>

                {savedCharacters.length > 0 ? (
                  <div>
                    <h3 className="section-heading">Your Saved Heroes</h3>
                    <div className="saved-heroes-grid" data-testid="saved-heroes-list">
                      {savedCharacters.map((hero) => (
                        <div
                          key={hero.id}
                          className="saved-hero-card"
                          data-testid={`hero-card-${hero.id}`}
                        >
                          <div className="saved-hero-header">
                            <strong>{hero.name}</strong>
                            <span className="saved-hero-badge">
                              {hero.appearance?.bodyType === "female"
                                ? "Female Ranger"
                                : "Male Wanderer"}
                            </span>
                          </div>
                          <div className="saved-hero-meta">
                            <small>Created: {new Date(hero.created_at).toLocaleDateString()}</small>
                            <div className="swatch-indicators">
                              <span
                                className="swatch-indicator"
                                style={{
                                  backgroundColor:
                                    (hero.appearance?.skinTone as string) ?? SKIN_TONES[0].hex,
                                }}
                                title="Skin tone"
                              />
                              <span
                                className="swatch-indicator"
                                style={{
                                  backgroundColor:
                                    (hero.appearance?.armorTint as string) ?? ARMOR_TINTS[0].hex,
                                }}
                                title="Armor tint"
                              />
                            </div>
                          </div>
                          <div className="saved-hero-actions">
                            <button
                              type="button"
                              className="quick-enter-button"
                              data-testid={`select-hero-${hero.id}`}
                              onClick={() => void handleSelectSavedCharacter(hero)}
                            >
                              Enter Realm
                            </button>
                            <button
                              type="button"
                              className="edit-hero-button"
                              data-testid={`edit-hero-${hero.id}`}
                              onClick={() => handleEditSavedCharacter(hero)}
                            >
                              Customize
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="customization-box" data-testid="hero-customizer">
                  <h3 className="section-heading">
                    {selectedCharacterId ? "Customize Selected Hero" : "Hero Customization"}
                  </h3>

                  <div className="field">
                    <label htmlFor="hero-name">Hero Name</label>
                    <input
                      id="hero-name"
                      data-testid="hero-name-input"
                      value={customName}
                      onChange={(event) => setCustomName(event.target.value)}
                      placeholder="Confirm or customize nickname"
                    />
                  </div>

                  <div className="field">
                    <label>Avatar Archetype</label>
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
                  </div>

                  <div className="swatch-group">
                    <label>Skin Tone</label>
                    <div className="swatch-palette" data-testid="skin-tone-palette">
                      {SKIN_TONES.map((swatch) => (
                        <button
                          key={swatch.id}
                          type="button"
                          className="swatch-button"
                          data-selected={selectedSkinTone === swatch.hex}
                          data-testid={`skin-tone-${swatch.id}`}
                          onClick={() => setSelectedSkinTone(swatch.hex)}
                        >
                          <span className="color-dot" style={{ backgroundColor: swatch.hex }} />
                          <span>{swatch.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="swatch-group">
                    <label>Armor Tint</label>
                    <div className="swatch-palette" data-testid="armor-tint-palette">
                      {ARMOR_TINTS.map((swatch) => (
                        <button
                          key={swatch.id}
                          type="button"
                          className="swatch-button"
                          data-selected={selectedArmorTint === swatch.hex}
                          data-testid={`armor-tint-${swatch.id}`}
                          onClick={() => setSelectedArmorTint(swatch.hex)}
                        >
                          <span className="color-dot" style={{ backgroundColor: swatch.hex }} />
                          <span>{swatch.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {issuedToken ? (
                  <div className="token-box" data-testid="issued-token-box">
                    <strong>Your browser token</strong>
                    <div>{issuedToken}</div>
                  </div>
                ) : null}

                {error ? <div className="error-box">{error}</div> : null}

                <div className="actions">
                  <button
                    className="primary-button"
                    data-testid="create-character-button"
                    onClick={handleCreateCharacter}
                  >
                    {selectedCharacterId ? "Save & Enter Realm" : "Create and enter realm"}
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
