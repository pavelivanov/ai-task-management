import { Injectable } from '@nestjs/common';
import webPush from 'web-push';

import { AppConfig } from '../../config/app-config.service';
import type {
  PushDeliveryResult,
  PushGateway,
  PushPayload,
  PushTarget,
} from './push-gateway';

@Injectable()
export class WebPushGateway implements PushGateway {
  readonly enabled = true;

  constructor(config: AppConfig) {
    if (
      !config.vapidSubject ||
      !config.vapidPublicKey ||
      !config.vapidPrivateKey
    ) {
      throw new Error('VAPID configuration is incomplete.');
    }
    webPush.setVapidDetails(
      config.vapidSubject,
      config.vapidPublicKey,
      config.vapidPrivateKey,
    );
  }

  async send(
    target: PushTarget,
    payload: PushPayload,
  ): Promise<PushDeliveryResult> {
    try {
      await webPush.sendNotification(
        {
          endpoint: target.endpoint,
          keys: { p256dh: target.p256dh, auth: target.authSecret },
        },
        JSON.stringify(payload),
        { TTL: 3_600, urgency: 'normal' },
      );
      return { kind: 'delivered' };
    } catch (error) {
      const statusCode = this.statusCode(error);
      if (statusCode === 404 || statusCode === 410) {
        return { kind: 'revoked', code: String(statusCode) as '404' | '410' };
      }
      if (statusCode === 429 || (statusCode !== null && statusCode >= 500)) {
        return { kind: 'transient', code: String(statusCode) };
      }
      if (statusCode === null) return { kind: 'transient', code: 'NETWORK' };
      return { kind: 'permanent', code: String(statusCode) };
    }
  }

  private statusCode(error: unknown): number | null {
    if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
    ) {
      return error.statusCode;
    }
    return null;
  }
}
