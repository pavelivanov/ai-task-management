# Push-delivery failure

Push delivery is optional and does not gate API readiness or deterministic
workflows.

1. Check aggregate push outcomes in `/health/metrics` and coded
   `notification.worker.processed` logs. Do not log notification body, push
   endpoint, `p256dh`, auth secret, or VAPID private key.
2. Interpret outcomes:
   - `delivered`: at least one active subscription accepted the message;
   - `skipped`/`NO_ACTIVE_SUBSCRIPTION`: no usable subscription;
   - `revoked` with 404/410: the subscription is automatically revoked;
   - `transient`/`NETWORK`: bounded exponential retry applies;
   - `failed` or a permanent code: the notification stops retrying;
   - `disabled`: push is intentionally unavailable.
3. Verify VAPID subject/public/private configuration in the secret/config store,
   provider reachability, system time, and worker health. Never print key values.
4. Correct configuration or roll back the image. Do not reset delivery attempts
   broadly or recreate revoked subscriptions; the browser must subscribe again.
5. Test with a dedicated synthetic pilot account, then confirm retry age and
   failure outcomes return to baseline.

If push remains down, keep in-app notification listing available and communicate
the degraded channel. Escalate only the push channel; do not declare the entire
API unavailable.
