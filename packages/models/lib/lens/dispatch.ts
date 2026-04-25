import {
  createEffect,
  createEvent,
  is,
  launch,
  sample,
  type Event,
  type EventCallable,
} from 'effector';
import type { Model } from '../models';
import {
  getContext,
  modifyDeclarations,
  setContext,
  setTarget,
} from '../runtime';

function includesInstance(
  instances: Record<string | number, any>,
  instance: any,
): boolean {
  return Object.values(instances).some(value => value === instance);
}

export function createClock(
  element: Event<any>,
  model: Model<any, any>,
  getInstances: (payload: any) => Record<string | number, any>,
  getContextModelId: () => string,
): Event<any> {
  return modifyDeclarations(() => {
    const clock = createEvent<any>();

    sample({
      clock: element,
      filter: payload => {
        const ctx = getContext();

        if (!ctx.current) {
          return false;
        }

        const sourceContext =
          ctx.current.model['~id'] === getContextModelId() ? ctx : {};
        setContext(sourceContext);
        const instances = getInstances(payload);
        setContext(ctx);

        return (
          ctx.current.model === model &&
          Object.keys(instances).length > 0 &&
          includesInstance(instances, ctx.current.instance)
        );
      },
      target: clock,
    });

    return clock;
  }).result;
}

export function createTarget(
  element: Event<any>,
  model: Model<any, any>,
  getInstances: (payload: any) => Record<string | number, any>,
  getTargetModel: () => Model<any, any>,
  getContextModelId: () => string,
  map?: (payload: any) => any,
): EventCallable<any> {
  return modifyDeclarations(() => {
    const target = createEvent<any>();

    const actionFx = createEffect(
      async ({
        payload,
        props,
        context,
      }: {
        payload: any;
        props: any;
        context: ReturnType<typeof getContext>;
      }) => {
        const sourceContext =
          context.current?.model['~id'] === getContextModelId() ? context : {};
        setContext(sourceContext);
        const instances = getInstances(props);
        const shouldResetStaleContext = Boolean(
          context.current &&
          context.current.model['~id'] !== getContextModelId() &&
          Object.keys(instances).length > 0 &&
          !includesInstance(instances, context.current.instance),
        );
        const baseContext = shouldResetStaleContext ? {} : context;
        const baseCurrent = baseContext.current;
        setContext(baseContext);

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

          if (baseCurrent?.scope) {
            launch({
              target: element,
              params: payload,
              scope: baseCurrent.scope,
              page: null as any,
            } as any);
          } else {
            launch({
              target: element,
              params: payload,
              page: null as any,
            } as any);
          }

          if (!capturedScope) {
            capturedScope = getContext().current?.scope;
          }
        }

        setContext({});
      },
    );

    sample({
      clock: target,
      fn: payload => ({
        payload: map ? map(payload) : payload,
        props: payload,
        context: getContext(),
      }),
      target: actionFx,
    });

    return target;
  }).result;
}
