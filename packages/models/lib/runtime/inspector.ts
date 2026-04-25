import {
  createNode,
  is,
  launch,
  step,
  withRegion,
  type Node,
  type Stack,
} from 'effector';
import { is as runtimeIs } from '../is';
import type { Model } from '../models';
import { getContext, setContext } from './context';
import { syncReservedStores } from './api';
import type { RuntimeContext } from './types';

type Fn<T> = () => T;
type ParamsContextBucket = {
  object: WeakMap<object, RuntimeContext[]>;
  primitive: Map<unknown, RuntimeContext[]>;
};
type StoreDescriptor = {
  key?: string;
  rootId: string;
  field?: string;
  store: {
    targetable?: boolean;
    getState: () => unknown;
    graphite: {
      meta: {
        stateRef: { current: unknown };
      };
    };
  };
};

const effectCallContexts = new Map<string, ParamsContextBucket>();
const effectResultContexts = new Map<string, ParamsContextBucket>();
const modelStoreDescriptors = new WeakMap<object, StoreDescriptor[]>();
const nodeEffectOwnerIds = new WeakMap<Node, string[]>();
const broadcastPatchedNodes = new WeakSet<Node>();

function cloneRuntimeContext(context: RuntimeContext): RuntimeContext {
  if (!context.current) {
    return {};
  }

  return {
    current: {
      ...context.current,
    },
  };
}

function getParamsContextBucket(effectId: string): ParamsContextBucket {
  const existing = effectCallContexts.get(effectId);

  if (existing) {
    return existing;
  }

  const next = {
    object: new WeakMap<object, RuntimeContext[]>(),
    primitive: new Map<unknown, RuntimeContext[]>(),
  };

  effectCallContexts.set(effectId, next);

  return next;
}

function pushEffectContext(
  effectId: string,
  params: unknown,
  context: RuntimeContext,
): void {
  const snapshot = cloneRuntimeContext(context);
  const bucket = getParamsContextBucket(effectId);

  if (typeof params === 'object' && params !== null) {
    const queue = bucket.object.get(params) ?? [];

    queue.push(snapshot);
    bucket.object.set(params, queue);
    return;
  }

  const queue = bucket.primitive.get(params) ?? [];

  queue.push(snapshot);
  bucket.primitive.set(params, queue);
}

function shiftEffectContext(
  effectId: string,
  params: unknown,
): RuntimeContext | undefined {
  const bucket = effectCallContexts.get(effectId);

  if (!bucket) {
    return undefined;
  }

  const queue =
    typeof params === 'object' && params !== null
      ? bucket.object.get(params)
      : bucket.primitive.get(params);

  if (!queue?.length) {
    return undefined;
  }

  const context = queue.shift();

  if (!queue.length && (typeof params !== 'object' || params === null)) {
    bucket.primitive.delete(params);
  }

  return context;
}

function pushEffectResultContext(
  effectId: string,
  value: unknown,
  context: RuntimeContext,
): void {
  const snapshot = cloneRuntimeContext(context);
  const bucket = effectResultContexts.get(effectId) ?? {
    object: new WeakMap<object, RuntimeContext[]>(),
    primitive: new Map<unknown, RuntimeContext[]>(),
  };

  effectResultContexts.set(effectId, bucket);

  if (typeof value === 'object' && value !== null) {
    const queue = bucket.object.get(value) ?? [];

    queue.push(snapshot);
    bucket.object.set(value, queue);
    return;
  }

  const queue = bucket.primitive.get(value) ?? [];

  queue.push(snapshot);
  bucket.primitive.set(value, queue);
}

function shiftEffectResultContext(
  effectId: string,
  value: unknown,
): RuntimeContext | undefined {
  const bucket = effectResultContexts.get(effectId);

  if (!bucket) {
    return undefined;
  }

  const queue =
    typeof value === 'object' && value !== null
      ? bucket.object.get(value)
      : bucket.primitive.get(value);

  if (!queue?.length) {
    return undefined;
  }

  const context = queue.shift();

  if (!queue.length && (typeof value !== 'object' || value === null)) {
    bucket.primitive.delete(value);
  }

  return context;
}

