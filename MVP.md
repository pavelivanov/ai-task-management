# AI Execution Assistant — MVP Architecture

## 1. Architectural goal

The MVP should validate one core hypothesis:

> A system that limits daily commitments, protects one active focus task, captures distractions without interrupting work, and reflects meaningful progress can reduce procrastination.

The MVP should not try to become a complete project-management platform. It should be a focused personal execution system.

The architecture should therefore prioritize:

* rapid development;
* simple deployment;
* reliable task state transitions;
* easy iteration on AI behavior;
* complete activity history;
* minimal operational complexity.

---

## 2. Recommended architecture

Use a **modular monolith**, not microservices.

```text
┌─────────────────────────────────────────────┐
│                 Web Client                  │
│                                             │
│  Daily Plan   Focus Mode   Inbox   Review   │
│  AI Chat      Notifications   Settings      │
└──────────────────────┬──────────────────────┘
                       │ HTTPS / SSE
                       ▼
┌─────────────────────────────────────────────┐
│              Backend Application            │
│                                             │
│  Auth Module                                │
│  Task Module                                │
│  Planning Module                            │
│  Focus Session Module                       │
│  AI Assistant Module                        │
│  Review & Analytics Module                  │
│  Notification Module                        │
│  Background Jobs                            │
└───────────────┬───────────────┬─────────────┘
                │               │
                ▼               ▼
        ┌──────────────┐  ┌──────────────┐
        │ PostgreSQL   │  │ Redis        │
        │              │  │ Optional MVP │
        │ Main data    │  │ Jobs/cache   │
        └──────────────┘  └──────────────┘
                │
                ▼
        ┌──────────────┐
        │ LLM Provider │
        │ Structured   │
        │ suggestions  │
        └──────────────┘
```

### Suggested stack

#### Frontend

* React
* TypeScript
* Vite
* TanStack Query
* Zustand or React context for temporary UI state
* React Router if using Vite
* dnd-kit for task rearrangement
* Service Worker for notifications

The product itself does not require SSR, so React with Vite is sufficient.

#### Backend

* Node.js
* NestJS
* TypeScript
* Prisma
* PostgreSQL
* Redis with BullMQ only when background jobs become necessary

#### Infrastructure

* Docker Compose initially
* Managed PostgreSQL
* One backend container
* One frontend deployment
* Optional Redis container
* Structured application logs

---

# 3. Core product modules

## 3.1 Authentication module

The first version only needs simple authentication.

Support one of:

* email magic link;
* Google OAuth;

The user profile stores:

* timezone;
* default workday start;
* default workday end;
* planning preferences;
* notification preferences;
* AI interruption level.

Do not build teams, organizations, permissions, or shared task lists in the MVP.

---

## 3.2 Task module

The task module owns the task lifecycle.

A task is not directly tied to a specific day. A task exists independently in the backlog and can optionally be scheduled into a daily plan.

### Task properties

```ts
type Task = {
  id: string;
  userId: string;

  title: string;
  description?: string;

  category: "work" | "personal";
  status:
    | "inbox"
    | "backlog"
    | "planned"
    | "in_progress"
    | "waiting"
    | "blocked"
    | "completed"
    | "cancelled"
    | "archived";

  priority: "low" | "normal" | "high" | "critical";

  estimateMinutes?: number;
  dueAt?: Date;

  projectId?: string;
  parentTaskId?: string;

  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
};
```

### Important separation

Do not store the planned start time directly on the task.

Create a separate `DailyPlanItem` entity. This allows the same task to be scheduled on different days without losing its history.

---

## 3.3 Inbox and backlog module

Every quickly captured task goes into the inbox.

The inbox is a temporary collection of unprocessed thoughts. The backlog contains tasks the user has consciously accepted.

This distinction prevents the backlog from becoming an automatic graveyard.

### Inbox processing actions

For each inbox item, the user or assistant can:

* move it to the backlog;
* schedule it;
* break it down;
* merge it with an existing task;
* convert it into a note;
* archive it;
* delete it.

The daily view should never display the full inbox automatically.

---

## 3.4 Daily planning module

A daily plan is a snapshot of what the user intends to work on today.

```ts
type DailyPlan = {
  id: string;
  userId: string;
  date: string;

  workdayStart?: string;
  workdayEnd?: string;

  status: "draft" | "active" | "closed";

  createdAt: Date;
  closedAt?: Date;
};
```

