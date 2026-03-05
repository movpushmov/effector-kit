import type { StoreWritable } from "effector";
import { getContext } from "./context";
import type { Model, BaseInstance } from "../models";
import { createAction } from "effector-action";

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

      const instance: BaseInstance = ctx.current.instance;

      if (!instance["~refs"]) {
        instance["~refs"] = {};
      }

      return instance["~refs"][model["~id"]] ?? [];
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

      if (!ctx.current.instance["~refs"]) {
        ctx.current.instance["~refs"] = {};
      }

      ctx.current.instance["~refs"][model["~id"]] = [
        ...ctx.current.instance["~refs"][model["~id"]],
        value,
      ];
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

      const instance: BaseInstance = ctx.current.instance;

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

      if (!ctx.current.instance["~children"]) {
        ctx.current.instance["~children"] = {};
      }

      ctx.current.instance["~children"][model["~id"]] = value;
    },
  });
}

export function reserve(units: object[]): void {
  for (const unit of units) {
    Object.defineProperty(unit, "~reserved", {
      value: true,
    });
  }
}