function collectEffectOwnerIds(node: Node): string[] {
  const cached = nodeEffectOwnerIds.get(node);

  if (cached) {
    return cached;
  }

  const visited = new Set<string>();
  const queue = [...node.family.owners];
  const effectIds: string[] = [];

  while (queue.length > 0) {
    const currentNode = queue.shift();

    if (!currentNode || visited.has(currentNode.id)) {
      continue;
    }

    visited.add(currentNode.id);

    if (currentNode.meta?.op === 'effect') {
      effectIds.push(currentNode.id);
      continue;
    }

    queue.push(...currentNode.family.owners);
  }

  nodeEffectOwnerIds.set(node, effectIds);

  return effectIds;
}

function getEffectContextFromNode(
  node: Node,
  value: unknown,
): RuntimeContext | undefined {
  for (const effectId of collectEffectOwnerIds(node)) {
    const context = shiftEffectResultContext(effectId, value);

    if (context?.current) {
      return context;
    }
  }

  return undefined;
}

function getRuntimeContext(
  stack: Stack & { '~modelsRuntimeCtx'?: RuntimeContext },
): RuntimeContext {
  const currentContext = getContext();
  const stackMeta = stack.meta as
    | (Record<string, unknown> & { '~modelsRuntimeCtx'?: RuntimeContext })
    | undefined;
  const stackContext =
    stack['~modelsRuntimeCtx'] ?? stackMeta?.['~modelsRuntimeCtx'];

  if (currentContext.current) {
    // Prefer the live global context for direct launches. This keeps per-call
    // instance routing correct even when multiple launches are batched.
    stack['~modelsRuntimeCtx'] = currentContext;
    if (stackMeta) {
      stackMeta['~modelsRuntimeCtx'] = currentContext;
    }
    return currentContext;
  }

  if (stackContext?.current) {
    return stackContext;
  }

  const ownerContext = getEffectContextFromNode(stack.node, stack.value);

  if (ownerContext?.current) {
    return ownerContext;
  }

  // Fall back to the stack-attached context for async continuations such as
  // effect.doneData/finally, where the original launch context must survive
  // beyond the synchronous launch call.
  return currentContext;
}

function isPlainModelApiObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !is.store(value) &&
    !runtimeIs.model(value) &&
    !runtimeIs.ref(value) &&
    !runtimeIs.union(value)
  );
}

function collectStoreDescriptors(
  api: Record<string, unknown>,
): StoreDescriptor[] {
  const cached = modelStoreDescriptors.get(api);

  if (cached) {
    return cached;
  }

  const seenStores = new Set<string>();
  const descriptors: StoreDescriptor[] = [];

  function visit(value: unknown, key?: string): void {
    if (is.store(value)) {
      const apiElement = value as any;
      const rootId = apiElement.graphite.meta.rootStateRefId as string;
      const field =
        typeof apiElement['~field'] === 'string'
          ? (apiElement['~field'] as string)
          : undefined;

      if (seenStores.has(rootId)) {
        return;
      }

      seenStores.add(rootId);
      const descriptor: StoreDescriptor = {
        rootId,
        store: apiElement,
      };

      if (key !== undefined) {
        descriptor.key = key;
      }

      if (field !== undefined) {
        descriptor.field = field;
      }

      descriptors.push(descriptor);
      return;
    }

    if (!isPlainModelApiObject(value)) {
      return;
    }

    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      visit(nestedValue, nestedKey);
    }
  }

  visit(api);
  modelStoreDescriptors.set(api, descriptors);

  return descriptors;
}