Each scheduled task is represented by a plan item:

```ts
type DailyPlanItem = {
  id: string;
  dailyPlanId: string;
  taskId: string;

  role: "primary" | "secondary" | "optional";

  plannedStart?: Date;
  plannedDurationMinutes?: number;

  position: number;

  addedDuringDay: boolean;
  completedDuringDay: boolean;
};
```

### Planning constraints

The backend should enforce soft limits:

* one primary outcome;
* up to two secondary outcomes;
* optional small tasks;
* planned workload should not greatly exceed available time.

These should initially be warnings rather than hard restrictions.

Example:

```text
Available work time: 6 hours
Scheduled work: 8 hours 30 minutes

Warning:
This plan is likely unrealistic.
```

---

## 3.5 Focus session module

This is the most important module in the product.

The user can have only one active focus session.

```ts
type FocusSession = {
  id: string;
  userId: string;
  taskId: string;

  status:
    | "active"
    | "paused"
    | "waiting"
    | "blocked"
    | "completed"
    | "stopped";

  startedAt: Date;
  endedAt?: Date;

  initialIntent?: string;
  outcome?: string;
  interruptionReason?: string;
};
```

A focus session represents one attempt to work on a task. A task can have many sessions.

### Server-side invariant

The database must prevent a user from having two active sessions.

This should not rely only on frontend logic.

Possible implementation:

* transaction-level check before creating a session;
* partial unique index for active sessions;
* advisory lock keyed by user ID.

For PostgreSQL:

```sql
CREATE UNIQUE INDEX one_active_session_per_user
ON focus_sessions (user_id)
WHERE status = 'active';
```

### Starting a task

When the user clicks **Start**:

1. Backend checks for an existing active session.
2. A new focus session is created.
3. Task status becomes `in_progress`.
4. A task event is stored.
5. The frontend enters focus mode.

### Pausing

A paused task is intentionally inactive but still controlled by the user.

### Waiting

Use `waiting` when progress depends on something external:

* AI response;
* build;
* deployment;
* another person;
* download or upload.

When the user marks a task as waiting, the assistant may suggest a compatible short task.

### Blocked

Use `blocked` when the user cannot continue because a decision, clarification, or prerequisite is missing.

---

## 3.6 Task history and events

Avoid deriving the complete history only from current database fields.

Use an append-only event table.

```ts
type TaskEvent = {
  id: string;
  userId: string;
  taskId: string;

  type:
    | "created"
    | "updated"
    | "scheduled"
    | "unscheduled"
    | "started"
    | "paused"
    | "resumed"
    | "waiting"
    | "blocked"
    | "completed"
    | "carried_over"
    | "cancelled"
    | "archived"
    | "estimate_changed"
    | "ai_suggestion_accepted";

  metadata: Record<string, unknown>;

  createdAt: Date;
};
```

This supports:

* accurate task history;
* time calculations;
* analytics;
* debugging;
* future AI context.

Do not implement full event sourcing. PostgreSQL remains the source of current state; events provide history.

---

# 4. AI assistant architecture

## 4.1 Core rule

The LLM must not directly control task state.

Use the LLM for:

* interpretation;
* decomposition;
* prioritization suggestions;
* plan suggestions;
* reflection;
* classification;
* natural-language explanations.

Use deterministic application logic for:

* status transitions;
* deadlines;
* active-session constraints;
* scheduling conflicts;
* work-hour rules;
* notification timing;
* persistence.

The AI proposes. The application validates and executes.

---

## 4.2 AI request flow

```text
User action
    │
    ▼
Backend builds limited context
    │
    ▼
LLM returns structured suggestion
    │
    ▼
Backend validates response
    │
    ▼
Suggestion stored in database
    │
    ▼
User accepts, edits, or rejects
    │
    ▼
Backend performs deterministic action
```

### Example structured output

```ts
type DailyPlanSuggestion = {
  summary: string;

  primaryTaskId?: string;
  secondaryTaskIds: string[];
  optionalTaskIds: string[];

  warnings: Array<{
    type: "overloaded" | "deadline_risk" | "repeated_carryover";
    message: string;
  }>;

  explanation: string;
};
```

The LLM should return JSON matching a strict schema.

Use runtime validation with Zod.

---

## 4.3 AI context builder

Do not send the entire task database to the model.

Create a context builder that selects relevant data:

