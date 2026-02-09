/// <reference lib="webworker" />

import type { Direction } from "@/lib/game";

type RequestMessage = {
  id: number;
  board: bigint;
};

type ResponseMessage = {
  id: number;
  move: Direction | null;
};

// Emscripten Module type
interface EmscriptenModule {
  _init_tables: () => void;
  _find_best_move: (board: bigint) => number;
  _execute_move: (board: bigint, direction: number) => bigint;
}

// Initialize the WASM module at runtime
let moduleInstance: EmscriptenModule | null = null;
let initPromise: Promise<EmscriptenModule> | null = null;

const initializeModule = (): Promise<EmscriptenModule> => {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      const origin = self.location.origin;
      const wasmUrl = `${origin}/ai2048.wasm`;
      const scriptUrl = `${origin}/ai2048.js`;

      console.log("[AI Worker] Loading from:", scriptUrl);

      // Fetch and execute the Emscripten script
      const response = await fetch(scriptUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.statusText}`);
      }

      let scriptText = await response.text();

      // Fix ES module issues:
      // 1. Replace import.meta.url with the actual script URL
      scriptText = scriptText.replace(/import\.meta\.url/g, `"${scriptUrl}"`);

      // 2. Replace import.meta with a safe object
      scriptText = scriptText.replace(/import\.meta/g, `{url:"${scriptUrl}"}`);

      // 3. Remove the ES module export statement and assign to global
      scriptText = scriptText.replace(/export\s+default\s+Module;?/, 'self.WasmModuleFactory = Module;');

      console.log("[AI Worker] Script patched, executing...");

      // Execute the modified script
      eval(scriptText);

      // Get the Module factory function
      const ModuleFactory = (self as any).WasmModuleFactory;
      if (!ModuleFactory || typeof ModuleFactory !== 'function') {
        throw new Error("Module factory not found");
      }

      console.log("[AI Worker] Module factory loaded, initializing WASM...");

      // Initialize the module with WASM location
      const instance = await ModuleFactory({
        locateFile: (path: string) => {
          if (path.endsWith('.wasm')) {
            return wasmUrl;
          }
          return path;
        },
      });

      // Initialize lookup tables
      console.log("[AI Worker] Calling _init_tables...");
      instance._init_tables();
      console.log("[AI Worker] WASM module ready!");

      moduleInstance = instance;
      return instance;
    } catch (error) {
      console.error("[AI Worker] Initialization error:", error);
      if (error instanceof Error) {
        console.error("[AI Worker] Error details:", error.message);
        console.error("[AI Worker] Stack:", error.stack);
      }
      throw error;
    }
  })();

  return initPromise;
};

const moveMap: Direction[] = ["up", "down", "left", "right"];

self.onmessage = async (event: MessageEvent<RequestMessage>) => {
  const { id, board } = event.data;

  try {
    if (!moduleInstance) {
      console.log("[AI Worker] Initializing module for first request...");
      await initializeModule();
    }

    if (!moduleInstance) {
      throw new Error("Module not initialized");
    }

    const moveIndex = moduleInstance._find_best_move(board);
    const move =
      moveIndex >= 0 && moveIndex < moveMap.length
        ? moveMap[moveIndex]
        : null;

    console.log(`[AI Worker] Calculated move: ${move} (index: ${moveIndex})`);

    const response: ResponseMessage = { id, move };
    self.postMessage(response);
  } catch (error) {
    console.error("[AI Worker] Move calculation error:", error);
    const response: ResponseMessage = { id, move: null };
    self.postMessage(response);
  }
};
