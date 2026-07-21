import { timeZoneSchema, type UserPreferences } from '@execution/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import {
  getPreferences,
  updatePreferences,
} from '../features/settings/settings-api';
import {
  browserPushState,
  detectBrowserPushState,
  disableBrowserPush,
  enableBrowserPush,
  type BrowserPushState,
} from '../features/behavior/push-registration';
import { ErrorState, LoadingState } from '../features/ui/AsyncState';
import { isApiError } from '../lib/api-client';
import { queryKeys } from '../lib/query-client';
import { useAuthenticatedUser } from './use-authenticated-user';

export function SettingsPage() {
  const user = useAuthenticatedUser();
  const preferences = useQuery({
    queryKey: queryKeys.preferences(user.id),
    queryFn: getPreferences,
  });
  if (preferences.isPending) return <LoadingState label="Opening settings…" />;
  if (preferences.error) {
    return (
      <ErrorState
        error={preferences.error}
        retry={() => void preferences.refetch()}
      />
    );
  }
  return preferences.data ? (
    <SettingsForm initial={preferences.data} userId={user.id} />
  ) : null;
}

function SettingsForm({
  initial,
  userId,
}: {
  initial: UserPreferences;
  userId: string;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [pushState, setPushState] = useState<BrowserPushState>(() =>
    browserPushState(),
  );
  const [pushPending, setPushPending] = useState(false);
  const save = useMutation({
    mutationFn: () => updatePreferences(form),
    onSuccess: (data) => {
      setForm(data);
      queryClient.setQueryData(queryKeys.preferences(userId), data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.today(userId) });
      setMessage('Settings saved. Date boundaries now use this timezone.');
    },
    onError: (error) =>
      setMessage(
        isApiError(error) ? error.message : 'Settings could not be saved.',
      ),
  });
  const timezoneValid = timeZoneSchema.safeParse(form.timezone).success;
  const notificationBenefitSelected =
    form.notificationsEnabled &&
    (form.morningPlanningReminder || form.endOfDayReminder);

  useEffect(() => {
    void detectBrowserPushState().then(setPushState);
  }, []);

  const enablePush = async () => {
    setPushPending(true);
    try {
      await save.mutateAsync();
      const state = await enableBrowserPush();
      setPushState(state);
      setMessage(
        state === 'subscribed'
          ? 'Browser alerts are enabled for the benefits selected above.'
          : state === 'denied'
            ? 'Browser permission was denied. Reminders remain available in the app.'
            : state === 'unsupported'
              ? 'This browser cannot register push alerts. In-app reminders still work.'
              : 'Permission was not granted. In-app reminders still work.',
      );
    } catch {
      setMessage(
        'Browser alerts could not be registered. In-app reminders still work.',
      );
    } finally {
      setPushPending(false);
    }
  };

  const disablePush = async () => {
    setPushPending(true);
    try {
      await disableBrowserPush();
      setPushState('default');
      setMessage(
        'Browser alerts are off. In-app reminder history is unchanged.',
      );
    } finally {
      setPushPending(false);
    }
  };

  return (
    <div className="page settings-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Shape the working day</p>
          <h1>Settings</h1>
          <p className="page-intro">
            These boundaries guide planning and review. They never complete work
            on your behalf.
          </p>
        </div>
      </header>
      <form
        className="settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (timezoneValid) save.mutate();
        }}
      >
        <fieldset>
          <legend>Time and capacity</legend>
          <div className="form-grid">
            <label>
              IANA timezone
              <input
                autoComplete="off"
                aria-describedby="timezone-help"
                aria-invalid={!timezoneValid}
                name="timezone"
                onChange={(event) =>
                  setForm({ ...form, timezone: event.target.value })
                }
                spellCheck={false}
                value={form.timezone}
              />
              <small id="timezone-help">
                {timezoneValid
                  ? 'Used for local day boundaries.'
                  : 'Enter a valid timezone, such as Europe/Moscow.'}
              </small>
            </label>
            <label>
              Workday starts
              <input
                autoComplete="off"
                name="workdayStart"
                onChange={(event) =>
                  setForm({ ...form, workdayStart: event.target.value })
                }
                type="time"
                value={form.workdayStart}
              />
            </label>
            <label>
              Workday ends
              <input
                autoComplete="off"
                name="workdayEnd"
                onChange={(event) =>
                  setForm({ ...form, workdayEnd: event.target.value })
                }
                type="time"
                value={form.workdayEnd}
              />
            </label>
            <label>
              Primary limit
              <input
                autoComplete="off"
                max={5}
                min={1}
                name="primaryTaskLimit"
                onChange={(event) =>
                  setForm({
                    ...form,
                    primaryTaskLimit: Number(event.target.value),
                  })
                }
                type="number"
                value={form.primaryTaskLimit}
              />
            </label>
            <label>
              Secondary limit
              <input
                autoComplete="off"
                max={10}
                min={0}
                name="secondaryTaskLimit"
                onChange={(event) =>
                  setForm({
                    ...form,
                    secondaryTaskLimit: Number(event.target.value),
                  })
                }
                type="number"
                value={form.secondaryTaskLimit}
              />
            </label>
            <label>
              Capacity warning buffer (%)
              <input
                autoComplete="off"
                max={100}
                min={0}
                name="capacityWarningPercent"
                onChange={(event) =>
                  setForm({
                    ...form,
                    capacityWarningPercent: Number(event.target.value),
                  })
                }
                type="number"
                value={form.capacityWarningPercent}
              />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Protected hours</legend>
          <label className="check-row">
            <input
              checked={form.protectedHoursEnabled}
              name="protectedHoursEnabled"
              onChange={(event) =>
                setForm({
                  ...form,
                  protectedHoursEnabled: event.target.checked,
                  protectedHoursStart: event.target.checked
                    ? (form.protectedHoursStart ?? '10:00')
                    : null,
                  protectedHoursEnd: event.target.checked
                    ? (form.protectedHoursEnd ?? '12:00')
                    : null,
                })
              }
              type="checkbox"
            />
            Reserve a protected focus window
          </label>
          <p className="field-note">
            Personal tasks require confirmation inside this window. Work and
            planned personal-admin blocks remain available.
          </p>
          {form.protectedHoursEnabled && (
            <div className="form-grid form-grid--small">
              <label>
                Protected start
                <input
                  autoComplete="off"
                  name="protectedHoursStart"
                  onChange={(event) =>
                    setForm({
                      ...form,
                      protectedHoursStart: event.target.value,
                    })
                  }
                  type="time"
                  value={form.protectedHoursStart ?? ''}
                />
              </label>
              <label>
                Protected end
                <input
                  autoComplete="off"
                  name="protectedHoursEnd"
                  onChange={(event) =>
                    setForm({ ...form, protectedHoursEnd: event.target.value })
                  }
                  type="time"
                  value={form.protectedHoursEnd ?? ''}
                />
              </label>
            </div>
          )}
        </fieldset>

        <fieldset>
          <legend>Reminders and interruption</legend>
          {(
            [
              ['notificationsEnabled', 'Allow notification registration'],
              ['morningPlanningReminder', 'Morning planning reminder'],
              ['endOfDayReminder', 'End-of-day reminder'],
            ] as const
          ).map(([key, label]) => (
            <label className="check-row" key={key}>
              <input
                checked={form[key]}
                name={key}
                onChange={(event) =>
                  setForm({ ...form, [key]: event.target.checked })
                }
                type="checkbox"
              />
              {label}
            </label>
          ))}
          <label>
            Assistant interruption level
            <select
              name="aiInterruptionLevel"
              onChange={(event) =>
                setForm({
                  ...form,
                  aiInterruptionLevel: event.target
                    .value as UserPreferences['aiInterruptionLevel'],
                })
              }
              value={form.aiInterruptionLevel}
            >
              <option value="minimal">Minimal</option>
              <option value="balanced">Balanced</option>
              <option value="proactive">Proactive</option>
            </select>
          </label>
          {notificationBenefitSelected && (
            <div className="notification-permission-panel">
              <div>
                <strong>Browser alerts for selected reminders</strong>
                <p className="field-note">
                  Permission is requested only when you press Enable. Denial
                  does not remove the in-app notification center.
                </p>
              </div>
              {pushState === 'subscribed' ? (
                <button
                  className="button button--quiet"
                  disabled={pushPending}
                  onClick={() => void disablePush()}
                  type="button"
                >
                  Disable browser alerts
                </button>
              ) : (
                <button
                  className="button"
                  disabled={pushPending || pushState === 'unsupported'}
                  onClick={() => void enablePush()}
                  type="button"
                >
                  Enable browser alerts
                </button>
              )}
            </div>
          )}
        </fieldset>

        {message && (
          <p className="inline-message" role="status">
            {message}
          </p>
        )}
        <button
          className="button button--primary button--large"
          disabled={!timezoneValid || save.isPending}
          type="submit"
        >
          Save settings
        </button>
      </form>
    </div>
  );
}
