export function get3x3ChunkIds(centerChunkId: string): string[] {
  const parts = centerChunkId.split(":");
  if (parts.length !== 2) {
    return [centerChunkId];
  }
  const centerX = Number(parts[0]);
  const centerZ = Number(parts[1]);
  if (Number.isNaN(centerX) || Number.isNaN(centerZ)) {
    return [centerChunkId];
  }

  const chunkIds: string[] = [];
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      chunkIds.push(`${centerX + dx}:${centerZ + dz}`);
    }
  }
  return chunkIds;
}

export class SpatialGrid {
  private entityToChunk = new Map<string, string>();
  private chunkToEntities = new Map<string, Set<string>>();

  insert(entityId: string, chunkId: string): void {
    const currentChunk = this.entityToChunk.get(entityId);
    if (currentChunk === chunkId) {
      return;
    }
    if (currentChunk) {
      this.remove(entityId);
    }

    this.entityToChunk.set(entityId, chunkId);
    let chunkSet = this.chunkToEntities.get(chunkId);
    if (!chunkSet) {
      chunkSet = new Set<string>();
      this.chunkToEntities.set(chunkId, chunkSet);
    }
    chunkSet.add(entityId);
  }

  update(entityId: string, newChunkId: string): void {
    const currentChunk = this.entityToChunk.get(entityId);
    if (currentChunk === newChunkId) {
      return;
    }

    if (currentChunk) {
      const oldSet = this.chunkToEntities.get(currentChunk);
      if (oldSet) {
        oldSet.delete(entityId);
        if (oldSet.size === 0) {
          this.chunkToEntities.delete(currentChunk);
        }
      }
    }

    this.entityToChunk.set(entityId, newChunkId);
    let newSet = this.chunkToEntities.get(newChunkId);
    if (!newSet) {
      newSet = new Set<string>();
      this.chunkToEntities.set(newChunkId, newSet);
    }
    newSet.add(entityId);
  }

  remove(entityId: string): void {
    const currentChunk = this.entityToChunk.get(entityId);
    if (!currentChunk) {
      return;
    }

    this.entityToChunk.delete(entityId);
    const chunkSet = this.chunkToEntities.get(currentChunk);
    if (chunkSet) {
      chunkSet.delete(entityId);
      if (chunkSet.size === 0) {
        this.chunkToEntities.delete(currentChunk);
      }
    }
  }

  getEntitiesInChunks(chunkIds: string[]): Set<string> {
    const result = new Set<string>();
    for (const chunkId of chunkIds) {
      const entities = this.chunkToEntities.get(chunkId);
      if (entities) {
        for (const entityId of entities) {
          result.add(entityId);
        }
      }
    }
    return result;
  }

  getChunkForEntity(entityId: string): string | undefined {
    return this.entityToChunk.get(entityId);
  }

  get size(): number {
    return this.entityToChunk.size;
  }

  clear(): void {
    this.entityToChunk.clear();
    this.chunkToEntities.clear();
  }
}
