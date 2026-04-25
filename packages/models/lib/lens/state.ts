import type { LensPredicate } from "./types";
import { dedupeInstances } from "../models/aliases";

type BaseSourceGetter = (payload: any) => Record<string, any>;

export interface LensState {
  getSource(payload: any): Record<string, any>;
  addPredicate(predicate: LensPredicate): LensState;
}

export function createLensState(
  getBaseSource: BaseSourceGetter,
  predicates: LensPredicate[] = [],
): LensState {
  return {
    getSource(payload) {
      let instances = getBaseSource(payload) ?? {};

      for (const predicate of predicates) {
        instances = predicate(instances, payload);
      }

      return dedupeInstances(instances);
    },
    addPredicate(predicate) {
      return createLensState(getBaseSource, [...predicates, predicate]);
    },
  };
}
