import type { Lens, Model, SingleLens } from "@effector-kit/models";
import { useEffect, useLayoutEffect, useReducer, useRef } from "react";
import { createWatch, type Scope } from "effector";
import { useProvidedScope } from "effector-react";
import {
  collectCreatedModelProxyUpdates,
  collectGraphUpdates,
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
  resolveLensEntities,
} from "./runtime";
import type {
  CreatedModel,
  ReactModelEntity,
  ReactModelHandle,
  UseModelOptions,
} from "./types";

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
    const mountedRef = useRef(false);
    const suppressGraphUpdatesRef = useRef(false);

    if (!mountedRef.current) {
      suppressGraphUpdatesRef.current = true;
      launchManagedModel({ ...handle, scope }, mounted);
      mountedRef.current = true;
    }

    useLayoutEffect(() => {
      suppressGraphUpdatesRef.current = false;
    });

    useLayoutEffect(() => {
      const unsubscribe = subscribeToGraph(
        handle.model,
        () => {
          if (suppressGraphUpdatesRef.current) {
            return;
          }

          requestRerender();
        },
        scope,
      );

      return () => {
        unsubscribe();
        launchUnmountManagedModel({ ...handle, scope });
      };
    }, [handle, scope]);

    return resolveHandleEntity(handle, scope)!;
  }

  if (isCreatedModel(input)) {
    const handle = getCreatedModelHandle(input);
    const mounted =
      (lensOrOptions as { mounted?: Record<string, unknown> } | undefined)
        ?.mounted ?? {};
    const scope = handle.scope ?? providedScope;
    const mountedRef = useRef(false);
    const suppressGraphUpdatesRef = useRef(false);

    if (!mountedRef.current) {
      suppressGraphUpdatesRef.current = true;
      launchManagedModel({ ...handle, scope }, mounted);
      mountedRef.current = true;
    }

    useLayoutEffect(() => {
      suppressGraphUpdatesRef.current = false;
    });

    useLayoutEffect(() => {
      const unsubscribe = subscribeToGraph(
        handle.model,
        () => {
          if (suppressGraphUpdatesRef.current) {
            return;
          }

          requestRerender();
        },
        scope,
      );

      return () => {
        unsubscribe();
        launchUnmountManagedModel({ ...handle, scope });
      };
    }, [handle, scope]);

    return resolveHandleEntity(handle, scope)!;
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
  const mountedRef = useRef(false);
  const suppressGraphUpdatesRef = useRef(false);
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
    mountedRef.current = false;
  }

  const handle = handleRef.current!;
  const scope = handle.scope ?? providedScope;

  if (!mountedRef.current) {
    suppressGraphUpdatesRef.current = true;
    launchManagedModel({ ...handle, scope }, options.mounted ?? {});
    mountedRef.current = true;
  }

  useLayoutEffect(() => {
    suppressGraphUpdatesRef.current = false;
  });

  useLayoutEffect(() => {
    const unsubscribe = subscribeToGraph(input, () => {
      if (suppressGraphUpdatesRef.current) {
        return;
      }

      requestRerender();
    }, scope);

    return () => {
      unsubscribe();

      if (!options.retain) {
        launchUnmountManagedModel({ ...handle, scope });
      }
    };
  }, [handle, input, options.retain, scope]);

  return resolveHandleEntity(handle, scope)!;
}
