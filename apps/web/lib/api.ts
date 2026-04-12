import type {
  CharacterBodyType,
  CharacterSummary,
  GuestAuthResponse,
  RealmDescriptor,
  RealmJoinTicket,
} from "@villages/shared";

const gatewayUrl = "/api/gateway";

export async function fetchRealms(): Promise<RealmDescriptor[]> {
  const response = await fetch(`${gatewayUrl}/realms`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to fetch realms.");
  }
  return response.json();
}

export async function guestAuth(
  nickname: string,
  existingToken?: string
): Promise<GuestAuthResponse> {
  const response = await fetch(`${gatewayUrl}/auth/guest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      nickname,
      existingToken,
    }),
  });

  if (!response.ok) {
    const payload = (await response.json()) as { message?: string };
    throw new Error(payload.message ?? "Failed to authenticate guest.");
  }

  return response.json();
}

export async function fetchCharacter(
  realmId: string,
  playerId: string,
  token: string
): Promise<CharacterSummary | null> {
  const response = await fetch(`${gatewayUrl}/realms/${realmId}/character`, {
    headers: {
      "x-player-id": playerId,
      "x-player-token": token,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const payload = (await response.json()) as { message?: string };
    throw new Error(payload.message ?? "Failed to load character.");
  }

  return response.json();
}

export async function createCharacter(
  realmId: string,
  playerId: string,
  token: string,
  bodyType: CharacterBodyType
): Promise<CharacterSummary> {
  const response = await fetch(`${gatewayUrl}/realms/${realmId}/characters`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-player-id": playerId,
      "x-player-token": token,
    },
    body: JSON.stringify({ bodyType }),
  });

  if (!response.ok) {
    const payload = (await response.json()) as { message?: string };
    throw new Error(payload.message ?? "Failed to create character.");
  }

  return response.json();
}

export async function requestJoinTicket(
  realmId: string,
  playerId: string,
  token: string
): Promise<RealmJoinTicket> {
  const response = await fetch(`${gatewayUrl}/realms/${realmId}/join`, {
    method: "POST",
    headers: {
      "x-player-id": playerId,
      "x-player-token": token,
    },
  });

  if (!response.ok) {
    const payload = (await response.json()) as { message?: string };
    throw new Error(payload.message ?? "Failed to join realm.");
  }

  return response.json();
}
