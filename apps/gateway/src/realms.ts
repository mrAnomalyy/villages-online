import type { RealmDescriptor } from "@villages/shared";

const realmDirectoryJson =
  process.env.REALM_DIRECTORY_JSON ??
  JSON.stringify([
    {
      id: "alpha",
      name: "Alpha Realm",
      httpUrl: "http://127.0.0.1:4101",
      wsUrl: "ws://127.0.0.1:4101/ws",
    },
    {
      id: "beta",
      name: "Beta Realm",
      httpUrl: "http://127.0.0.1:4102",
      wsUrl: "ws://127.0.0.1:4102/ws",
    },
  ]);

export const realms = JSON.parse(realmDirectoryJson) as RealmDescriptor[];

export function getRealmById(realmId: string): RealmDescriptor | undefined {
  return realms.find((realm) => realm.id === realmId);
}
