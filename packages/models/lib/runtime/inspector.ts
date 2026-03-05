import {
  createNode,
  is,
  step,
  withRegion,
  type Node,
  type Stack,
} from "effector";
import { getContext, setContext } from "./context";
import type { RuntimeContext } from "./types";

type Fn<T> = () => T;

function getRuntimeContext(
  stack: Stack & { "~modelsRuntimeCtx"?: RuntimeContext },
): RuntimeContext {
  // Always read from the global context set by setContext() immediately before
  // each launch(). Do NOT use the cached stack value: when an effect body loops
  // over multiple instances and calls setContext()/launch() for each, all
  // launches may share the same stack frame (batched by Effector's scope
  // execution), so a cached value from the first iteration would be reused for
  // all subsequent ones — giving every instance the same (wrong) context.
  const currentContext = getContext();
  stack["~modelsRuntimeCtx"] = currentContext;
  return currentContext;
}

function primeStoreScopes(
  context: RuntimeContext,
  scopeReg: Record<string, { current: any }>,
): void {
  const { model, instance } = context.current!;
  const api = model["~api"] as Record<string, any>;

  for (const key in api) {
    const apiElement = api[key];
    if (!is.store(apiElement)) continue;

    const rootId = (apiElement as any).graphite.meta.rootStateRefId;
    const instanceValue = instance[key] ?? null;

    if (!scopeReg[rootId]) {
      // Effector lazily creates scope.reg entries using the store's default
      // value (stateRef.initial), not our getter. Create the entry now with
      // the correct per-instance value so that any `source: store` reads
      // within in-scope samples see the instance's actual value.
      const stateRef = (apiElement as any).graphite.meta.stateRef;
      scopeReg[rootId] = Object.assign({}, stateRef, {
        current: instanceValue,
      });
    } else {
      scopeReg[rootId].current = instanceValue;
    }
  }
}

function modifyRegion(node: Node) {
  for (const link of node.family.links) {
    if ((link as any)["~reserved"]) {
      continue;
    }

    link.seq.unshift(
      step.compute({
        fn: (data, scope, stack) => {
          const context = getRuntimeContext(stack);

          if (!context.current) {
            throw new Error(
              "Panic: Cannot call model unit without instance runtime context",
            );
          }

          context.current.scope = stack.scope;
          setContext(context);

          // Prime scope.reg for all model API stores with the current
          // instance's values. This ensures that `source:` reads in
          // in-scope samples see per-instance values rather than the
          // null that fork() initialised them to (the getter returns
          // null outside context, so fork always gets null).
          if (stack.scope) {
            const scopeReg = (stack.scope as any).reg as Record<
              string,
              { current: any }
            >;
            primeStoreScopes(context, scopeReg);
          }

          return data;
        },
        safe: true,
      }),
    );
  }
}

let region: Node | null = null;

export function modifyDeclarations<T>(fn: Fn<T>): { result: T; region: Node } {
  if (region) {
    return { result: fn(), region };
  }

  region = createNode({ regional: true });
  const result = { result: withRegion(region, fn), region };

  modifyRegion(region);

  region = null;

  return result;
}
