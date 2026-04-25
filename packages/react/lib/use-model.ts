import type { Lens, Model, SingleLens } from "@effector-kit/models";
import { useEffect, useLayoutEffect, useReducer, useRef } from "react";
import { createWatch, type Scope } from "effector";
import { useProvidedScope } from "effector-react";
import {
  collectCreatedModelProxyUpdates,
  collectGraphUpdates,
  createHandlePreviewInstance,
  createReactModelHandle,
  getCreatedModelHandle,
  isCreatedModel,
  isLens,
  isSingleLens,
  isReactModelHandle,
  launchManagedModel,
  launchUnmountManagedModel,
  resolveLensEntity,
  resolveHandleEntity,
  resolveHandleInstance,
  resolveHandlePreviewEntity,
  resolveLensEntities,
  syncManagedModelData,
} from "./runtime";
import type {
  CreatedModel,
  ReactModelEntity,
  ReactModelHandle,
  UseModelOptions,
} from "./types";

type PreviewInstance = Record<string, unknown>;

function arePreviewInstancesEqual(
  left: PreviewInstance | null,
  right: PreviewInstance | null,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key) => Object.is(left[key], right[key]));
}

function wrapPreviewEntity<T>(
  value: T,
  onHandlerCalled: () => void,
  seen = new WeakMap<object, unknown>(),
): T {
  if (typeof value === "function") {
    return ((...args: unknown[]) => {
      const result = (value as (...args: unknown[]) => unknown)(...args);
      onHandlerCalled();
      return result;
    }) as T;
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  const cached = seen.get(value);

  if (cached) {
    return cached as T;
  }

  if (Array.isArray(value)) {
    const next: unknown[] = [];
    seen.set(value, next);

    for (const item of value) {
      next.push(wrapPreviewEntity(item, onHandlerCalled, seen));
    }

    return next as T;
  }

  const next: Record<string, unknown> = {};
  seen.set(value, next);

  for (const [key, item] of Object.entries(value)) {
    next[key] = wrapPreviewEntity(item, onHandlerCalled, seen);
  }

  return next as T;
}

function scheduleMicrotask(callback: () => void): void {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(callback);
    return;
  }

  Promise.resolve().then(callback);
}

function subscribeToGraph(
  model: Model<any, any>,
  onChange: () => void,
  scope?: Scope,
) {
  const units = collectGraphUpdates(model);
  const createdModelProxyUpdates = collectCreatedModelProxyUpdates(model);

  if (scope) {
    const unsubscribeGraph = createWatch({
      unit: units,
      fn: onChange,
      scope,
    });

    if (createdModelProxyUpdates.length === 0) {
      return unsubscribeGraph;
    }

    const unsubscribeCreated = createWatch({
      unit: createdModelProxyUpdates,
      fn: onChange,
    });

    return () => {
      unsubscribeCreated();
      unsubscribeGraph();
    };
  }

  const unsubscribeGraph = createWatch({
    unit: units,
    fn: onChange,
  });

  if (createdModelProxyUpdates.length === 0) {
    return unsubscribeGraph;
  }

  const unsubscribeCreated = createWatch({
    unit: createdModelProxyUpdates,
    fn: onChange,
  });

  return () => {
    unsubscribeCreated();
    unsubscribeGraph();
  };
}

