import type { Lens, Model } from "@effector-kit/models";
import { useEffect, useReducer, useRef } from "react";
import { createWatch, type Scope, type Unit } from "effector";
import { useProvidedScope } from "effector-react";
import {
  collectGraphUpdates,
  createReactModelHandle,
  isLens,
  isReactModelHandle,
  launchManagedModel,
  resolveHandleEntity,
  resolveLensEntities,
  unmountManagedModel,
} from "./runtime";
import type {
  ReactModelEntity,
  ReactModelHandle,
  UseModelOptions,
} from "./types";

function subscribeToGraph(
  model: Model<any, any>,
  onChange: () => void,
  scope?: Scope,
) {
  const units = collectGraphUpdates(model);

  if (scope) {
    return createWatch({
      unit: units,
      fn: onChange,
      scope,
    });
  }

  return createWatch({
    unit: units,
    fn: onChange,
  });
}

export function useModel<T extends Model<any, any>>(
  model: T,
  options?: UseModelOptions<T>,
): ReactModelEntity<T>;
export function useModel<T extends Model<any, any>>(
  model: T,
  lens: Lens<T>,
  options?: UseModelOptions<T>,
): Array<ReactModelEntity<T>>;
export function useModel<T extends Model<any, any>>(
  handle: ReactModelHandle<T>,
): ReactModelEntity<T>;
export function useModel<T extends Model<any, any>>(
  input: T | ReactModelHandle<T>,
  lensOrOptions?: Lens<T> | UseModelOptions<T>,
  maybeOptions?: UseModelOptions<T>,
): ReactModelEntity<T> | Array<ReactModelEntity<T>> {
  const [, rerender] = useReducer((value) => value + 1, 0);
  const providedScope = useProvidedScope() ?? undefined;

  if (isReactModelHandle(input)) {
    const handle = input;
    const scope = handle.scope ?? providedScope;
    const mountedRef = useRef(false);

    if (!mountedRef.current) {
      launchManagedModel({ ...handle, scope });
      mountedRef.current = true;
    }

    useEffect(() => {
      const unsubscribe = subscribeToGraph(
        handle.model,
        () => rerender(),
        scope,
      );

      return () => {
        unsubscribe();
        void unmountManagedModel({ ...handle, scope });
      };
    }, [handle, scope]);

    return resolveHandleEntity(handle, scope)!;
  }

  if (isLens(lensOrOptions)) {
    const lens = lensOrOptions;

    useEffect(
      () => subscribeToGraph(input, () => rerender(), providedScope),
      [input, providedScope],
    );

    return resolveLensEntities(input, lens, providedScope);
  }

  const options = (lensOrOptions ?? maybeOptions ?? {}) as UseModelOptions<T>;
  const handleRef = useRef<ReactModelHandle<T> | null>(null);

  if (!handleRef.current) {
    handleRef.current = createReactModelHandle(input, options.data, {
      scope: options.scope ?? providedScope,
    });
  }

  const handle = handleRef.current!;
  const scope = handle.scope ?? providedScope;
  const mountedRef = useRef(false);

  if (!mountedRef.current) {
    launchManagedModel({ ...handle, scope });
    mountedRef.current = true;
  }

  useEffect(() => {
    const unsubscribe = subscribeToGraph(input, () => rerender(), scope);

    return () => {
      unsubscribe();
      void unmountManagedModel({ ...handle, scope });
    };
  }, [handle, input, scope]);

  return resolveHandleEntity(handle, scope)!;
}
