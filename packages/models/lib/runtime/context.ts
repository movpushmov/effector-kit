import type { RuntimeContext } from "./types";

let runtimeContext: RuntimeContext = {};

export function getContext(): RuntimeContext {
  return runtimeContext;
}

export function setContext(ctx: RuntimeContext): void {
  runtimeContext = ctx;
}