* overdue tasks;
* tasks due soon;
* recently carried-over tasks;
* current daily plan;
* active focus task;
* recent focus history;
* available work time;
* user planning preferences;
* a limited number of backlog candidates.

Example:

```ts
type AssistantContext = {
  currentDate: string;
  currentTime: string;
  availableMinutes: number;

  currentTask?: TaskSummary;
  todayPlan: TaskSummary[];

  overdueTasks: TaskSummary[];
  repeatedlyCarriedTasks: TaskSummary[];
  backlogCandidates: TaskSummary[];

  recentDailyOutcomes: DailyOutcomeSummary[];
};
```

This keeps prompts smaller, cheaper, and more predictable.

---

## 4.4 AI capabilities in the MVP

### Capability 1: task extraction

Input:

> Prepare the airline lawsuit and check the new couch later.

Output:

```json
{
  "tasks": [
    {
      "title": "Prepare the airline lawsuit",
      "category": "personal",
      "estimateMinutes": null
    },
    {
      "title": "Check couch options",
      "category": "personal",
      "estimateMinutes": null
    }
  ]
}
```

The user confirms before saving multiple extracted tasks.

### Capability 2: daily plan suggestion

The assistant receives:

* available work time;
* deadlines;
* backlog candidates;
* carryover history;
* estimates.

It suggests a realistic plan and explains why.

### Capability 3: task decomposition

Input:

> File a lawsuit against the airline.

Possible output:

```json
{
  "reason": "The task combines research, document preparation, and submission.",
  "subtasks": [
    {
      "title": "Confirm the correct court",
      "estimateMinutes": 20
    },
    {
      "title": "Collect proof of the cancellation and expenses",
      "estimateMinutes": 30
    },
    {
      "title": "Prepare the final claim statement",
      "estimateMinutes": 60
    },
    {
      "title": "Prepare attachments and copies",
      "estimateMinutes": 30
    },
    {
      "title": "Submit the claim",
      "estimateMinutes": 30
    }
  ]
}
```

### Capability 4: carryover diagnosis

After a task has been carried over several times, the assistant asks one focused question:

> What is preventing you from continuing?

The answer should update structured task metadata:

```ts
type BlockReason =
  | "unclear_next_step"
  | "too_large"
  | "missing_information"
  | "fear_of_error"
  | "low_value"
  | "boring"
  | "external_dependency"
  | "other";
```

### Capability 5: end-of-day summary

The summary should focus on outcomes, not just task count.

Example:

```text
You completed your primary work outcome and spent 2 hours 10 minutes
on focused work.

You also completed one useful unplanned task.

The airline claim was carried over again because the next submission
step remains unclear.
```

---

## 4.5 Proactive AI rules

Do not allow the AI to send arbitrary messages whenever it wants.

Create deterministic triggers.

Examples:

```ts
type AssistantTrigger =
  | "morning_plan_missing"
  | "focus_session_idle"
  | "estimate_exceeded"
  | "task_repeatedly_carried"
  | "current_task_waiting"
  | "end_of_day_review"
  | "plan_over_capacity";
```

Each trigger invokes a specific prompt template.

### Example trigger

```text
Trigger: current_task_waiting
Condition:
- current task status is waiting;
- expected wait is at least 5 minutes;
- no other task is currently active.

Action:
- suggest up to three short tasks;
- only suggest work tasks during protected work hours.
```

This makes AI behavior testable and avoids random interruptions.

---

# 5. Chat architecture

The chat should not initially be a general-purpose chatbot.

It should be an interface to the task system.

### Supported intents

* create a task;
* update a task;
* plan today;
* explain today’s plan;
* break down a task;
* identify a blocker;
* review progress;
* find a task;
* reschedule a task.

### Conversation entities

```ts
type Conversation = {
  id: string;
  userId: string;
  createdAt: Date;
};

type ConversationMessage = {
  id: string;
  conversationId: string;

  role: "user" | "assistant" | "system";
  content: string;

  structuredAction?: Record<string, unknown>;

  createdAt: Date;
};
```

### Confirmation pattern

For actions that modify data, the assistant should show an action card:

```text
Create task

Prepare attachments for airline claim
Personal · 30 minutes · Due Friday

[Create] [Edit] [Cancel]
```

Simple low-risk actions can later become automatic, but confirmation is safer for the MVP.

---

# 6. Frontend architecture

