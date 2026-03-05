import type { Contract } from "../contracts";
import type { Model, ModelApi } from "./types";

export function isModel<T extends Contract<any>, U extends ModelApi>(
  value: unknown,
): value is Model<T, U> {
  return (
    typeof value === "object" &&
    value !== null &&
    "~type" in value &&
    value["~type"] === "model"
  );
}
