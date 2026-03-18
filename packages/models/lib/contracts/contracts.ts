import type { HKT } from "../hkt";
import type {
  Contract,
  ExtractGenericsFromShape,
  Shape,
  TypeElementHKT,
} from "./types";

export function contract<T extends Shape>(
  shape: T,
): <K extends ExtractGenericsFromShape<T>>() => HKT.WithParameter<
  Contract<T, K>,
  TypeElementHKT,
  K
> {
  return () => ({
    "~kind": "contract",
    // @ts-expect-error
    shape,
  });
}