function primeStoreScopes(
  context: RuntimeContext,
  scopeReg: Record<string, { current: any }>,
): void {
  const { model, instance } = context.current!;
  const descriptors = collectStoreDescriptors(
    model['~api'] as Record<string, unknown>,
  );

  for (const { key, rootId, field, store } of descriptors) {
    if (store.targetable !== true) {
      continue;
    }

    let instanceValue: unknown;

    if (key && key in instance) {
      instanceValue = instance[key];
    } else if (typeof field === 'string' && field in instance) {
      instanceValue = instance[field];
    } else {
      try {
        instanceValue = store.getState();
      } catch {
        instanceValue = null;
      }
    }

    if (!scopeReg[rootId]) {
      // Effector lazily creates scope.reg entries using the store's default
      // value (stateRef.initial), not our getter. Create the entry now with
      // the correct per-instance value so that any `source: store` reads
      // within in-scope samples see the instance's actual value.
      const stateRef = store.graphite.meta.stateRef;
      scopeReg[rootId] = Object.assign({}, stateRef, {
        current: instanceValue,
      });
    } else {
      const scopedRef = scopeReg[rootId];

      if (scopedRef) {
        scopedRef.current = instanceValue;
      }
    }
  }
}

function collectRegionNodes(root: Node): Node[] {
  const visited = new Set<Node>();
  const nodes: Node[] = [];

  function visit(node: Node): void {
    if (visited.has(node)) {
      return;
    }

    visited.add(node);
    nodes.push(node);

    for (const link of node.family.links) {
      visit(link);
    }
  }

  visit(root);

  return nodes;
}

