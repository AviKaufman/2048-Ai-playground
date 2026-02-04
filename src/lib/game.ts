export type Direction = "up" | "down" | "left" | "right";

export type Tile = {
  id: string;
  value: number;
  row: number;
  col: number;
};

export const BOARD_SIZE = 4;

export const createEmptyBoard = (): number[][] =>
  Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));

const buildValueGrid = (tiles: Tile[]): number[][] => {
  const grid = createEmptyBoard();
  tiles.forEach((tile) => {
    grid[tile.row][tile.col] = tile.value;
  });
  return grid;
};

const gridsMatch = (a: number[][], b: number[][]): boolean =>
  a.every((row, rowIndex) =>
    row.every((value, colIndex) => value === b[rowIndex][colIndex]),
  );

let tileCounter = 0;
const createId = () => {
  tileCounter += 1;
  return `tile-${tileCounter}`;
};

const getEmptyCells = (tiles: Tile[]): Array<[number, number]> => {
  const occupied = new Set(tiles.map((tile) => `${tile.row}-${tile.col}`));
  const cells: Array<[number, number]> = [];

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (!occupied.has(`${row}-${col}`)) {
        cells.push([row, col]);
      }
    }
  }

  return cells;
};

export const createStartingTiles = (
  rng: () => number = Math.random,
): Tile[] => {
  let tiles: Tile[] = [];
  tiles = addRandomTile(tiles, rng).tiles;
  tiles = addRandomTile(tiles, rng).tiles;
  return tiles;
};

export const addRandomTile = (
  tiles: Tile[],
  rng: () => number = Math.random,
): { tiles: Tile[]; spawnedId?: string } => {
  const emptyCells = getEmptyCells(tiles);
  if (emptyCells.length === 0) {
    return { tiles };
  }

  const [row, col] =
    emptyCells[Math.floor(rng() * emptyCells.length)];
  const value = rng() < 0.9 ? 2 : 4;
  const newTile = {
    id: createId(),
    value,
    row,
    col,
  };
  return { tiles: [...tiles, newTile], spawnedId: newTile.id };
};

type LineResult = {
  tiles: Tile[];
  scoreGain: number;
  mergedIds: string[];
};

const mergeLine = (line: Tile[]): LineResult => {
  const merged: Tile[] = [];
  let scoreGain = 0;
  const mergedIds: string[] = [];

  for (let index = 0; index < line.length; index += 1) {
    const current = line[index];
    const next = line[index + 1];

    if (next && current.value === next.value) {
      const mergedValue = current.value + next.value;
      const mergedId = createId();
      scoreGain += mergedValue;
      merged.push({
        id: mergedId,
        value: mergedValue,
        row: current.row,
        col: current.col,
      });
      mergedIds.push(mergedId);
      index += 1;
    } else {
      merged.push({
        id: current.id,
        value: current.value,
        row: current.row,
        col: current.col,
      });
    }
  }

  return { tiles: merged, scoreGain, mergedIds };
};

export const moveTiles = (
  tiles: Tile[],
  direction: Direction,
): { tiles: Tile[]; moved: boolean; scoreGain: number; mergedIds: string[] } => {
  const before = buildValueGrid(tiles);
  const nextTiles: Tile[] = [];
  let scoreGain = 0;
  const mergedIds: string[] = [];

  const commitLine = (
    line: Tile[],
    positionForIndex: (index: number) => { row: number; col: number },
  ) => {
    if (line.length === 0) {
      return;
    }

    const {
      tiles: mergedLine,
      scoreGain: lineScore,
      mergedIds: lineMergedIds,
    } = mergeLine(line);
    scoreGain += lineScore;
    mergedIds.push(...lineMergedIds);

    mergedLine.forEach((tile, index) => {
      const { row, col } = positionForIndex(index);
      nextTiles.push({ ...tile, row, col });
    });
  };

  if (direction === "left" || direction === "right") {
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      const line = tiles
        .filter((tile) => tile.row === row)
        .sort((a, b) => a.col - b.col);
      const working = direction === "right" ? [...line].reverse() : line;

      commitLine(working, (index) => ({
        row,
        col: direction === "right" ? BOARD_SIZE - 1 - index : index,
      }));
    }
  } else {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const line = tiles
        .filter((tile) => tile.col === col)
        .sort((a, b) => a.row - b.row);
      const working = direction === "down" ? [...line].reverse() : line;

      commitLine(working, (index) => ({
        row: direction === "down" ? BOARD_SIZE - 1 - index : index,
        col,
      }));
    }
  }

  const after = buildValueGrid(nextTiles);
  const moved = !gridsMatch(before, after);

  return { tiles: nextTiles, moved, scoreGain, mergedIds };
};

export const hasAvailableMoves = (tiles: Tile[]): boolean => {
  if (getEmptyCells(tiles).length > 0) {
    return true;
  }

  const grid = buildValueGrid(tiles);

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const current = grid[row][col];
      const right = grid[row][col + 1];
      const down = grid[row + 1]?.[col];

      if (current === right || current === down) {
        return true;
      }
    }
  }

  return false;
};

export const getMaxTile = (tiles: Tile[]): number =>
  tiles.length === 0
    ? 0
    : Math.max(...tiles.map((tile) => tile.value));
