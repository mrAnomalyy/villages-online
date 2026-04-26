import { Pool } from "pg";

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://villages:villages@127.0.0.1:5432/villages";

export const pool = new Pool({ connectionString });

export async function ensureRealmRows(
  realms: {
    id: string;
    name: string;
    httpUrl: string;
    wsUrl: string;
  }[]
): Promise<void> {
  for (const realm of realms) {
    await pool.query(
      `INSERT INTO realms (id, name, http_url, ws_url, world_map_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           http_url = EXCLUDED.http_url,
           ws_url = EXCLUDED.ws_url,
           world_map_id = EXCLUDED.world_map_id`,
      [realm.id, realm.name, realm.httpUrl, realm.wsUrl, "starter-valley"]
    );
    await pool.query(
      `INSERT INTO realm_world_state (realm_id, world_map_id)
       VALUES ($1, $2)
       ON CONFLICT (realm_id) DO NOTHING`,
      [realm.id, "starter-valley"]
    );
  }
}