function modifyRegion(node: Node) {
  const patchedNodes = new WeakSet<Node>();
  const patchedEffects = new Set<string>();

  function applyContextToStack(
    context: RuntimeContext,
    stack: Stack & { '~modelsRuntimeCtx'?: RuntimeContext },
  ): void {
    const stackMeta = (stack.meta ??= {}) as Record<string, unknown>;

    stackMeta['~modelsRuntimeCtx'] = context;
    stack['~modelsRuntimeCtx'] = context;
    context.current!.scope = stack.scope;
    setContext(context);

    if (stack.scope) {
      // Model state is routed through the active scope plus instance context.
      // If an inherited Effector page leaks into this stack, `source: store`
      // reads can observe another retained instance via page.reg before they
      // ever touch scope.reg. Drop the page once we enter the model runtime.
      if (
        !(stack.page as { '~modelsScopedPage'?: boolean } | null)?.[
          '~modelsScopedPage'
        ]
      ) {
        stack.page = null;
      }

      const isSamePrimedContext =
        stackMeta['~modelsPrimedModelId'] === context.current!.model['~id'] &&
        stackMeta['~modelsPrimedInstance'] === context.current!.instance;

      if (isSamePrimedContext) {
        return;
      }

      const scopeReg = (stack.scope as any).reg as Record<
        string,
        { current: any }
      >;
      primeStoreScopes(context, scopeReg);
      syncReservedStores(scopeReg);
      stackMeta['~modelsPrimedModelId'] = context.current!.model['~id'];
      stackMeta['~modelsPrimedInstance'] = context.current!.instance;
    }
  }

  function patchEffectBridge(effectNode: Node): void {
    if (patchedEffects.has(effectNode.id)) {
      return;
    }

    patchedEffects.add(effectNode.id);

    effectNode.seq.unshift(
      step.compute({
        fn: (
          data: unknown,
          _scope: Record<string, unknown>,
          stack: Stack & { '~modelsRuntimeCtx'?: RuntimeContext },
        ): unknown => {
          const context = getRuntimeContext(stack);

          if (context.current) {
            pushEffectContext(effectNode.id, stack.value, context);
          }

          return data;
        },
        safe: true,
      }),
    );

    for (const link of effectNode.family.links) {
      if (link.meta?.name === 'done' || link.meta?.name === 'fail') {
        link.seq.unshift(
          step.compute({
            fn: (
              data: unknown,
              _scope: Record<string, unknown>,
              stack: Stack & { '~modelsRuntimeCtx'?: RuntimeContext },
            ): unknown => {
              const payload = stack.value as { params?: unknown };
              const context = shiftEffectContext(
                effectNode.id,
                payload?.params,
              );

              if (context?.current) {
                if ('result' in (payload ?? {})) {
                  pushEffectResultContext(
                    effectNode.id,
                    (payload as { result?: unknown }).result,
                    context,
                  );
                }

                if ('error' in (payload ?? {})) {
                  pushEffectResultContext(
                    effectNode.id,
                    (payload as { error?: unknown }).error,
                    context,
                  );
                }

                pushEffectResultContext(effectNode.id, payload, context);
                applyContextToStack(context, stack);
              }

              return data;
            },
            safe: true,
          }),
        );
      }

      if (
        link.meta?.name === 'doneData' ||
        link.meta?.name === 'failData' ||
        link.meta?.name === 'finally'
      ) {
        link.seq.unshift(
          step.compute({
            fn: (
              data: unknown,
              _scope: Record<string, unknown>,
              stack: Stack & { '~modelsRuntimeCtx'?: RuntimeContext },
            ): unknown => {
              const context = shiftEffectResultContext(
                effectNode.id,
                stack.value,
              );

              if (context?.current) {
                applyContextToStack(context, stack);
              }

              return data;
            },
            safe: true,
          }),
        );
      }
    }
  }

  function prependRuntimeStep(targetNode: Node): void {
    if (patchedNodes.has(targetNode)) {
      return;
    }

    patchedNodes.add(targetNode);
    targetNode.seq.unshift(
      step.compute({
        fn: (
          data: unknown,
          _scope: Record<string, unknown>,
          stack: Stack & { '~modelsRuntimeCtx'?: RuntimeContext },
        ): unknown => {
          const context = getRuntimeContext(stack);

          if (!context.current) {
            return data;
          }

          applyContextToStack(context, stack);

          return data;
        },
        safe: true,
      }),
    );
  }

  for (const link of collectRegionNodes(node).slice(1)) {
    if ((link as any)['~reserved']) {
      continue;
    }

    prependRuntimeStep(link);

    if (link.meta?.op === 'effect') {
      patchEffectBridge(link);
    }

    for (const owner of link.family.owners) {
      if (owner.meta?.op === 'effect') {
        patchEffectBridge(owner);
      }
    }
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

export function bindRegionModel(region: Node, model: Model<any, any>): void {
  const regionTree = collectRegionNodes(region);
  const regionNodes = new Set<Node>(regionTree);

  for (const link of regionTree.slice(1)) {
    if ((link as any)['~reserved'] || broadcastPatchedNodes.has(link)) {
      continue;
    }

    const hasExternalOwner = link.family.owners.some((owner: Node) => {
      return !regionNodes.has(owner);
    });

    if (!hasExternalOwner) {
      continue;
    }

    broadcastPatchedNodes.add(link);
    link.seq.unshift(
      step.filter({
        fn: (
          _data: unknown,
          _scope: Record<string, unknown>,
          stack: Stack & { '~modelsRuntimeCtx'?: RuntimeContext },
        ): boolean => {
          const context = getRuntimeContext(stack);

          if (context.current) {
            return true;
          }

          const instances = (
            stack.scope
              ? stack.scope.getState(model.$instances as any)
              : model.$instances.getState()
          ) as Record<string, unknown>;

          if (Object.keys(instances).length === 0) {
            return false;
          }

          const previous = getContext();

          for (const instance of Object.values(instances)) {
            setContext({
              current: {
                model,
                instance,
                scope: stack.scope,
              },
            });

            if (stack.scope) {
              launch({
                target: link,
                params: stack.value,
                scope: stack.scope,
                page: null as any,
              } as any);
            } else {
              launch({
                target: link,
                params: stack.value,
                page: null as any,
              } as any);
            }
          }

          setContext(previous);

          return false;
        },
      }),
    );
  }
}
