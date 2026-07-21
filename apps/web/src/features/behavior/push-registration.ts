import {
  getPushConfiguration,
  revokePushSubscription,
  savePushSubscription,
} from './behavior-api';

export type BrowserPushState =
  'unsupported' | 'default' | 'denied' | 'subscribed';

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

export function browserPushState(): BrowserPushState {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  ) {
    return 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  return 'default';
}

export async function detectBrowserPushState(): Promise<BrowserPushState> {
  const state = browserPushState();
  if (state !== 'default') return state;
  const registration = await navigator.serviceWorker.getRegistration('/');
  return (await registration?.pushManager.getSubscription())
    ? 'subscribed'
    : 'default';
}

export async function enableBrowserPush(): Promise<BrowserPushState> {
  const state = browserPushState();
  if (state === 'unsupported' || state === 'denied') return state;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted')
    return permission === 'denied' ? 'denied' : 'default';
  const configuration = await getPushConfiguration();
  if (!configuration.enabled || !configuration.publicKey) return 'unsupported';
  const registration = await navigator.serviceWorker.register('/sw.js', {
    scope: '/',
  });
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(configuration.publicKey),
    }));
  await savePushSubscription(subscription);
  return 'subscribed';
}

export async function disableBrowserPush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await revokePushSubscription(subscription.endpoint);
  await subscription.unsubscribe();
}
