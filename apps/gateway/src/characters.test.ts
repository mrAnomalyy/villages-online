import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken } from "./auth";
import type { CharacterProfile } from "./characters";
import { createCharactersRouter } from "./characters";

describe("Characters API (/api/characters)", () => {
  let server: http.Server;
  let baseUrl: string;
  let mockQuery: ReturnType<typeof vi.fn>;

  const validToken = "my-valid-secret-token-123";
  const validTokenHash = hashToken(validToken);
  const otherToken = "another-user-token-456";
  const otherTokenHash = hashToken(otherToken);

  beforeAll(async () => {
    mockQuery = vi.fn();
    const mockPool = { query: mockQuery } as unknown as Pool;

    const app = express();
    app.use(express.json());
    app.use("/api/characters", createCharactersRouter(mockPool));
    app.use(
      (err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (
          err instanceof SyntaxError ||
          (typeof err === "object" &&
            err !== null &&
            "status" in err &&
            (err as { status: unknown }).status === 400)
        ) {
          res.status(400).json({ error: "Malformed or invalid JSON payload." });
          return;
        }
        next(err);
      }
    );

    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}/api/characters`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe("Authentication", () => {
    it("returns 401 when Authorization header is missing on GET /me", async () => {
      const res = await fetch(`${baseUrl}/me`);
      expect(res.status).toBe(401);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Unauthorized");
    });

    it("returns 401 when Authorization header is not Bearer on GET /me", async () => {
      const res = await fetch(`${baseUrl}/me`, {
        headers: { Authorization: "Basic invalid" },
      });
      expect(res.status).toBe(401);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Unauthorized");
    });

    it("returns 401 when session token is unknown/unregistered", async () => {
      // player check returns 0
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      // character check returns 0
      mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      const res = await fetch(`${baseUrl}/me`, {
        headers: { Authorization: "Bearer unknown-token" },
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 on POST / without Authorization header", async () => {
      const res = await fetch(baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Hero" }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/characters (Validation)", () => {
    beforeEach(() => {
      // Mock player auth check succeeds
      mockQuery.mockImplementation(async (sql: string, params: unknown[]) => {
        if (typeof sql === "string" && sql.includes("FROM players")) {
          if (params[0] === validTokenHash) {
            return { rowCount: 1, rows: [{ id: "p1", nickname: "PlayerOne" }] };
          }
          return { rowCount: 0, rows: [] };
        }
        return { rowCount: 0, rows: [] };
      });
    });

    it("returns 400 when body is not an object", async () => {
      const res = await fetch(baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${validToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify("not-an-object"),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBeDefined();
    });

    it("returns 400 when name/nickname is missing or empty", async () => {
      const res = await fetch(baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${validToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ appearance: {} }),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("name");
    });

    it("returns 400 when name exceeds 64 characters", async () => {
      const res = await fetch(baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${validToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "n".repeat(65) }),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("64");
    });

    it("returns 400 when appearance is not an object", async () => {
      const res = await fetch(baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${validToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Hero", appearance: "invalid-string" }),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("appearance");
    });

    it("returns 400 when lastPosition is invalid", async () => {
      const res = await fetch(baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${validToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Hero", lastPosition: "not-an-object" }),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("lastPosition");
    });
  });

  describe("POST /api/characters (Persistence)", () => {
    it("creates a new character with generated ID and returns 201", async () => {
      mockQuery.mockImplementation(async (sql: string, params: unknown[]) => {
        if (typeof sql === "string" && sql.includes("FROM players")) {
          return { rowCount: 1, rows: [{ id: "p1", nickname: "PlayerOne" }] };
        }
        if (typeof sql === "string" && sql.includes("INSERT INTO characters")) {
          return {
            rowCount: 1,
            rows: [
              {
                id: params[0],
                account_token_hash: params[1],
                name: params[2],
                appearance: JSON.parse(params[3] as string),
                last_position: params[4] ? JSON.parse(params[4] as string) : null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
          };
        }
        return { rowCount: 0, rows: [] };
      });

      const res = await fetch(baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${validToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Sir Lancelot",
          appearance: { bodyType: "male", hairColor: "brown" },
          lastPosition: { x: 10, y: 1, z: 20 },
        }),
      });

      expect([200, 201]).toContain(res.status);
      const data = (await res.json()) as {
        success: boolean;
        characterId: string;
        character: CharacterProfile;
      };
      expect(data.success).toBe(true);
      expect(data.characterId).toBeDefined();
      expect(data.character.name).toBe("Sir Lancelot");
      expect(data.character.appearance.bodyType).toBe("male");
      expect(data.character.last_position).toEqual({ x: 10, y: 1, z: 20 });
    });

    it("updates an existing character and returns 200", async () => {
      const charId = "char-existing-1";

      mockQuery.mockImplementation(async (sql: string, params: unknown[]) => {
        if (typeof sql === "string" && sql.includes("FROM players")) {
          return { rowCount: 1, rows: [{ id: "p1", nickname: "PlayerOne" }] };
        }
        if (
          typeof sql === "string" &&
          sql.includes("SELECT id, account_token_hash FROM characters")
        ) {
          return {
            rowCount: 1,
            rows: [{ id: charId, account_token_hash: validTokenHash }],
          };
        }
        if (typeof sql === "string" && sql.includes("UPDATE characters")) {
          return {
            rowCount: 1,
            rows: [
              {
                id: charId,
                name: params[0],
                appearance: JSON.parse(params[1] as string),
                last_position: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
          };
        }
        return { rowCount: 0, rows: [] };
      });

      const res = await fetch(baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${validToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: charId,
          name: "Sir Lancelot Updated",
          appearance: { bodyType: "female", hairColor: "gold" },
        }),
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        success: boolean;
        character: CharacterProfile;
      };
      expect(data.success).toBe(true);
      expect(data.character.name).toBe("Sir Lancelot Updated");
      expect(data.character.appearance.hairColor).toBe("gold");
    });

    it("returns 403 when trying to update a character owned by another account", async () => {
      const charId = "char-other-account";

      mockQuery.mockImplementation(async (sql: string) => {
        if (typeof sql === "string" && sql.includes("FROM players")) {
          return { rowCount: 1, rows: [{ id: "p1", nickname: "PlayerOne" }] };
        }
        if (
          typeof sql === "string" &&
          sql.includes("SELECT id, account_token_hash FROM characters")
        ) {
          return {
            rowCount: 1,
            rows: [{ id: charId, account_token_hash: otherTokenHash }],
          };
        }
        return { rowCount: 0, rows: [] };
      });

      const res = await fetch(baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${validToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: charId,
          name: "Stolen Name",
        }),
      });

      expect(res.status).toBe(403);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Forbidden");
    });
  });

  describe("GET /api/characters/me", () => {
    it("returns 200 with list of character profiles for the authenticated account", async () => {
      const characterRows = [
        {
          id: "char-1",
          name: "Warrior",
          appearance: { bodyType: "male" },
          last_position: { x: 5, y: 1, z: 5 },
          created_at: new Date("2026-11-05T01:00:00Z").toISOString(),
          updated_at: new Date("2026-11-05T01:00:00Z").toISOString(),
        },
        {
          id: "char-2",
          name: "Mage",
          appearance: { bodyType: "female" },
          last_position: null,
          created_at: new Date("2026-11-05T02:00:00Z").toISOString(),
          updated_at: new Date("2026-11-05T02:00:00Z").toISOString(),
        },
      ];

      mockQuery.mockImplementation(async (sql: string, params: unknown[]) => {
        const normalized = typeof sql === "string" ? sql.replace(/\s+/g, " ") : "";
        if (normalized.includes("FROM players")) {
          return { rowCount: 1, rows: [{ id: "p1", nickname: "PlayerOne" }] };
        }
        if (normalized.includes("FROM characters WHERE account_token_hash = $1")) {
          expect(params[0]).toBe(validTokenHash);
          return { rowCount: characterRows.length, rows: characterRows };
        }
        return { rowCount: 0, rows: [] };
      });

      const res = await fetch(`${baseUrl}/me`, {
        headers: { Authorization: `Bearer ${validToken}` },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as CharacterProfile[];
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(2);
      expect(data[0].id).toBe("char-1");
      expect(data[0].name).toBe("Warrior");
      expect(data[0].appearance.bodyType).toBe("male");
      expect(data[1].id).toBe("char-2");
      expect(data[1].last_position).toBeNull();
    });

    it("returns 200 with empty array when account has no characters", async () => {
      mockQuery.mockImplementation(async (sql: string) => {
        if (typeof sql === "string" && sql.includes("FROM players")) {
          return { rowCount: 1, rows: [{ id: "p1", nickname: "PlayerOne" }] };
        }
        return { rowCount: 0, rows: [] };
      });

      const res = await fetch(`${baseUrl}/me`, {
        headers: { Authorization: `Bearer ${validToken}` },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(0);
    });
  });

  describe("GET /api/characters/:characterId", () => {
    it("returns 200 with character profile when owned by user", async () => {
      mockQuery.mockImplementation(async (sql: string) => {
        const normalized = typeof sql === "string" ? sql.replace(/\s+/g, " ") : "";
        if (normalized.includes("FROM players")) {
          return { rowCount: 1, rows: [{ id: "p1", nickname: "PlayerOne" }] };
        }
        if (normalized.includes("FROM characters WHERE id = $1")) {
          return {
            rowCount: 1,
            rows: [
              {
                id: "char-123",
                account_token_hash: validTokenHash,
                name: "Ranger",
                appearance: { bodyType: "male" },
                last_position: { x: 1, y: 1, z: 1 },
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
          };
        }
        return { rowCount: 0, rows: [] };
      });

      const res = await fetch(`${baseUrl}/char-123`, {
        headers: { Authorization: `Bearer ${validToken}` },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as CharacterProfile;
      expect(data.id).toBe("char-123");
      expect(data.name).toBe("Ranger");
    });

    it("returns 404 when character does not exist", async () => {
      mockQuery.mockImplementation(async (sql: string) => {
        const normalized = typeof sql === "string" ? sql.replace(/\s+/g, " ") : "";
        if (normalized.includes("FROM players")) {
          return { rowCount: 1, rows: [{ id: "p1", nickname: "PlayerOne" }] };
        }
        return { rowCount: 0, rows: [] };
      });

      const res = await fetch(`${baseUrl}/non-existent-char`, {
        headers: { Authorization: `Bearer ${validToken}` },
      });

      expect(res.status).toBe(404);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("not found");
    });

    it("returns 403 when character belongs to another user", async () => {
      mockQuery.mockImplementation(async (sql: string) => {
        const normalized = typeof sql === "string" ? sql.replace(/\s+/g, " ") : "";
        if (normalized.includes("FROM players")) {
          return { rowCount: 1, rows: [{ id: "p1", nickname: "PlayerOne" }] };
        }
        if (normalized.includes("FROM characters WHERE id = $1")) {
          return {
            rowCount: 1,
            rows: [
              {
                id: "char-456",
                account_token_hash: otherTokenHash,
                name: "Other Player's Ranger",
                appearance: {},
                last_position: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
          };
        }
        return { rowCount: 0, rows: [] };
      });

      const res = await fetch(`${baseUrl}/char-456`, {
        headers: { Authorization: `Bearer ${validToken}` },
      });

      expect(res.status).toBe(403);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Forbidden");
    });

    it("preserves and returns stored position_x/y/z when last_position is absent in database", async () => {
      mockQuery.mockImplementation(async (sql: string) => {
        const normalized = typeof sql === "string" ? sql.replace(/\s+/g, " ") : "";
        if (normalized.includes("FROM players")) {
          return { rowCount: 1, rows: [{ id: "p1", nickname: "PlayerOne" }] };
        }
        if (normalized.includes("FROM characters WHERE id = $1")) {
          return {
            rowCount: 1,
            rows: [
              {
                id: "char-xyz",
                account_token_hash: validTokenHash,
                name: "Sir Galahad",
                appearance: { bodyType: "male" },
                last_position: null,
                position_x: 25.5,
                position_y: 3.0,
                position_z: 42.1,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
          };
        }
        return { rowCount: 0, rows: [] };
      });

      const res = await fetch(`${baseUrl}/char-xyz`, {
        headers: { Authorization: `Bearer ${validToken}` },
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as CharacterProfile;
      expect(data.id).toBe("char-xyz");
      expect(data.name).toBe("Sir Galahad");
      expect(data.lastPosition).toBeDefined();
    });
  });
});
