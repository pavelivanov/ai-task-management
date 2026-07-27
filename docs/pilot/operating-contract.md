# Private-pilot operating contract

This contract defines the first invite-only pilot of Fieldnote. It supplements
the technical [release checklist](./checklist.md); neither document may be
waived silently. The pilot tests whether a small deterministic daily loop helps
participants complete a chosen primary outcome with focused time and less
repeated carryover. It does not measure productivity or compare people.

## Enrollment status and scope

Enrollment begins **closed**. The pilot owner may open it only after recording a
dated approval for the exact staged commit and image digests in the
[rehearsal record](./rehearsal-record.md).

- Invite one cohort of 6 participants, with an absolute maximum of 8 active
  participants.
- Run each participant for 14 consecutive calendar days. Keep the overall
  enrollment window within 21 days so the cohort shares one materially
  equivalent release.
- Enroll adults who use a Google account, independently plan knowledge work,
  can attempt the daily loop on at least 5 working days, and can provide
  feedback in English.
- Exclude minors, employer-mandated participation, shared accounts, and work
  involving regulated, classified, or highly sensitive personal data.
- Keep the assistant and web push disabled for this cohort. Their separate
  security and privacy gates must pass before either capability is enabled.

Participants are invited individually. Do not publish a public sign-up link or
accept delegated enrollment.

## Consent and onboarding

The pilot owner sends the following disclosure before adding a participant to
the Google OAuth test-user allowlist:

> Fieldnote is an experimental private-pilot service. It stores the tasks,
> plans, focus history, reviews, preferences, and account details you enter.
> The pilot reviews consented aggregate completion, focus, carryover, core-loop,
> reliability, and incident signals. It does not create a productivity score,
> compare you with other participants, or share your task content with an
> employer. Optional AI and web push are disabled. You may stop participating
> at any time and can permanently delete your account from Settings. Do not
> enter regulated, classified, or highly sensitive information. Support and
> withdrawal requests go to the pilot owner through the invitation channel.

Enrollment requires an affirmative written reply to that disclosure. Keep the
consent receipt outside this repository in the owner-controlled invitation
channel. Record only a random pilot participant code in analysis notes; never
commit a name, email address, OAuth identifier, user ID, task text, reflection,
or consent transcript.

The owner completes this onboarding sequence:

1. assign a random participant code and record the consent timestamp;
2. add the consenting Google account to the OAuth test-user allowlist;
3. share the staging URL, the 14-day window, support route, and deletion steps;
4. demonstrate capture, planning one primary outcome, focus, close-day review,
   and the repeated-carryover choices using synthetic content;
5. ask the participant to complete the deterministic loop once; and
6. confirm that logout, re-login, and account deletion instructions are
   understood.

## Observation and feedback

Collect only the aggregate signals listed in the release checklist. Review them
by cohort and fixed time window, with no composite score and no individual
ranking. Do not export task titles, descriptions, reflection text, prompts,
provider responses, emails, user IDs, session data, or raw database rows.

The observation schedule is:

- daily: the operator checks readiness, coded error rate, request latency,
  database waiters, queue age, and open incidents;
- day 7: the owner asks each participant three written questions—what became
  clearer, where the loop broke, and which repeated action felt unnecessary;
- day 14: a 30-minute exit interview or equivalent written response covers the
  core loop, carryover decisions, trust, missing controls, and willingness to
  continue; and
- within 5 working days after the cohort closes: publish a decision memo using
  aggregate measures and de-identified themes only.

The decision memo must choose one outcome: continue the same bounded pilot,
iterate and requalify, stop the pilot, or propose a separately reviewed broader
release.

## Support and incident ownership

Pavel Ivanov is the pilot, privacy, release, and incident owner. Participants
use the same private channel through which they were invited. The owner
acknowledges reports within one working day and treats access, privacy, data
loss, or account-deletion reports as immediate stop-condition candidates.

Operational response follows the [runbooks](../runbooks/README.md). Support
records contain only the participant code, UTC timestamp, route or workflow
step, safe request ID, and coded error. Never request screenshots or logs that
contain task content, cookies, OAuth codes, credentials, or personal account
details.

## Stop and pause conditions

Immediately pause all enrollment and active use for:

- suspected cross-user access, credential exposure, unauthorized disclosure,
  or another high-severity privacy or security issue;
- confirmed task, plan, focus, review, or account-deletion data corruption or
  loss;
- duplicate open focus sessions, duplicate lifecycle mutations, or another
  violated ownership/correctness invariant; or
- inability to restore the qualified release or its database within the
  recorded recovery objective.

Pause new enrollment and investigate before resuming when:

- readiness or web health is continuously unhealthy for 5 minutes;
- two participants encounter the same blocking core-loop error in 24 hours;
- a measured request repeatedly exceeds 1 second, task-list/current-focus p95
  exceeds 250 ms, database waiting clients exceed zero at pilot load, assistant
  queue age exceeds 30 seconds while enabled, or another
  [resource threshold](./resource-baseline.md) is crossed; or
- the owner cannot acknowledge a participant report within one working day.

Record the UTC pause time, safe evidence, affected release, owner, mitigation,
and next decision time. Resume only after the relevant deterministic journey
passes, the affected provider-backed gate is repeated, and the owner records a
new dated decision.

## Withdrawal, deletion, and closeout

Participation is voluntary. On withdrawal, remove the account from the OAuth
test-user allowlist and ask the participant to use Settings to delete the
account. If the UI is unavailable, follow the account-deletion runbook with
explicit participant authorization. Backups retain their approved lifecycle;
do not restore a backup into live service without deletion reconciliation.

At cohort close, disable unused test-user access, close open support records,
verify that withdrawn accounts are gone, record aggregate completion and
reliability windows, and keep enrollment closed until the decision memo is
approved.