## 6.1 Main screens

The MVP needs five primary screens.

### 1. Today

Contains:

* current time;
* workday range;
* primary outcome;
* secondary outcomes;
* optional queue;
* planned task blocks;
* start buttons;
* quick task capture.

The Today screen should not expose the entire backlog.

### 2. Focus

Contains:

* task title;
* current concrete action;
* elapsed time;
* start time;
* pause;
* waiting;
* blocked;
* complete;
* capture distraction.

The focus screen should be intentionally minimal.

### 3. Inbox

Contains newly captured tasks requiring processing.

### 4. Backlog

Contains accepted unscheduled tasks with filters:

* work;
* personal;
* due soon;
* postponed;
* blocked;
* projects.

### 5. Review

Contains:

* daily outcome summary;
* completed tasks;
* focused time;
* unplanned useful work;
* carried-over tasks;
* one AI recommendation.

---

## 6.2 Frontend state split

### Server state

Use TanStack Query for:

* tasks;
* daily plan;
* focus session;
* suggestions;
* analytics;
* user preferences.

### Local UI state

Use Zustand for:

* open modals;
* drag-and-drop draft state;
* unsaved task form;
* focus display preferences;
* temporary timer presentation.

The server should remain the source of truth for the active focus session.

---

## 6.3 Timer implementation

Do not update the server every second.

Store:

* session start time;
* pause intervals;
* current status.

The frontend calculates elapsed time locally:

```ts
elapsed =
  serverRecordedDuration +
  (currentStatus === "active"
    ? now - activeSegmentStartedAt
    : 0);
```

Synchronize when:

* session starts;
* session pauses;
* session resumes;
* session stops;
* browser regains focus;
* reconnect occurs.

This avoids unnecessary traffic and timer drift.

---

# 7. Real-time communication

Use Server-Sent Events rather than WebSockets for the MVP.

SSE is sufficient for:

* AI suggestion completed;
* background task completed;
* focus status changed in another tab;
* notification state updated;
* plan recalculated.

Client-to-server actions continue through regular HTTP requests.

WebSockets are unnecessary unless collaborative or high-frequency bidirectional functionality is introduced later.

---

# 8. Notifications

## Browser notifications

Use:

* Service Worker;
* Web Push;
* notification permission requested only after the user understands the benefit.

Useful notifications:

* morning planning reminder;
* current task waiting reminder;
* end-of-day review reminder;
* deadline risk;
* task carried over repeatedly.

Avoid notifications such as:

* generic motivation;
* frequent “stay focused” reminders;
* every AI message;
* every scheduled task start time.

### Notification record

```ts
type Notification = {
  id: string;
  userId: string;

  type: string;
  title: string;
  body: string;

  scheduledAt: Date;
  sentAt?: Date;
  readAt?: Date;

  relatedTaskId?: string;
};
```

---

# 9. Background jobs

Initially, a cron process inside the backend may be enough.

Jobs include:

* morning planning reminders;
* due-date checks;
* repeated carryover detection;
* end-of-day summaries;
* push notification delivery;
* asynchronous AI requests.

Once reliability matters, move these jobs to BullMQ with Redis.

### Recommended split

Use synchronous AI calls for:

* task extraction;
* quick decomposition;
* chat responses.

Use asynchronous jobs for:

* daily plan analysis;
* end-of-day summaries;
* weekly summaries;
* bulk backlog review.

---

# 10. Database model

Core tables:

```text
users
user_preferences

tasks
task_events
task_dependencies
projects

daily_plans
daily_plan_items

focus_sessions
focus_session_segments

conversations
conversation_messages

ai_suggestions
assistant_triggers

notifications
push_subscriptions

daily_reviews
```

## Focus session segments

Instead of calculating all time from task events, optionally store explicit segments:

```ts
type FocusSessionSegment = {
  id: string;
  focusSessionId: string;

  startedAt: Date;
  endedAt?: Date;

  type: "focused" | "paused" | "waiting";
};
```

This makes time accounting more reliable.

---

# 11. API design

## Tasks

```http
POST   /tasks
GET    /tasks
GET    /tasks/:id
PATCH  /tasks/:id
DELETE /tasks/:id

POST   /tasks/:id/archive
POST   /tasks/:id/complete
POST   /tasks/:id/decompose
GET    /tasks/:id/history
```

## Inbox

