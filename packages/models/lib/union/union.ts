import type { Union, UnionMap } from "./types";

export function union<T extends UnionMap>(map: T): Union<T> {
  return { "~kind": "union", models: map };
}
