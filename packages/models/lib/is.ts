import type { Contract } from "./contracts";
import type { Model } from "./models";
import type { Ref } from "./ref";
import type { Union, UnionMap } from "./union";

function check(value: unknown, kind: string) {
  return (
    typeof value === "object" &&
    value !== null &&
    "~kind" in value &&
    value["~kind"] === kind
  );
}

export const is = {
  contract(value: unknown): value is Contract<any, any> {
    return check(value, "contract");
  },

  model(value: unknown): value is Model<any, any> {
    return check(value, "model");
  },

  union(value: unknown): value is Union<UnionMap> {
    return check(value, "union");
  },

  ref(value: unknown): value is Ref<any> {
    return check(value, "ref");
  },
};
