import type { Contract, ExtractGenericsFromShape, Shape } from "./types";

export function contract<T extends Shape>(
  shape: T,
): <K extends ExtractGenericsFromShape<T>>() => Contract<T, K> & {
  "~generic"?: K;
} {
  return () => ({
    "~type": "contract",
    // @ts-expect-error
    shape,
  });
}
