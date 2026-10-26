/// <reference types="node" />
import { afterEach } from "vitest";

// The simulation tests are fully synchronous. Vitest only awaits microtasks between tests, so the
// worker never processes incoming RPC messages (macrotasks) during a long file and the main
// process times out with "Timeout calling onTaskUpdate". Yielding one macrotask per test fixes it.
afterEach(() => new Promise<void>((resolve) => setImmediate(resolve)));
