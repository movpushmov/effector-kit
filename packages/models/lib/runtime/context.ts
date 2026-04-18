import type { Model } from "../models";
import type { RuntimeContext } from "./types";

let runtimeContext: RuntimeContext = {};

export function getContext(): RuntimeContext {
  return runtimeContext;
}

export function setContext(ctx: RuntimeContext): void {
  runtimeContext = ctx;
}

export function setTarget(target: Model<any, any>): void {
  if (!runtimeContext.current) {
    throw new Error("Context not found");
  }

  runtimeContext.current.target = target;
}
