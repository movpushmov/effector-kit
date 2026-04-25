import type { Model } from '../models';
import type { RuntimeContext } from './types';

let runtimeContext: RuntimeContext = {};
let declarationModelId: string | undefined;

export function getContext(): RuntimeContext {
  return runtimeContext;
}

export function setContext(ctx: RuntimeContext): void {
  runtimeContext = ctx;
}

export function setTarget(target: Model<any, any>): void {
  if (!runtimeContext.current) {
    throw new Error('Context not found');
  }

  runtimeContext.current.target = target;
}

export function getDeclarationModelId(): string | undefined {
  return declarationModelId;
}

export function setDeclarationModelId(id?: string): void {
  declarationModelId = id;
}
