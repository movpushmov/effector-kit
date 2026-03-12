import type { Lens } from "../lens";
import type { Model } from "../models";

export interface Union<Elements extends Model<any, any>[]> {
  "~kind": "union";
  models: Elements;
}
