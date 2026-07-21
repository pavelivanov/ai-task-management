self.addEventListener('push', (event) => {
  let payload = {
    notificationId: '',
    title: 'Fieldnote reminder',
    body: 'Open Fieldnote to review.',
    deepLink: '/notifications',
  };
  try {
    payload = { ...payload, ...(event.data ? event.data.json() : {}) };
  } catch {
    // A malformed payload falls back to the content-free reminder.
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: {
        notificationId: payload.notificationId,
        deepLink: payload.deepLink,
      },
      tag: payload.notificationId || 'fieldnote-reminder',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const deepLink = event.notification.data?.deepLink || '/notifications';
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        const existing = clients[0];
        if (existing) {
          return existing.navigate(deepLink).then(() => existing.focus());
        }
        return self.clients.openWindow(deepLink);
      }),
  );
});
