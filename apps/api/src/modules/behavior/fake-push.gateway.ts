import { Injectable } from '@nestjs/common';

import type {
  PushDeliveryResult,
  PushGateway,
  PushPayload,
  PushTarget,
} from './push-gateway';

@Injectable()
export class FakePushGateway implements PushGateway {
  readonly enabled = true;
  readonly deliveries: Array<{ target: PushTarget; payload: PushPayload }> = [];
  private nextResult: PushDeliveryResult = { kind: 'delivered' };

  respondOnce(result: PushDeliveryResult): void {
    this.nextResult = result;
  }

  reset(): void {
    this.deliveries.length = 0;
    this.nextResult = { kind: 'delivered' };
  }

  async send(
    target: PushTarget,
    payload: PushPayload,
  ): Promise<PushDeliveryResult> {
    this.deliveries.push({ target: { ...target }, payload: { ...payload } });
    const result = this.nextResult;
    this.nextResult = { kind: 'delivered' };
    return result;
  }
}
