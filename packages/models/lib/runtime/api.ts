import type { StoreWritable } from "effector";
import { getContext } from "./context";
import type { Model, BaseInstance } from "../models";
import { createAction } from "effector-action";

let entityIdCounter = 0;
const reservedStores = new Set<StoreWritable<any>>();

export function getEntityId(): string {
  entityIdCounter += 1;
  return `model-${entityIdCounter}`;
}

export function modifyStore($store: StoreWritable<any>, key: string): void {
  Object.defineProperty(($store as any).graphite.meta.stateRef, "current", {
    get() {
      const ctx = getContext();

      if (!ctx.current) {
        return null;
      }

      return ctx.current.instance[key];
    },
  });

  createAction({
    clock: $store,
    target: {},
    fn: (_, value) => {
      const ctx = getContext();

      if (!ctx.current) {
        return;
      }

      if (ctx.current.scope) {
        // @ts-expect-error
        ctx.current.scope.reg[$store.graphite.meta.rootStateRefId].current =
          value;
      }

      ctx.current.instance[key] = value;
    },
  });
}

export function modifyRefsStore(
  $store: StoreWritable<any>,
  refId: string,
): void {
  reserve([$store]);
  Object.defineProperty(($store as any).graphite.meta.stateRef, "current", {
    get() {
      const ctx = getContext();

      if (!ctx.current) {
        return null;
      }

      const instance: BaseInstance =
        ctx.current.owner?.instance ?? ctx.current.instance;

      if (!instance["~refs"]) {
        instance["~refs"] = {};
      }
      return instance["~refs"][refId] ?? [];
    },
  });

  createAction({
    clock: $store,
    target: {},
    fn: (_, value) => {
      const ctx = getContext();

      if (!ctx.current) {
        return;
      }

      if (ctx.current.scope) {
        // @ts-expect-error
        ctx.current.scope.reg[$store.graphite.meta.rootStateRefId].current =
          value;
      }

      const instance: BaseInstance =
        ctx.current.owner?.instance ?? ctx.current.instance;

      if (!instance["~refs"]) {
        instance["~refs"] = {};
      }
      instance["~refs"][refId] = value;
    },
  });
}

export function modifyChildStore(
  model: Model<any, any>,
  $store: StoreWritable<any>,
): void {
  reserve([$store]);
  Object.defineProperty(($store as any).graphite.meta.stateRef, "current", {
    get() {
      const ctx = getContext();

      if (!ctx.current) {
        return null;
      }

      const instance: BaseInstance =
        ctx.current.owner?.instance ?? ctx.current.instance;

      if (!instance["~children"]) {
        instance["~children"] = {};
      }

      return instance["~children"][model["~id"]] ?? {};
    },
  });

  createAction({
    clock: $store,
    target: {},
    fn: (_, value) => {
      const ctx = getContext();

      if (!ctx.current) {
        return;
      }

      if (ctx.current.scope) {
        // @ts-expect-error
        ctx.current.scope.reg[$store.graphite.meta.rootStateRefId].current =
          value;
      }

      const instance: BaseInstance =
        ctx.current.owner?.instance ?? ctx.current.instance;

      if (!instance["~children"]) {
        instance["~children"] = {};
      }

      instance["~children"][model["~id"]] = value;
    },
  });
}

export function reserve(units: object[]): void {
  for (const unit of units) {
    Object.defineProperty(unit, "~reserved", {
      value: true,
    });

    if (
      typeof unit === "object" &&
      unit !== null &&
      "graphite" in unit &&
      (unit as any).graphite?.meta?.stateRef
    ) {
      reservedStores.add(unit as unknown as StoreWritable<any>);
    }
  }
}

export function syncReservedStores(
  scopeReg: Record<string, { current: any }>,
): void {
  for (const $store of reservedStores) {
    const rootId = ($store as any).graphite.meta.rootStateRefId;
    const stateRef = ($store as any).graphite.meta.stateRef;
    const currentValue = stateRef.current;

    if (!scopeReg[rootId]) {
      scopeReg[rootId] = Object.assign({}, stateRef, {
        current: currentValue,
      });
      continue;
    }

    scopeReg[rootId].current = currentValue;
  }
}
