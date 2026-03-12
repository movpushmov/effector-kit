import type { Lens } from "../lens";
import type { Model } from "../models";

export interface Ref<T extends Model<any, any>> {
  "~kind": "ref";
  lens: Lens<T>;
}
