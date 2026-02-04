"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import styles from "./page.module.css";
import {
  addRandomTile,
  BOARD_SIZE,
  createStartingTiles,
  getMaxTile,
  hasAvailableMoves,
  moveTiles,
  type Tile,
} from "@/lib/game";
import type { Direction } from "@/lib/game";

const BEST_KEY = "2048-best-score";

type HistoryEntry = {
  tiles: Tile[];
  score: number;
  hasWon: boolean;
};

type GameState = {
  tiles: Tile[];
  score: number;
  history: HistoryEntry[];
  hasWon: boolean;
  gameOver: boolean;
  mergeIds: string[];
};

const createInitialState = (): GameState => ({
  tiles: createStartingTiles(),
  score: 0,
  history: [],
  hasWon: false,
  gameOver: false,
  mergeIds: [],
});

const createEmptyState = (): GameState => ({
  tiles: [],
  score: 0,
  history: [],
  hasWon: false,
  gameOver: false,
  mergeIds: [],
});

export default function Home() {
  const [best, setBest] = useState(0);
  const [game, setGame] = useState<GameState>(() => createEmptyState());
  const [layout, setLayout] = useState({ cellSize: 0, step: 0 });
  const [autoPlay, setAutoPlay] = useState(false);
  const [aiSpeed, setAiSpeed] = useState(6);
  const [aiActualSpeed, setAiActualSpeed] = useState(0);
  const boardRef = useRef<HTMLDivElement>(null);
  const tilesRef = useRef<Tile[]>([]);
  const gameOverRef = useRef(false);
  const autoPlayRef = useRef(false);
  const aiWorkerRef = useRef<Worker | null>(null);
  const aiPendingRef = useRef(false);
  const aiRequestIdRef = useRef(0);
  const lastMoveRef = useRef<number | null>(null);

  const gridCells = useMemo(
    () => Array.from({ length: BOARD_SIZE * BOARD_SIZE }),
    [],
  );
  const mergeSet = useMemo(() => new Set(game.mergeIds), [game.mergeIds]);

  useEffect(() => {
    const saved = Number(localStorage.getItem(BEST_KEY));
    if (!Number.isNaN(saved)) {
      setBest(saved);
    }
  }, []);

  useEffect(() => {
    setGame(createInitialState());
  }, []);

  useEffect(() => {
    tilesRef.current = game.tiles;
    gameOverRef.current = game.gameOver;
  }, [game.tiles, game.gameOver]);

  useEffect(() => {
    autoPlayRef.current = autoPlay;
  }, [autoPlay]);

  const applyMove = useCallback(
    (direction: Direction) => {
      setGame((prev) => {
        if (prev.gameOver) {
          return prev;
        }

        const {
          tiles: movedTiles,
          moved,
          scoreGain,
          mergedIds,
        } = moveTiles(
          prev.tiles,
          direction,
        );
        if (!moved) {
          return prev;
        }

        const { tiles: withSpawn } = addRandomTile(movedTiles);
        const nextScore = prev.score + scoreGain;
        const nextHasWon = prev.hasWon || getMaxTile(withSpawn) >= 2048;
        const nextGameOver = !hasAvailableMoves(withSpawn);

        return {
          tiles: withSpawn,
          score: nextScore,
          hasWon: nextHasWon,
          gameOver: nextGameOver,
          mergeIds: mergedIds,
          history: [
            ...prev.history,
            { tiles: prev.tiles, score: prev.score, hasWon: prev.hasWon },
          ],
        };
      });
    },
    [],
  );

  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/aiWorker.ts", import.meta.url),
      { type: "module" },
    );

    aiWorkerRef.current = worker;

    worker.onmessage = (event) => {
      const { id, move } = event.data as {
        id: number;
        move: Direction | null;
      };

      if (id !== aiRequestIdRef.current) {
        return;
      }

      aiPendingRef.current = false;

      if (!autoPlayRef.current || gameOverRef.current) {
        return;
      }

      if (move !== null) {
        applyMove(move);
        const nowTime = performance.now();
        if (lastMoveRef.current) {
          const delta = nowTime - lastMoveRef.current;
          const currentSpeed = 1000 / delta;
          setAiActualSpeed((prev) =>
            prev === 0 ? currentSpeed : prev * 0.6 + currentSpeed * 0.4,
          );
        }
        lastMoveRef.current = nowTime;
      }
    };

    return () => {
      worker.terminate();
      aiWorkerRef.current = null;
    };
  }, [applyMove]);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) {
      return;
    }

    const updateLayout = () => {
      const styles = getComputedStyle(board);
      const gap = Number.parseFloat(
        styles.getPropertyValue("--board-gap"),
      );
      const padding = Number.parseFloat(
        styles.getPropertyValue("--board-padding"),
      );
      const resolvedGap = Number.isNaN(gap) ? 12 : gap;
      const resolvedPadding = Number.isNaN(padding) ? 16 : padding;
      const size = board.clientWidth - resolvedPadding * 2;
      const cellSize = (size - resolvedGap * 3) / 4;
      const step = cellSize + resolvedGap;
      setLayout({ cellSize, step });
    };

    updateLayout();
    const observer = new ResizeObserver(updateLayout);
    observer.observe(board);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (game.score > best) {
      setBest(game.score);
      localStorage.setItem(BEST_KEY, String(game.score));
    }
  }, [game.score, best]);

  const startNewGame = useCallback(() => {
    setGame(createInitialState());
  }, []);

  const handleUndo = useCallback(() => {
    setGame((prev) => {
      if (prev.history.length === 0) {
        return prev;
      }
      const last = prev.history[prev.history.length - 1];
      return {
        tiles: last.tiles,
        score: last.score,
        hasWon: last.hasWon,
        gameOver: false,
        mergeIds: [],
        history: prev.history.slice(0, -1),
      };
    });
  }, []);

  useEffect(() => {
    if (game.mergeIds.length === 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setGame((prev) =>
        prev.mergeIds.length > 0 ? { ...prev, mergeIds: [] } : prev,
      );
    }, 180);

    return () => window.clearTimeout(timeout);
  }, [game.mergeIds]);

  useEffect(() => {
    if (!autoPlay || gameOverRef.current) {
      return;
    }

    let timeoutId: number;
    let cancelled = false;

    const packBoard = (tiles: Tile[]): bigint => {
      let board = 0n;
      for (const tile of tiles) {
        const rank = Math.log2(tile.value) | 0;
        const index = BigInt(tile.row * 4 + tile.col);
        board |= BigInt(rank) << (4n * index);
      }
      return board;
    };

    const tick = () => {
      if (cancelled || gameOverRef.current) {
        return;
      }

      const intervalMs = Math.max(30, Math.round(1000 / aiSpeed));
      const delay = intervalMs;

      if (!aiPendingRef.current && aiWorkerRef.current) {
        aiPendingRef.current = true;
        const id = ++aiRequestIdRef.current;
        const board = packBoard(tilesRef.current);
        aiWorkerRef.current.postMessage({ id, board });
      }

      timeoutId = window.setTimeout(tick, delay);
    };

    tick();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [autoPlay, aiSpeed]);

  useEffect(() => {
    if (!autoPlay) {
      lastMoveRef.current = null;
      setAiActualSpeed(0);
    }
  }, [autoPlay]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      let direction: Direction | null = null;

      if (key === "arrowup" || key === "w") direction = "up";
      if (key === "arrowdown" || key === "s") direction = "down";
      if (key === "arrowleft" || key === "a") direction = "left";
      if (key === "arrowright" || key === "d") direction = "right";

      if (!direction) return;

      event.preventDefault();
      applyMove(direction);
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [applyMove]);

  const statusLabel = game.gameOver
    ? "Game Over"
    : game.hasWon
      ? "2048 Reached"
      : "Ready";
  const statusClass = game.gameOver
    ? styles.statusDanger
    : game.hasWon
      ? styles.statusSuccess
      : styles.statusNeutral;

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <a
          className={styles.topBarLink}
          href="https://avi-kaufman.com"
        >
          Avi-Kaufman.com
        </a>
      </div>
      <div className={styles.backgroundGlow} aria-hidden="true" />
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.brandBadge}>2048</div>
          <div>
            <p className={styles.brandTitle}>2048 AI Playground</p>
          </div>
        </div>
        <div className={styles.scoreboard}>
          <div className={styles.scoreCard}>
            <span className={styles.scoreLabel}>Score</span>
            <span className={styles.scoreValue}>{game.score}</span>
          </div>
          <div className={styles.scoreCard}>
            <span className={styles.scoreLabel}>Best</span>
            <span className={styles.scoreValue}>{best}</span>
          </div>
        </div>
      </header>
      <main className={styles.main}>
        <section className={styles.boardRow}>
          <div className={styles.boardSection}>
            <div className={styles.boardHeader}>
              <div>
                <h2>Live Board</h2>
                <p>Press an arrow key to start.</p>
              </div>
              <div className={styles.boardLegend}>
                <span>4 × 4 grid</span>
                <span>16 tiles</span>
                <span className={`${styles.statusPill} ${statusClass}`}>
                  {statusLabel}
                </span>
              </div>
            </div>
            <div
              className={styles.board}
              role="grid"
              aria-label="2048 board"
              ref={boardRef}
            >
              <div className={styles.grid} aria-hidden="true">
                {gridCells.map((_, index) => (
                  <div key={index} className={styles.gridCell} />
                ))}
              </div>
              <div className={styles.tiles}>
                {game.tiles.map((tile) => (
                  <div
                    key={tile.id}
                    role="gridcell"
                    aria-label={`${tile.value}`}
                    className={styles.tile}
                    style={
                      {
                        width: layout.cellSize,
                        height: layout.cellSize,
                        transform: `translate(${tile.col * layout.step}px, ${tile.row * layout.step}px)`,
                      } as CSSProperties
                    }
                  >
                    <div
                      className={`${styles.tileFace} ${
                        styles[`tile${tile.value}`] ?? ""
                      } ${mergeSet.has(tile.id) ? styles.merge : ""}`}
                    >
                      {tile.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <aside className={styles.aiPanel}>
            <div className={styles.panelCard}>
              <h3>AI Tools</h3>
              <p>
                Fast AI inspired by nneonneo&apos;s 2048 solver. Toggle to let
                it play automatically.
              </p>
              <div className={styles.aiAction}>
                <button
                  className={styles.primaryButton}
                  onClick={() => setAutoPlay((prev) => !prev)}
                  disabled={game.gameOver}
                >
                  {autoPlay ? "Stop Auto-play" : "Start Auto-play"}
                </button>
                <label className={styles.aiSpeed}>
                  <span>Speed</span>
                  <input
                    className={styles.aiSlider}
                    type="range"
                    min={2}
                    max={20}
                    step={1}
                    value={aiSpeed}
                    onChange={(event) =>
                      setAiSpeed(Number(event.target.value))
                    }
                  />
                  <span className={styles.aiSpeedValue}>
                    {aiSpeed} moves/sec target
                  </span>
                  <span className={styles.aiSpeedValue}>
                    {aiActualSpeed ? aiActualSpeed.toFixed(1) : "—"} actual
                  </span>
                </label>
                <p className={styles.aiHint}>
                  Auto-play runs the WASM solver in a worker.
                </p>
              </div>
            </div>
          </aside>
        </section>
        <section className={styles.panel}>
          <div className={styles.panelCard}>
            <h2>Move, Merge, Repeat</h2>
            <p>
              Use arrow keys or WASD to combine tiles. Reach 2048 to win, then
              keep going for a higher score.
            </p>
            <div className={styles.controls}>
              <button
                className={styles.primaryButton}
                onClick={startNewGame}
              >
                New Game
              </button>
              <button
                className={styles.secondaryButton}
                onClick={handleUndo}
                disabled={game.history.length === 0}
              >
                Undo
              </button>
            </div>
          </div>
          <div className={styles.panelCard}>
            <h3>Build Notes</h3>
            <p>
              Core game logic and keyboard controls are live. Best score is
              saved locally, and AI controls can be layered in next.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
