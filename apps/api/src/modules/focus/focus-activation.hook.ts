import { Injectable } from '@nestjs/common';

export const FOCUS_ACTIVATION_HOOK = Symbol('FOCUS_ACTIVATION_HOOK');

export interface FocusActivationHook {
  beforeActivate(userId: string): Promise<void>;
}

@Injectable()
export class NoopFocusActivationHook implements FocusActivationHook {
  beforeActivate(): Promise<void> {
    return Promise.resolve();
  }
}
