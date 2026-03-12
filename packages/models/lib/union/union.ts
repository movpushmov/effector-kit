import type { Model } from "../models";
import { ref, type Ref } from "../ref";

export function union<T extends Model<any, any>>(...args: T[]): void {
  const unionRefs: Ref<any>[] = [];

  for (const arg of args) {
    unionRefs.push(ref(arg));
  }
}
