import { type Direction, type Tile } from "./game";

// 64-bit bitboard AI with precomputed move tables.
// Inspired by nneonneo's 2048-ai (MIT), re-implemented in TypeScript.

type Board = bigint;

type EvalState = {
  transTable: Map<bigint, { depth: number; heuristic: number }>;
  maxdepth: number;
  curdepth: number;
  cachehits: number;
  movesEvaled: number;
  depthLimit: number;
  timeLimitMs?: number;
  startTime?: number;
  timedOut?: boolean;
};

const ROW_COUNT = 1 << 16;
const ROW_MASK = 0xffffn;
const COL_MASK = 0x000f000f000f000fn;

const rowLeftTable = new Uint16Array(ROW_COUNT);
const rowRightTable = new Uint16Array(ROW_COUNT);
const colUpTable = new Array<bigint>(ROW_COUNT);
const colDownTable = new Array<bigint>(ROW_COUNT);
const heurScoreTable = new Float64Array(ROW_COUNT);
const scoreTable = new Float64Array(ROW_COUNT);

const SCORE_LOST_PENALTY = 200000.0;
const SCORE_MONOTONICITY_POWER = 4.0;
const SCORE_MONOTONICITY_WEIGHT = 47.0;
const SCORE_SUM_POWER = 3.5;
const SCORE_SUM_WEIGHT = 11.0;
const SCORE_MERGES_WEIGHT = 700.0;
const SCORE_EMPTY_WEIGHT = 270.0;

const CPROB_THRESH_BASE = 0.0001;
const CACHE_DEPTH_LIMIT = 15;

const now = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

const reverseRow = (row: number): number =>
  ((row >> 12) | ((row >> 4) & 0x00f0) | ((row << 4) & 0x0f00) | (row << 12)) &
  0xffff;

const unpackCol = (row: number): bigint => {
  const tmp = BigInt(row);
  return (tmp | (tmp << 12n) | (tmp << 24n) | (tmp << 36n)) & COL_MASK;
};

const transpose = (x: bigint): bigint => {
  const a1 = x & 0xf0f00f0ff0f00f0fn;
  const a2 = x & 0x0000f0f00000f0f0n;
  const a3 = x & 0x0f0f00000f0f0000n;
  const a = a1 | (a2 << 12n) | (a3 >> 12n);
  const b1 = a & 0xff00ff0000ff00ffn;
  const b2 = a & 0x00ff00ff00000000n;
  const b3 = a & 0x00000000ff00ff00n;
  return b1 | (b2 >> 24n) | (b3 << 24n);
};

const initTables = () => {
  for (let row = 0; row < ROW_COUNT; row += 1) {
    const line = [
      row & 0xf,
      (row >> 4) & 0xf,
      (row >> 8) & 0xf,
      (row >> 12) & 0xf,
    ];

    let score = 0.0;
    for (let i = 0; i < 4; i += 1) {
      const rank = line[i];
      if (rank >= 2) {
        score += (rank - 1) * (1 << rank);
      }
    }
    scoreTable[row] = score;

    let sum = 0.0;
    let empty = 0;
    let merges = 0;
    let prev = 0;
    let counter = 0;

    for (let i = 0; i < 4; i += 1) {
      const rank = line[i];
      sum += Math.pow(rank, SCORE_SUM_POWER);
      if (rank === 0) {
        empty += 1;
      } else {
        if (prev === rank) {
          counter += 1;
        } else if (counter > 0) {
          merges += 1 + counter;
          counter = 0;
        }
        prev = rank;
      }
    }
    if (counter > 0) {
      merges += 1 + counter;
    }

    let monotonicityLeft = 0.0;
    let monotonicityRight = 0.0;
    for (let i = 1; i < 4; i += 1) {
      if (line[i - 1] > line[i]) {
        monotonicityLeft +=
          Math.pow(line[i - 1], SCORE_MONOTONICITY_POWER) -
          Math.pow(line[i], SCORE_MONOTONICITY_POWER);
      } else {
        monotonicityRight +=
          Math.pow(line[i], SCORE_MONOTONICITY_POWER) -
          Math.pow(line[i - 1], SCORE_MONOTONICITY_POWER);
      }
    }

    heurScoreTable[row] =
      SCORE_LOST_PENALTY +
      SCORE_EMPTY_WEIGHT * empty +
      SCORE_MERGES_WEIGHT * merges -
      SCORE_MONOTONICITY_WEIGHT *
        Math.min(monotonicityLeft, monotonicityRight) -
      SCORE_SUM_WEIGHT * sum;

    const moveLine = [...line];
    for (let i = 0; i < 3; i += 1) {
      let j = i + 1;
      while (j < 4 && moveLine[j] === 0) {
        j += 1;
      }
      if (j === 4) break;

      if (moveLine[i] === 0) {
        moveLine[i] = moveLine[j];
        moveLine[j] = 0;
        i -= 1;
      } else if (moveLine[i] === moveLine[j]) {
        if (moveLine[i] !== 0xf) {
          moveLine[i] += 1;
        }
        moveLine[j] = 0;
      }
    }

    const resultRow =
      moveLine[0] |
      (moveLine[1] << 4) |
      (moveLine[2] << 8) |
      (moveLine[3] << 12);

    const revRow = reverseRow(row);
    const revResult = reverseRow(resultRow);

    rowLeftTable[row] = row ^ resultRow;
    rowRightTable[revRow] = revRow ^ revResult;
    colUpTable[row] = unpackCol(row) ^ unpackCol(resultRow);
    colDownTable[revRow] = unpackCol(revRow) ^ unpackCol(revResult);
  }
};

