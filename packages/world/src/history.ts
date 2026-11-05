import type { MapAsset, MapBounds, MapNpcDefinition, TerrainChunkDTO } from "@villages/shared";
import { cloneMapAsset, computeMapBounds } from "./map";

export type HeightCellDelta = {
  row: number;
  column: number;
  oldHeight: number;
  newHeight: number;
};

export type WaterCellDelta = {
  row: number;
  column: number;
  oldValue: boolean;
  newValue: boolean;
};

export type EditorTransaction =
  | {
      type: "sculpt_terrain";
      changes: Array<{ chunkId: string; cells: HeightCellDelta[] }>;
      description?: string;
    }
  | {
      type: "paint_water";
      changes: Array<{ chunkId: string; cells: WaterCellDelta[] }>;
      description?: string;
    }
  | {
      type: "add_chunk";
      chunk: TerrainChunkDTO;
      previousBounds: MapBounds;
      newBounds: MapBounds;
      description?: string;
    }
  | {
      type: "remove_chunk";
      chunk: TerrainChunkDTO;
      previousBounds: MapBounds;
      newBounds: MapBounds;
      description?: string;
    }
  | {
      type: "npc_mutate";
      oldNpc?: MapNpcDefinition;
      newNpc?: MapNpcDefinition;
      description?: string;
    };

export type HistoryState = {
  undoStack: EditorTransaction[];
  redoStack: EditorTransaction[];
  maxDepth: number;
};

export function createHistoryState(maxDepth = 50): HistoryState {
  return {
    undoStack: [],
    redoStack: [],
    maxDepth,
  };
}

export function pushTransaction(state: HistoryState, transaction: EditorTransaction): HistoryState {
  const nextUndo = [...state.undoStack, transaction];
  if (nextUndo.length > state.maxDepth) {
    nextUndo.shift();
  }
  return {
    ...state,
    undoStack: nextUndo,
    redoStack: [],
  };
}

export function canUndo(state: HistoryState): boolean {
  return state.undoStack.length > 0;
}

export function canRedo(state: HistoryState): boolean {
  return state.redoStack.length > 0;
}

export function applyTransaction(
  map: MapAsset,
  transaction: EditorTransaction,
  direction: "undo" | "redo"
): MapAsset {
  const next = cloneMapAsset(map);

  switch (transaction.type) {
    case "sculpt_terrain": {
      for (const change of transaction.changes) {
        const chunk = next.chunks.find((c) => c.id === change.chunkId);
        if (!chunk) {
          continue;
        }
        for (const cell of change.cells) {
          if (chunk.heights[cell.row] && cell.column < chunk.heights[cell.row].length) {
            chunk.heights[cell.row][cell.column] =
              direction === "undo" ? cell.oldHeight : cell.newHeight;
          }
        }
      }
      next.bounds = computeMapBounds(next.chunks);
      return next;
    }

    case "paint_water": {
      for (const change of transaction.changes) {
        const chunk = next.chunks.find((c) => c.id === change.chunkId);
        if (!chunk) {
          continue;
        }
        for (const cell of change.cells) {
          if (chunk.water[cell.row] && cell.column < chunk.water[cell.row].length) {
            chunk.water[cell.row][cell.column] =
              direction === "undo" ? cell.oldValue : cell.newValue;
          }
        }
      }
      next.bounds = computeMapBounds(next.chunks);
      return next;
    }

    case "add_chunk": {
      if (direction === "undo") {
        next.chunks = next.chunks.filter((c) => c.id !== transaction.chunk.id);
        next.bounds = transaction.previousBounds;
      } else {
        if (!next.chunks.some((c) => c.id === transaction.chunk.id)) {
          next.chunks.push(transaction.chunk);
          next.chunks.sort((left, right) => left.z - right.z || left.x - right.x);
        }
        next.bounds = transaction.newBounds;
      }
      return next;
    }

    case "remove_chunk": {
      if (direction === "undo") {
        if (!next.chunks.some((c) => c.id === transaction.chunk.id)) {
          next.chunks.push(transaction.chunk);
          next.chunks.sort((left, right) => left.z - right.z || left.x - right.x);
        }
        next.bounds = transaction.previousBounds;
      } else {
        next.chunks = next.chunks.filter((c) => c.id !== transaction.chunk.id);
        next.bounds = transaction.newBounds;
      }
      return next;
    }

    case "npc_mutate": {
      if (direction === "undo") {
        if (transaction.oldNpc) {
          const targetId = transaction.newNpc?.id ?? transaction.oldNpc.id;
          const index = next.npcs.findIndex((npc) => npc.id === targetId);
          if (index >= 0) {
            next.npcs[index] = { ...transaction.oldNpc };
          } else {
            next.npcs.push({ ...transaction.oldNpc });
          }
        } else if (transaction.newNpc) {
          next.npcs = next.npcs.filter((npc) => npc.id !== transaction.newNpc!.id);
        }
      } else {
        if (transaction.newNpc) {
          const targetId = transaction.oldNpc?.id ?? transaction.newNpc.id;
          const index = next.npcs.findIndex((npc) => npc.id === targetId);
          if (index >= 0) {
            next.npcs[index] = { ...transaction.newNpc };
          } else {
            next.npcs.push({ ...transaction.newNpc });
          }
        } else if (transaction.oldNpc) {
          next.npcs = next.npcs.filter((npc) => npc.id !== transaction.oldNpc!.id);
        }
      }
      return next;
    }
  }
}

