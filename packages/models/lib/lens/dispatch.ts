import {
  createEffect,
  createEvent,
  is,
  launch,
  sample,
  type Event,
  type EventCallable,
} from "effector";
import type { Model } from "../models";
import { getContext, setContext, setTarget } from "../runtime";

function includesInstance(
  instances: Record<string | number, any>,
  instance: any,
): boolean {
  return Object.values(instances).some((value) => value === instance);
}

export function createClock(
  element: Event<any>,
  model: Model<any, any>,
  getInstances: (payload: any) => Record<string | number, any>,
): Event<any> {
  const clock = createEvent<any>();

  sample({
    clock: element,
    filter: (payload) => {
      const ctx = getContext();

      if (!ctx.current) {
        return false;
      }

      const instances = getInstances(payload);

      return (
        ctx.current.model === model &&
        Object.keys(instances).length > 0 &&
        includesInstance(instances, ctx.current.instance)
      );
    },
    target: clock,
  });

  return clock;
}

export function createTarget(
  element: Event<any>,
  model: Model<any, any>,
  getInstances: (payload: any) => Record<string | number, any>,
  getTargetModel: () => Model<any, any>,
  map?: (payload: any) => any,
): EventCallable<any> {
  const target = createEvent<any>();

  const actionFx = createEffect(
    async ({
      payload,
      context,
    }: {
      payload: any;
      context: ReturnType<typeof getContext>;
    }) => {
      const baseContext = context;
      const baseCurrent = baseContext.current;
      setContext(baseContext);
      const instances = getInstances(payload);

      if (Object.keys(instances).length === 0) {
        return Promise.reject();
      }

      let capturedScope: any = undefined;
      const storeRootId = is.store(element)
        ? (element as any).graphite.meta.rootStateRefId
        : null;

      for (const instance of Object.values(instances)) {
        setContext({
          current: baseCurrent
            ? {
                ...baseCurrent,
                owner: baseCurrent.owner ?? baseCurrent,
                model,
                instance,
              }
            : { model, instance },
        });

        if (!baseCurrent?.target) {
          setTarget(getTargetModel());
        }

        if (capturedScope && storeRootId) {
          const stateRef = capturedScope.reg[storeRootId];
          if (stateRef) {
            stateRef.current = undefined;
          }
        }

        launch(element, payload);

        if (!capturedScope) {
          capturedScope = getContext().current?.scope;
        }
      }

      setContext(baseContext);
    },
  );

  sample({
    clock: target,
    fn: (payload) => ({
      payload: map ? map(payload) : payload,
      context: getContext(),
    }),
    target: actionFx,
  });

  return target;
}