```http
GET  /inbox
POST /inbox/capture
POST /inbox/:id/process
```

## Daily planning

```http
GET    /daily-plans/today
POST   /daily-plans/today
PATCH  /daily-plans/today

POST   /daily-plans/today/items
PATCH  /daily-plans/today/items/:itemId
DELETE /daily-plans/today/items/:itemId

POST   /daily-plans/today/suggest
POST   /daily-plans/today/close
```

## Focus sessions

```http
GET  /focus/current
POST /focus/start
POST /focus/:id/pause
POST /focus/:id/resume
POST /focus/:id/wait
POST /focus/:id/block
POST /focus/:id/complete
POST /focus/:id/stop
```

## AI assistant

```http
POST /assistant/messages
GET  /assistant/conversations/:id
POST /assistant/suggestions/:id/accept
POST /assistant/suggestions/:id/reject
```

## Reviews

```http
GET  /reviews/daily/:date
POST /reviews/daily/:date/generate
GET  /reviews/weekly/:week
```

---

# 12. State transition rules

Task status transitions should be explicit.

```text
inbox
  ├── backlog
  ├── planned
  ├── archived
  └── cancelled

backlog
  ├── planned
  ├── in_progress
  ├── archived
  └── cancelled

planned
  ├── in_progress
  ├── backlog
  ├── completed
  └── cancelled

in_progress
  ├── waiting
  ├── blocked
  ├── completed
  └── backlog

waiting
  ├── in_progress
  ├── blocked
  ├── completed
  └── backlog

blocked
  ├── in_progress
  ├── backlog
  ├── cancelled
  └── completed
```

Implement transitions in one domain service rather than allowing controllers to update status fields directly.

Example:

```ts
taskLifecycleService.transition({
  taskId,
  userId,
  from: "in_progress",
  to: "waiting",
  reason: "Waiting for AI response",
});
```

---

# 13. Carryover logic

At the end of the day:

1. Completed plan items are marked completed.
2. Uncompleted items remain attached to the historical daily plan.
3. Their tasks return to the backlog.
4. A `carried_over` event is created.
5. Carryover count increases.
6. Repeated carryover may trigger an assistant intervention.

Do not automatically schedule unfinished tasks for tomorrow. That recreates an endlessly growing plan.

Suggested threshold:

```text
2 carryovers:
Show a soft warning.

3 carryovers:
Ask why the task is not progressing.

5 carryovers:
Require an explicit choice:
break down, postpone, archive, or recommit.
```

These numbers should remain configurable.

---

# 14. Protected work hours

Treat protected work hours as a preference, not an absolute database rule.

During work hours:

* hide personal tasks from suggestions;
* warn before starting a personal task;
* allow urgent exceptions;
* allow a planned personal-admin block.

Example:

```text
This is a personal task during your protected work period.

Start anyway?
[Start] [Schedule after work] [Cancel]
```

---

# 15. Analytics

The MVP needs only a small analytics layer.

Track:

* planned primary outcomes;
* completed primary outcomes;
* focus minutes;
* number of focus sessions;
* carryovers;
* estimated versus actual time;
* useful unplanned tasks;
* interruptions;
* blocked tasks.

Avoid a complicated productivity score.

### Daily outcome model

```ts
type DailyReview = {
  id: string;
  userId: string;
  date: string;

  primaryOutcomeCompleted: boolean;

  focusedMinutes: number;
  completedPlannedTasks: number;
  completedUnplannedTasks: number;
  carriedOverTasks: number;

  userReflection?: string;
  assistantSummary?: string;

  createdAt: Date;
};
```

---

# 16. Security and privacy

The assistant may receive sensitive personal and work-related task information.

Minimum requirements:

* encrypted HTTPS traffic;
* authenticated API access;
* user-scoped database queries;
* secrets stored outside source control;
* no raw prompts in general application logs;
* configurable AI history retention;
* task deletion that also removes associated AI context;
* rate limits on AI endpoints;
* audit history for assistant-created changes.

Do not train custom models or build embeddings infrastructure in the MVP.

PostgreSQL full-text search is sufficient initially.

---

# 17. Deployment architecture

A simple deployment is enough:

```text
Frontend:
Vercel, Cloudflare Pages, or static hosting

Backend:
One Docker container on a VPS or managed container platform

Database:
Managed PostgreSQL

Redis:
Managed Redis or Docker container, introduced when needed

Storage:
Not required initially unless attachments are added
```