function useCommittedHandle<T extends Model<any, any>>({
  handle,
  mounted,
  retain,
  forceRerender,
  requestRerender,
  scope,
}: {
  handle: ReactModelHandle<T>;
  mounted: Record<string, unknown>;
  retain: boolean;
  requestRerender: () => void;
  forceRerender: () => void;
  scope: Scope | undefined;
}): ReactModelEntity<T> {
  const mountedRef = useRef(false);
  const suppressGraphUpdatesRef = useRef(false);
  const previewInstanceRef = useRef<PreviewInstance | null>(null);
  const previewBaselineRef = useRef<PreviewInstance | null>(null);
  const stalePreviewInstanceRef = useRef<PreviewInstance | null>(null);
  const previewChangedRef = useRef(false);
  const previousHandleRef = useRef<{
    id: string;
    model: Model<any, any>;
    scope: Scope | undefined;
  } | null>(null);
  const activeScope = handle.scope ?? scope;
  const previousHandle = previousHandleRef.current;

  if (
    !previousHandle ||
    previousHandle.id !== handle.id ||
    previousHandle.model !== handle.model ||
    previousHandle.scope !== activeScope
  ) {
    previousHandleRef.current = {
      id: handle.id,
      model: handle.model,
      scope: activeScope,
    };
    mountedRef.current = false;
    previewInstanceRef.current = null;
    previewBaselineRef.current = null;
    stalePreviewInstanceRef.current = null;
    previewChangedRef.current = false;
  }

  const createPreviewEntity = (previewInstance: PreviewInstance) => {
    const previewEntity = resolveHandlePreviewEntity(
      handle,
      activeScope,
      previewInstance,
    );

    return wrapPreviewEntity(previewEntity, () => {
      previewChangedRef.current = true;

      if (mountedRef.current) {
        syncManagedModelData(
          { ...handle, scope: activeScope },
          previewInstance,
        );
      }
    });
  };

  const entity = (() => {
    if (stalePreviewInstanceRef.current) {
      return createPreviewEntity(stalePreviewInstanceRef.current);
    }

    const resolvedEntity = resolveHandleEntity(handle, activeScope);

    if (resolvedEntity) {
      return resolvedEntity;
    }

    if (!previewInstanceRef.current) {
      previewInstanceRef.current = createHandlePreviewInstance(
        handle,
        activeScope,
      );
      previewBaselineRef.current = { ...previewInstanceRef.current };
      previewChangedRef.current = false;
    }

    return createPreviewEntity(previewInstanceRef.current);
  })();

  useLayoutEffect(() => {
    const scopedHandle = { ...handle, scope: activeScope };
    const hasPreviewChanges =
      previewChangedRef.current ||
      !arePreviewInstancesEqual(
        previewInstanceRef.current,
        previewBaselineRef.current,
      );
    const subscribe = () =>
      subscribeToGraph(
        handle.model,
        () => {
          if (suppressGraphUpdatesRef.current) {
            return;
          }

          if (stalePreviewInstanceRef.current && previewInstanceRef.current) {
            const instance = resolveHandleInstance(scopedHandle, activeScope);

            if (
              instance &&
              arePreviewInstancesEqual(instance, previewInstanceRef.current)
            ) {
              return;
            }
          }

          stalePreviewInstanceRef.current = null;
          requestRerender();
        },
        activeScope,
      );

    suppressGraphUpdatesRef.current = true;

    let unsubscribe = () => {};

    if (!hasPreviewChanges) {
      unsubscribe = subscribe();
    } else if (previewBaselineRef.current) {
      stalePreviewInstanceRef.current = previewBaselineRef.current;
    }

    launchManagedModel(
      scopedHandle,
      mounted,
      previewInstanceRef.current ?? undefined,
    );
    if (hasPreviewChanges) {
      unsubscribe = subscribe();
    }

    const shouldForceRerender = !hasPreviewChanges;

    mountedRef.current = true;
    if (shouldForceRerender) {
      previewInstanceRef.current = null;
      previewBaselineRef.current = null;
    }

    suppressGraphUpdatesRef.current = false;
    if (shouldForceRerender) {
      forceRerender();
    }

    return () => {
      unsubscribe();

      if (!retain) {
        launchUnmountManagedModel(scopedHandle);
      }

      mountedRef.current = false;
      suppressGraphUpdatesRef.current = false;
      previewInstanceRef.current = null;
      previewBaselineRef.current = null;
      stalePreviewInstanceRef.current = null;
      previewChangedRef.current = false;
    };
  }, [activeScope, handle, retain]);

  return entity;
}