initTables();

const tilesToBoard = (tiles: Tile[]): Board => {
  let board = 0n;
  for (const tile of tiles) {
    const rank = Math.log2(tile.value) | 0;
    const index = BigInt(tile.row * 4 + tile.col);
    board |= BigInt(rank) << (4n * index);
  }
  return board;
};

const executeMove0 = (board: Board): Board => {
  const t = transpose(board);
  let ret = board;
  ret ^= colUpTable[Number((t >> 0n) & ROW_MASK)] << 0n;
  ret ^= colUpTable[Number((t >> 16n) & ROW_MASK)] << 4n;
  ret ^= colUpTable[Number((t >> 32n) & ROW_MASK)] << 8n;
  ret ^= colUpTable[Number((t >> 48n) & ROW_MASK)] << 12n;
  return ret;
};

const executeMove1 = (board: Board): Board => {
  const t = transpose(board);
  let ret = board;
  ret ^= colDownTable[Number((t >> 0n) & ROW_MASK)] << 0n;
  ret ^= colDownTable[Number((t >> 16n) & ROW_MASK)] << 4n;
  ret ^= colDownTable[Number((t >> 32n) & ROW_MASK)] << 8n;
  ret ^= colDownTable[Number((t >> 48n) & ROW_MASK)] << 12n;
  return ret;
};

const executeMove2 = (board: Board): Board => {
  let ret = board;
  ret ^= BigInt(rowLeftTable[Number((board >> 0n) & ROW_MASK)]) << 0n;
  ret ^= BigInt(rowLeftTable[Number((board >> 16n) & ROW_MASK)]) << 16n;
  ret ^= BigInt(rowLeftTable[Number((board >> 32n) & ROW_MASK)]) << 32n;
  ret ^= BigInt(rowLeftTable[Number((board >> 48n) & ROW_MASK)]) << 48n;
  return ret;
};

const executeMove3 = (board: Board): Board => {
  let ret = board;
  ret ^= BigInt(rowRightTable[Number((board >> 0n) & ROW_MASK)]) << 0n;
  ret ^= BigInt(rowRightTable[Number((board >> 16n) & ROW_MASK)]) << 16n;
  ret ^= BigInt(rowRightTable[Number((board >> 32n) & ROW_MASK)]) << 32n;
  ret ^= BigInt(rowRightTable[Number((board >> 48n) & ROW_MASK)]) << 48n;
  return ret;
};

const executeMove = (move: number, board: Board): Board => {
  switch (move) {
    case 0:
      return executeMove0(board);
    case 1:
      return executeMove1(board);
    case 2:
      return executeMove2(board);
    case 3:
      return executeMove3(board);
    default:
      return board;
  }
};

const countEmpty = (board: Board): number => {
  let x = board;
  x |= (x >> 2n) & 0x3333333333333333n;
  x |= x >> 1n;
  x = ~x & 0x1111111111111111n;
  x += x >> 32n;
  x += x >> 16n;
  x += x >> 8n;
  x += x >> 4n;
  return Number(x & 0xfn);
};

const countDistinctTiles = (board: Board): number => {
  let bitset = 0;
  let tmp = board;
  while (tmp) {
    bitset |= 1 << Number(tmp & 0xfn);
    tmp >>= 4n;
  }

  bitset >>= 1;
  let count = 0;
  while (bitset) {
    bitset &= bitset - 1;
    count += 1;
  }
  return count;
};