### Environments

Maintain:

* local;
* staging;
* production.

### CI/CD

```text
Pull request
    │
    ├── Type check
    ├── Lint
    ├── Unit tests
    ├── Database migration validation
    └── Build

Merge to main
    │
    ├── Deploy backend
    ├── Run migrations
    └── Deploy frontend
```

---

# 18. Testing strategy

The highest-value tests are not AI snapshot tests. They are domain-state tests.

## Unit tests

Prioritize:

* task state transitions;
* one-active-session invariant;
* carryover logic;
* available-time calculations;
* over-capacity detection;
* work-hour filtering;
* estimate versus actual calculations.

## Integration tests

Test:

* starting and stopping focus sessions;
* scheduling tasks;
* closing a day;
* accepting AI suggestions;
* push-notification scheduling;
* authentication boundaries.

## AI evaluations

Create a small fixed evaluation dataset:

```text
20 task-capture examples
20 task-decomposition examples
20 daily-plan examples
10 carryover-diagnosis examples
```

Evaluate:

* valid structured output;
* correct task references;
* no invented deadlines;
* realistic estimates;
* useful decomposition;
* no unauthorized state changes.

---

# 19. MVP feature boundary

## Include

* authentication;
* quick task capture;
* inbox;
* backlog;
* daily planning;
* one primary outcome;
* one active focus session;
* pause, waiting, blocked, and complete states;
* distraction capture;
* task event history;
* AI daily-plan suggestions;
* AI task decomposition;
* carryover diagnosis;
* daily outcome summary;
* browser notifications.

## Exclude

* teams;
* shared tasks;
* mobile applications;
* Telegram bot;
* advanced projects;
* recurring-task engine;
* complex dependencies;
* monthly planning;
* public integrations;
* calendar synchronization;
* email processing;
* elaborate gamification;
* autonomous AI changes;
* vector databases;
* microservices;
* custom AI models.

---

# 20. Implementation phases

## Phase 1: deterministic execution loop

Build without AI first:

```text
Capture task
→ Process inbox
→ Plan today
→ Start one task
→ Pause/wait/complete
→ Close day
→ Carry unfinished work over
→ View daily outcome
```

This validates the core state model.

## Phase 2: AI assistance

Add:

* natural-language task capture;
* task decomposition;
* daily plan suggestions;
* carryover diagnosis;
* outcome summaries.

## Phase 3: behavior support

Add:

* distraction capture;
* waiting-state task suggestions;
* browser notifications;
* protected work hours;
* estimate learning.

## Phase 4: product refinement

Based on actual usage, consider:

* week planning;
* projects;
* recurring tasks;
* calendar integration;
* mobile companion;
* reward mechanics.

---

# 21. Recommended repository structure

```text
execution-assistant/
├── apps/
│   ├── web/
│   │   ├── src/
│   │   │   ├── features/
│   │   │   │   ├── tasks/
│   │   │   │   ├── inbox/
│   │   │   │   ├── daily-plan/
│   │   │   │   ├── focus/
│   │   │   │   ├── assistant/
│   │   │   │   └── reviews/
│   │   │   ├── components/
│   │   │   ├── api/
│   │   │   └── routes/
│   │   └── package.json
│   │
│   └── api/
│       ├── src/
│       │   ├── modules/
│       │   │   ├── auth/
│       │   │   ├── tasks/
│       │   │   ├── inbox/
│       │   │   ├── daily-plans/
│       │   │   ├── focus/
│       │   │   ├── assistant/
│       │   │   ├── notifications/
│       │   │   └── reviews/
│       │   ├── jobs/
│       │   ├── database/
│       │   └── common/
│       └── package.json
│
├── packages/
│   ├── contracts/
│   ├── domain/
│   ├── ui/
│   └── config/
│
├── prisma/
│   └── schema.prisma
│
├── docker-compose.yml
└── package.json
```

Use a monorepo with shared API contracts and domain types.

---

# 22. The most important architectural decision

The product should not be built around an AI chat.

It should be built around a deterministic execution loop:

```text
Choose
→ Start
→ Stay with the task
→ Capture distractions
→ Finish or consciously stop
→ Reflect
```

AI should support this loop at specific moments.

That design keeps the product useful when the AI is slow, unavailable, wrong, or unnecessary. It also prevents the assistant itself from becoming another form of procrastination.