export function undo(
  map: MapAsset,
  state: HistoryState
): { map: MapAsset; state: HistoryState; transaction: EditorTransaction } | null {
  if (state.undoStack.length === 0) {
    return null;
  }

  const transaction = state.undoStack[state.undoStack.length - 1];
  const nextUndo = state.undoStack.slice(0, -1);
  const nextRedo = [...state.redoStack, transaction];
  const updatedMap = applyTransaction(map, transaction, "undo");

  return {
    map: updatedMap,
    state: {
      ...state,
      undoStack: nextUndo,
      redoStack: nextRedo,
    },
    transaction,
  };
}

export function redo(
  map: MapAsset,
  state: HistoryState
): { map: MapAsset; state: HistoryState; transaction: EditorTransaction } | null {
  if (state.redoStack.length === 0) {
    return null;
  }

  const transaction = state.redoStack[state.redoStack.length - 1];
  const nextRedo = state.redoStack.slice(0, -1);
  const nextUndo = [...state.undoStack, transaction];
  const updatedMap = applyTransaction(map, transaction, "redo");

  return {
    map: updatedMap,
    state: {
      ...state,
      undoStack: nextUndo,
      redoStack: nextRedo,
    },
    transaction,
  };
}

export function diffMapHeights(
  before: MapAsset,
  after: MapAsset
): Array<{ chunkId: string; cells: HeightCellDelta[] }> {
  const result: Array<{ chunkId: string; cells: HeightCellDelta[] }> = [];

  for (const beforeChunk of before.chunks) {
    const afterChunk = after.chunks.find((c) => c.id === beforeChunk.id);
    if (!afterChunk) {
      continue;
    }

    const cells: HeightCellDelta[] = [];
    for (let row = 0; row < beforeChunk.heights.length; row += 1) {
      const beforeRow = beforeChunk.heights[row];
      const afterRow = afterChunk.heights[row];
      if (!beforeRow || !afterRow) {
        continue;
      }
      for (let col = 0; col < beforeRow.length; col += 1) {
        if (beforeRow[col] !== afterRow[col]) {
          cells.push({
            row,
            column: col,
            oldHeight: beforeRow[col],
            newHeight: afterRow[col],
          });
        }
      }
    }

    if (cells.length > 0) {
      result.push({ chunkId: beforeChunk.id, cells });
    }
  }

  return result;
}

export function diffMapWater(
  before: MapAsset,
  after: MapAsset
): Array<{ chunkId: string; cells: WaterCellDelta[] }> {
  const result: Array<{ chunkId: string; cells: WaterCellDelta[] }> = [];

  for (const beforeChunk of before.chunks) {
    const afterChunk = after.chunks.find((c) => c.id === beforeChunk.id);
    if (!afterChunk) {
      continue;
    }

    const cells: WaterCellDelta[] = [];
    for (let row = 0; row < beforeChunk.water.length; row += 1) {
      const beforeRow = beforeChunk.water[row];
      const afterRow = afterChunk.water[row];
      if (!beforeRow || !afterRow) {
        continue;
      }
      for (let col = 0; col < beforeRow.length; col += 1) {
        if (beforeRow[col] !== afterRow[col]) {
          cells.push({
            row,
            column: col,
            oldValue: beforeRow[col],
            newValue: afterRow[col],
          });
        }
      }
    }

    if (cells.length > 0) {
      result.push({ chunkId: beforeChunk.id, cells });
    }
  }

  return result;
}
