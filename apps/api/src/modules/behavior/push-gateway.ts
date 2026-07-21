export const PUSH_GATEWAY = Symbol('PUSH_GATEWAY');

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  authSecret: string;
}

export interface PushPayload {
  notificationId: string;
  title: string;
  body: string;
  deepLink: string;
}

export type PushDeliveryResult =
  | { kind: 'delivered' }
  | { kind: 'revoked'; code: '404' | '410' }
  | { kind: 'transient'; code: string }
  | { kind: 'permanent'; code: string };

export interface PushGateway {
  readonly enabled: boolean;
  send(target: PushTarget, payload: PushPayload): Promise<PushDeliveryResult>;
}
