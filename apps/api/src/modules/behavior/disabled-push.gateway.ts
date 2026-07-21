import { Injectable } from '@nestjs/common';

import type {
  PushDeliveryResult,
  PushGateway,
  PushPayload,
  PushTarget,
} from './push-gateway';

@Injectable()
export class DisabledPushGateway implements PushGateway {
  readonly enabled = false;

  async send(
    target: PushTarget,
    payload: PushPayload,
  ): Promise<PushDeliveryResult> {
    void target;
    void payload;
    return { kind: 'permanent', code: 'PUSH_DISABLED' };
  }
}
