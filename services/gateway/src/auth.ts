import crypto from "node:crypto";
import type { Pool } from "pg";
import { sanitizeNickname } from "@villages/shared";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

export async function registerOrResumeGuest(pool: Pool, nicknameInput: string, existingToken?: string) {
  const nickname = sanitizeNickname(nicknameInput);
  if (nickname.length < 3) {
    throw new Error("Nickname must be at least 3 characters long.");
  }

  const existing = await pool.query<{
    id: string;
    nickname: string;
    token_hash: string;
  }>("SELECT id, nickname, token_hash FROM players WHERE nickname = $1", [nickname]);

  if (existing.rowCount === 0) {
    const playerId = crypto.randomUUID();
    const token = generateToken();
    await pool.query(
      `INSERT INTO players (id, nickname, token_hash)
       VALUES ($1, $2, $3)`,
      [playerId, nickname, hashToken(token)]
    );
    return {
      playerId,
      nickname,
      token
    };
  }

  const row = existing.rows[0];
  if (!existingToken) {
    throw new Error("Auth failed: this nickname is already registered on another browser.");
  }

  if (hashToken(existingToken) !== row.token_hash) {
    throw new Error("Auth failed: token mismatch for this nickname.");
  }

  return {
    playerId: row.id,
    nickname: row.nickname,
    token: existingToken
  };
}

export function makeTicket(): string {
  return crypto.randomBytes(18).toString("hex");
}

