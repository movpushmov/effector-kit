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

function syncScopeStoreValue(
  $store: StoreWritable<any>,
  value: unknown,
  scope?: { reg?: Record<string, { current: unknown }> },
): void {
  if (!scope?.reg) {
    return;
  }

  const rootId = ($store as any).graphite.meta.rootStateRefId;
  const stateRef = ($store as any).graphite.meta.stateRef;

  if (!scope.reg[rootId]) {
    scope.reg[rootId] = Object.assign({}, stateRef, {
      current: value,
    });
    return;
  }

  const scopeRef = scope.reg[rootId];

  if (scopeRef) {
    scopeRef.current = value;
  }
}

export function modifyStore($store: StoreWritable<any>, key: string): void {
  const stateRef = ($store as any).graphite.meta.stateRef;
  let fallbackValue = stateRef.current;
  Object.defineProperty(stateRef, "~fallbackCurrent", {
    value: fallbackValue,
    configurable: true,
    writable: true,
  });

  Object.defineProperty(stateRef, "current", {
    get() {
      const ctx = getContext();

      if (!ctx.current) {
        return fallbackValue;
      }

      return ctx.current.instance[key];
    },
    set(value) {
      fallbackValue = value;
      stateRef["~fallbackCurrent"] = value;

      const ctx = getContext();

      if (!ctx.current) {
        return;
      }

      ctx.current.instance[key] = value;
      syncScopeStoreValue($store, value, ctx.current.scope as any);
    },
  });

  createAction({
    clock: $store,
    target: {},
    fn: (_: unknown, value: unknown) => {
      const ctx = getContext();

      if (!ctx.current) {
        return;
      }

      stateRef.current = value;
    },
  });
}

export function modifyRefsStore(
  $store: StoreWritable<any>,
  refId: string,
  ownerModelId?: string,
): void {
  reserve([$store]);
  const stateRef = ($store as any).graphite.meta.stateRef;
  let fallbackValue = stateRef.current;
  Object.defineProperty(stateRef, "~fallbackCurrent", {
    value: fallbackValue,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(stateRef, "~ownerModelId", {
    value: ownerModelId,
    configurable: true,
    writable: true,
  });

  Object.defineProperty(stateRef, "current", {
    get() {
      const ctx = getContext();

      if (!ctx.current) {
        return fallbackValue;
      }

      const instance: BaseInstance =
        ctx.current.owner?.instance ?? ctx.current.instance;

      if (!instance["~refs"]) {
        instance["~refs"] = {};
      }
      return instance["~refs"][refId] ?? [];
    },
    set(value) {
      fallbackValue = value;
      stateRef["~fallbackCurrent"] = value;

      const ctx = getContext();

      if (!ctx.current) {
        return;
      }

      const instance: BaseInstance =
        ctx.current.owner?.instance ?? ctx.current.instance;

      if (!instance["~refs"]) {
        instance["~refs"] = {};
      }

      instance["~refs"][refId] = value;
      syncScopeStoreValue($store, value, ctx.current.scope as any);
    },
  });

  createAction({
    clock: $store,
    target: {},
    fn: (_: unknown, value: unknown) => {
      const ctx = getContext();

      if (!ctx.current) {
        return;
      }

      stateRef.current = value;
    },
  });
}

export function modifyChildStore(
  model: Model<any, any>,
  $store: StoreWritable<any>,
  ownerModelId?: string,
): void {
  reserve([$store]);
  const stateRef = ($store as any).graphite.meta.stateRef;
  let fallbackValue = stateRef.current;
  Object.defineProperty(stateRef, "~fallbackCurrent", {
    value: fallbackValue,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(stateRef, "~ownerModelId", {
    value: ownerModelId,
    configurable: true,
    writable: true,
  });

  Object.defineProperty(stateRef, "current", {
    get() {
      const ctx = getContext();

      if (!ctx.current) {
        return fallbackValue;
      }

      const instance: BaseInstance =
        ctx.current.owner?.instance ?? ctx.current.instance;

      if (!instance["~children"]) {
        instance["~children"] = {};
      }

      return instance["~children"][model["~id"]] ?? {};
    },
    set(value) {
      fallbackValue = value;
      stateRef["~fallbackCurrent"] = value;

      const ctx = getContext();

      if (!ctx.current) {
        return;
      }

      const instance: BaseInstance =
        ctx.current.owner?.instance ?? ctx.current.instance;

      if (!instance["~children"]) {
        instance["~children"] = {};
      }

      instance["~children"][model["~id"]] = value;
      syncScopeStoreValue($store, value, ctx.current.scope as any);
    },
  });

  createAction({
    clock: $store,
    target: {},
    fn: (_: unknown, value: unknown) => {
      const ctx = getContext();

      if (!ctx.current) {
        return;
      }

      stateRef.current = value;
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
    const ctx = getContext();
    const ownerModelId = stateRef["~ownerModelId"];
    const currentValue =
      ctx.current && ownerModelId && ctx.current.model["~id"] === ownerModelId
        ? stateRef.current
        : stateRef["~fallbackCurrent"] !== undefined
          ? stateRef["~fallbackCurrent"]
          : stateRef.current;

    if (!scopeReg[rootId]) {
      scopeReg[rootId] = Object.assign({}, stateRef, {
        current: currentValue,
      });
      continue;
    }

    const scopeRef = scopeReg[rootId];

    if (scopeRef) {
      scopeRef.current = currentValue;
    }
  }
}
