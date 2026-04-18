import type { Scope } from "effector";
import type { Model } from "../models";
import { getContext, setContext } from "./context";

export function withInstanceContext<T>(
  model: Model<any, any>,
  instance: Record<string, any>,
  fn: () => T,
  scope?: Scope,
): T {
  const previous = getContext();

  setContext({
    current: previous.current
      ? {
          ...previous.current,
          owner: previous.current.owner ?? previous.current,
          model,
          instance,
          scope,
        }
      : {
          model,
          instance,
          scope,
        },
  });

  try {
    return fn();
  } finally {
    setContext(previous);
  }
}