const scoreHelper = (board: Board, table: Float64Array): number =>
  table[Number((board >> 0n) & ROW_MASK)] +
  table[Number((board >> 16n) & ROW_MASK)] +
  table[Number((board >> 32n) & ROW_MASK)] +
  table[Number((board >> 48n) & ROW_MASK)];

const scoreHeurBoard = (board: Board): number =>
  scoreHelper(board, heurScoreTable) +
  scoreHelper(transpose(board), heurScoreTable);

const timeExceeded = (state: EvalState): boolean => {
  if (!state.timeLimitMs || state.startTime === undefined) {
    return false;
  }
  if (now() - state.startTime > state.timeLimitMs) {
    state.timedOut = true;
    return true;
  }
  return false;
};

const scoreTilechooseNode = (
  state: EvalState,
  board: Board,
  cprob: number,
): number => {
  if (timeExceeded(state)) {
    return scoreHeurBoard(board);
  }

  if (cprob < CPROB_THRESH_BASE || state.curdepth >= state.depthLimit) {
    state.maxdepth = Math.max(state.curdepth, state.maxdepth);
    return scoreHeurBoard(board);
  }

  if (state.curdepth < CACHE_DEPTH_LIMIT) {
    const cached = state.transTable.get(board);
    if (cached && cached.depth <= state.curdepth) {
      state.cachehits += 1;
      return cached.heuristic;
    }
  }

  const numOpen = countEmpty(board);
  if (numOpen === 0) {
    return scoreHeurBoard(board);
  }

  const prob = cprob / numOpen;
  let result = 0.0;
  for (let index = 0; index < 16; index += 1) {
    if (timeExceeded(state)) {
      return scoreHeurBoard(board);
    }
    const shift = 4n * BigInt(index);
    const cell = (board >> shift) & 0xfn;
    if (cell === 0n) {
      const tile = 1n << shift;
      result += scoreMoveNode(state, board | tile, prob * 0.9) * 0.9;
      result += scoreMoveNode(state, board | (tile << 1n), prob * 0.1) * 0.1;
    }
  }

  result /= numOpen;

  if (state.curdepth < CACHE_DEPTH_LIMIT) {
    state.transTable.set(board, { depth: state.curdepth, heuristic: result });
  }

  return result;
};

const scoreMoveNode = (
  state: EvalState,
  board: Board,
  cprob: number,
): number => {
  if (timeExceeded(state)) {
    return scoreHeurBoard(board);
  }

  let best = 0.0;
  state.curdepth += 1;

  for (let move = 0; move < 4; move += 1) {
    if (timeExceeded(state)) {
      break;
    }
    const newboard = executeMove(move, board);
    state.movesEvaled += 1;
    if (newboard !== board) {
      const score = scoreTilechooseNode(state, newboard, cprob);
      if (score > best) {
        best = score;
      }
    }
  }

  state.curdepth -= 1;
  return best;
};

const scoreToplevelMove = (
  state: EvalState,
  board: Board,
  move: number,
): number => {
  const newboard = executeMove(move, board);
  if (newboard === board) {
    return 0;
  }
  return scoreTilechooseNode(state, newboard, 1.0) + 1e-6;
};

const moveIndexToDirection = (move: number): Direction => {
  switch (move) {
    case 0:
      return "up";
    case 1:
      return "down";
    case 2:
      return "left";
    case 3:
      return "right";
    default:
      return "left";
  }
};

export const getBestMove = (
  tiles: Tile[],
  options?: { timeLimitMs?: number },
): Direction | null => {
  if (tiles.length === 0) {
    return null;
  }

  const board = tilesToBoard(tiles);
  const state: EvalState = {
    transTable: new Map<bigint, { depth: number; heuristic: number }>(),
    maxdepth: 0,
    curdepth: 0,
    cachehits: 0,
    movesEvaled: 0,
    depthLimit: Math.max(3, countDistinctTiles(board) - 2),
    timeLimitMs: options?.timeLimitMs,
    startTime: options?.timeLimitMs ? now() : undefined,
    timedOut: false,
  };

  let bestMove = -1;
  let bestScore = 0.0;

  for (let move = 0; move < 4; move += 1) {
    const score = scoreToplevelMove(state, board, move);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
    if (state.timedOut) {
      break;
    }
  }

  if (bestMove >= 0) {
    return moveIndexToDirection(bestMove);
  }

  const fallbackOrder = [1, 2, 3, 0];
  for (const move of fallbackOrder) {
    if (executeMove(move, board) !== board) {
      return moveIndexToDirection(move);
    }
  }

  return null;
};

export const getHybridMove = (
  tiles: Tile[],
  options?: { timeLimitMs?: number },
): Direction | null => getBestMove(tiles, options);
