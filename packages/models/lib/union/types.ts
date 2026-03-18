import type { Model } from "../models";

export type UnionMap = Record<string, Model<any, any>>;

export interface Union<Map extends UnionMap> {
  "~kind": "union";
  models: Map;
}
