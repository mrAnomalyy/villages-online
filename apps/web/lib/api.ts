import type {
  CharacterAppearance,
  CharacterBodyType,
  CharacterProfile,
  CharacterSummary,
  GuestAuthResponse,
  RealmDescriptor,
  RealmJoinTicket,
  Vector3Like,
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

export async function fetchMyCharacters(token: string): Promise<CharacterProfile[]> {
  const response = await fetch(`${gatewayUrl}/api/characters/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? "Failed to fetch saved characters.");
  }

  return response.json();
}

export async function saveCharacterCustomization(
  token: string,
  payload: {
    id?: string;
    name?: string;
    nickname?: string;
    appearance: CharacterAppearance;
    lastPosition?: Vector3Like | null;
  }
): Promise<{ success: boolean; characterId: string; character: CharacterProfile }> {
  const response = await fetch(`${gatewayUrl}/api/characters`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "Failed to save character customization.");
  }

  return response.json();
}