export function useModel<T extends Model<any, any>>(
  model: T,
  options?: UseModelOptions<T>,
): ReactModelEntity<T>;
export function useModel<T extends Model<any, any>>(
  model: T,
  lens: SingleLens<T>,
  options?: UseModelOptions<T>,
): ReactModelEntity<T> | undefined;
export function useModel<T extends Model<any, any>>(
  model: T,
  lens: Lens<T>,
  options?: UseModelOptions<T>,
): Array<ReactModelEntity<T>>;
export function useModel<T extends Model<any, any>>(
  handle: ReactModelHandle<T>,
  options?: { mounted?: Record<string, unknown> },
): ReactModelEntity<T>;
export function useModel<T extends Model<any, any>>(
  handle: CreatedModel<T>,
  options?: { mounted?: Record<string, unknown> },
): ReactModelEntity<T>;
export function useModel<T extends Model<any, any>>(
  input: T | ReactModelHandle<T> | CreatedModel<T>,
  lensOrOptions?: Lens<T> | UseModelOptions<T>,
  maybeOptions?: UseModelOptions<T>,
): ReactModelEntity<T> | Array<ReactModelEntity<T>> | undefined {
  const [, rerender] = useReducer((value) => value + 1, 0);
  const providedScope = useProvidedScope() ?? undefined;
  const isActiveRef = useRef(true);
  const pendingRerenderRef = useRef(false);

  useEffect(() => {
    isActiveRef.current = true;

    return () => {
      isActiveRef.current = false;
    };
  }, []);

  const requestRerender = () => {
    if (pendingRerenderRef.current) {
      return;
    }

    pendingRerenderRef.current = true;

    scheduleMicrotask(() => {
      pendingRerenderRef.current = false;

      if (!isActiveRef.current) {
        return;
      }

      rerender();
    });
  };

  if (isReactModelHandle(input)) {
    const handle = input;
    const mounted =
      (lensOrOptions as { mounted?: Record<string, unknown> } | undefined)
        ?.mounted ?? {};
    const scope = handle.scope ?? providedScope;

    return useCommittedHandle({
      handle,
      mounted,
      forceRerender: rerender,
      retain: false,
      requestRerender,
      scope,
    });
  }

  if (isCreatedModel(input)) {
    const handle = getCreatedModelHandle(input);
    const mounted =
      (lensOrOptions as { mounted?: Record<string, unknown> } | undefined)
        ?.mounted ?? {};
    const scope = handle.scope ?? providedScope;

    return useCommittedHandle({
      handle,
      mounted,
      forceRerender: rerender,
      retain: false,
      requestRerender,
      scope,
    });
  }

  if (isLens(lensOrOptions)) {
    const lens = lensOrOptions;

    useEffect(
      () => subscribeToGraph(input, requestRerender, providedScope),
      [input, providedScope],
    );

    if (isSingleLens(lens)) {
      return resolveLensEntity(input, lens as SingleLens<T>, providedScope);
    }

    return resolveLensEntities(input, lens, providedScope);
  }

  const options = (lensOrOptions ?? maybeOptions ?? {}) as UseModelOptions<T>;
  const handleRef = useRef<ReactModelHandle<T> | null>(null);
  const desiredScope = options.scope ?? providedScope;

  if (
    !handleRef.current ||
    (options.id !== undefined && handleRef.current.id !== options.id) ||
    handleRef.current.scope !== desiredScope
  ) {
    const createOptions =
      options.id !== undefined
        ? desiredScope !== undefined
          ? { id: options.id, scope: desiredScope }
          : { id: options.id }
        : desiredScope !== undefined
          ? { scope: desiredScope }
          : undefined;

    handleRef.current = createReactModelHandle(input, options.data, createOptions);
  }

  const handle = handleRef.current!;
  const scope = handle.scope ?? providedScope;

  return useCommittedHandle({
    handle,
    mounted: options.mounted ?? {},
    forceRerender: rerender,
    retain: Boolean(options.retain),
    requestRerender,
    scope,
  });
}
