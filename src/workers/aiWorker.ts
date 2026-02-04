/// <reference lib="webworker" />

import createModule from "../wasm/ai2048.js";
import type { Direction } from "@/lib/game";

type RequestMessage = {
  id: number;
  board: bigint;
};

type ResponseMessage = {
  id: number;
  move: Direction | null;
};

const resolveWasmUrl = (): string => {
  const loc = self.location;
  let origin = loc?.origin ?? "";

  if (!origin || origin === "null") {
    const href = loc?.href ?? "";
    if (href.startsWith("blob:")) {
      const inner = href.slice(5);
      const match = inner.match(/^(https?:\/\/[^/]+)/);
      if (match) {
        origin = match[1];
      }
    } else {
      const match = href.match(/^(https?:\/\/[^/]+)/);
      if (match) {
        origin = match[1];
      }
    }
  }

  if (origin) {
    return new URL("/ai2048.wasm", origin).href;
  }

  return "/ai2048.wasm";
};

const wasmUrl = resolveWasmUrl();

const modulePromise = createModule({
  locateFile: () => wasmUrl,
});

const readyPromise = modulePromise.then((moduleInstance: any) => {
  moduleInstance._init_tables();
  return moduleInstance;
});

const moveMap: Direction[] = ["up", "down", "left", "right"];

self.onmessage = async (event: MessageEvent<RequestMessage>) => {
  const { id, board } = event.data;

  try {
    const moduleInstance = await readyPromise;
    const moveIndex = moduleInstance._find_best_move(board);
    const move =
      moveIndex >= 0 && moveIndex < moveMap.length
        ? moveMap[moveIndex]
        : null;

    const response: ResponseMessage = { id, move };
    self.postMessage(response);
  } catch (error) {
    const response: ResponseMessage = { id, move: null };
    self.postMessage(response);
  }
};
