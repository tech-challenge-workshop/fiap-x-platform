# Email Notification (S7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send exactly one real SMTP email (success or failure template) per terminal event, with the recipient resolved once from the JWT's standard `email` claim and carried structurally to the terminal event only — closing RF-5.

**Architecture:** The owner's email is captured at the API from the already-verified token, stored on `processing-catalog`'s `ProcessingRequest`, and added only to the terminal event `notification-service` consumes. `notification-service` gains an `EmailSender` port (SMTP adapter via `nodemailer`, Mailpit locally) and two plain-function templates; the existing `DeliveryRecord`'s dedup-by-`eventId` gains two nullable outcome fields (`emailSentAt`/`emailError`) that gate the one send attempt independently of whether the row was just created — so a crash between saving the record and sending the email is recovered by redelivery without ever sending twice. `fiap-x-platform` adds Mailpit to the topology and two smoke steps that prove the email actually landed.

**Tech Stack:** NestJS/TypeScript, TypeORM/PostgreSQL, RabbitMQ (`@nestjs/microservices`), `nodemailer` (new), Mailpit (`axllent/mailpit`, Docker Compose), Jest.

**Spec:**
- `fiap-x-api/.specs/features/email-notification/{spec,design}.md`
- `processing-catalog/.specs/features/email-notification/{spec,design}.md`
- `notification-service/.specs/features/email-notification/{spec,design}.md`
- `fiap-x-platform/.specs/features/email-notification/{spec,design}.md`

## Global Constraints

- No automatic retry of a failed email send — one attempt per terminal event (foundation rule, restated in every spec's Out of Scope).
- Only `sub`, `iss`, `aud`, `exp` may influence any authorization decision; `email` must never enter one, in `fiap-x-api`'s `TokenVerifier`/`JwtAuthGuard`.
- `ownerEmail` SHALL NOT appear on `VideoValidationRequested`, `ProcessingQueued`, or `ProcessingStarted` — only on the terminal event (`processing-catalog` spec EN-09).
- A failure email SHALL contain only the safe `failureReason` and `processingRequestId` — no internal detail, no storage key (`notification-service` spec EN-15).
- No templating-engine dependency and no Keycloak Admin API dependency — resolved once, from the token's own `email` claim (AD-015).
- `emailError` SHALL NOT contain the raw transport error, stack, or any credential/connection string (`notification-service` spec EN-20).
- The Mailpit image tag and its HTTP search-query syntax are verified against the running, pinned version during implementation, never assumed (both platform specs' open questions).

## Review Focus

- A confirmed upload whose token lacks the `email` claim must fail clearly (400) and create nothing — not silently produce a request nobody can ever be notified about. *(fiap-x-api spec EN-03)*
- Redelivery of the same terminal `eventId` after a crash between saving the delivery row and sending the email must still get exactly one send attempt — not zero, not two. *(notification-service spec EN-14)*
- A failed SMTP send must not requeue the message, must not touch `ProcessingRequest` state, and must never persist the raw transport error. *(notification-service spec EN-16, EN-18, EN-20)*
- `ownerEmail` must not leak onto a non-terminal event even if a future edit reuses an existing event-builder object literal as a shortcut. *(processing-catalog spec EN-09, design.md Risks)*
- Running the smoke twice against the same, non-torn-down stack (as the build gate's force-recreate step does) must not let an earlier run's Mailpit messages produce a false "more than one" — or mask a real duplicate — on the current run. *(fiap-x-platform spec EN-26, design.md Risks)*

---

## Task 1: `processing-catalog` — `ownerEmail` on the domain aggregate

**Files:**
- Modify: `processing-catalog/src/domain/processing-request.ts`
- Test: `processing-catalog/src/domain/processing-request.spec.ts`

**Interfaces:**
- Produces: `ProcessingRequest.ownerEmail: string`; `CreateProcessingRequestInput.ownerEmail: string`; `createProcessingRequest(input)` now requires and validates it.

- [ ] **Step 1: Write the failing tests**

Add to `processing-catalog/src/domain/processing-request.spec.ts`, in the existing `describe('ProcessingRequest', ...)` block:

```ts
it('creates a request carrying the owner email it was created with', () => {
  const request = createProcessingRequest({
    ownerUserId: 'user-123',
    sourceStorageKey: 'videos/input.mp4',
    ownerEmail: 'alice@fiapx.local',
  });

  expect(request.ownerEmail).toBe('alice@fiapx.local');
});

it('rejects creation when ownerEmail is missing', () => {
  expect(() =>
    createProcessingRequest({
      ownerUserId: 'user-123',
      sourceStorageKey: 'videos/input.mp4',
      ownerEmail: '',
    }),
  ).toThrow('ownerEmail is required');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- processing-request.spec.ts`
Expected: FAIL — `ownerEmail is required` never thrown (property doesn't exist yet / no validation).

- [ ] **Step 3: Implement**

In `src/domain/processing-request.ts`, add the field to both interfaces and validate it in `createProcessingRequest`:

```ts
export interface ProcessingRequest {
  processingRequestId: string;
  ownerUserId: string;
  ownerEmail: string;
  sourceStorageKey: string;
  // ...unchanged fields below
}

export interface CreateProcessingRequestInput {
  ownerUserId: string;
  ownerEmail: string;
  sourceStorageKey: string;
  idempotencyKey?: string;
}
```

In `createProcessingRequest`, right after the existing `ownerUserId` check:

```ts
  if (!input.ownerEmail || input.ownerEmail.trim().length === 0) {
    throw new ProcessingRequestDomainError('ownerEmail is required');
  }
```

And add `ownerEmail: input.ownerEmail` to the returned object literal.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- processing-request.spec.ts`
Expected: PASS (all tests in the file, including the two new ones and every pre-existing `createProcessingRequest({...})` call — check every other call site in this file already omits `ownerEmail`; add `ownerEmail: 'alice@fiapx.local'` to each so they keep passing).

- [ ] **Step 5: Commit**

```bash
git add src/domain/processing-request.ts src/domain/processing-request.spec.ts
git commit -m "feat(catalog): require ownerEmail on ProcessingRequest creation"
```

---

## Task 2: `processing-catalog` — persist `owner_email`

**Files:**
- Modify: `processing-catalog/src/infrastructure/persistence/processing-request.entity.ts`
- Modify: `processing-catalog/src/infrastructure/persistence/typeorm-processing-request.repository.ts`
- Create: `processing-catalog/src/infrastructure/persistence/migrations/1789958000000-AddOwnerEmail.ts`
- Test: `processing-catalog/test/persistence.e2e-spec.ts` (existing integration suite against real Postgres, gated the same way as `durability.e2e-spec.ts`)

**Interfaces:**
- Consumes: `ProcessingRequest.ownerEmail` from Task 1.
- Produces: `owner_email` column, mapped both ways in `toDomain`/`toRow`.

- [ ] **Step 1: Write the failing test**

Check the guard `persistence.e2e-spec.ts` uses (e.g. `process.env.DATABASE_HOST ? describe : describe.skip`) and add, in its existing repository round-trip describe block:

```ts
it('round-trips ownerEmail through the database', async () => {
  const request = createProcessingRequest({
    ownerUserId: 'user-123',
    sourceStorageKey: 'videos/input.mp4',
    ownerEmail: 'alice@fiapx.local',
    idempotencyKey: randomUUID(),
  });

  await repository.save(request);
  const found = await repository.findByProcessingRequestId(
    request.processingRequestId,
  );

  expect(found?.ownerEmail).toBe('alice@fiapx.local');
});
```

(Match the exact imports/setup already at the top of that file — `createProcessingRequest`, `randomUUID`, and whatever `repository` variable name the existing `beforeAll`/`beforeEach` in that file already uses.)

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_HOST=localhost DATABASE_PORT=55432 DATABASE_NAME=fiapx DATABASE_SCHEMA=catalog DATABASE_USER=catalog DATABASE_PASSWORD=catalog npm run test:e2e -- persistence.e2e-spec.ts` (against the running `fiap-x-platform` stack; adjust the port to whatever `POSTGRES_HOST_PORT` is exported as)
Expected: FAIL — `found?.ownerEmail` is `undefined`, or the insert fails with a missing-column error once Step 1's domain change is in place (the entity has no such column yet).

- [ ] **Step 3: Implement**

Add the migration, following `1789956000000-AddIdempotencyKey.ts`'s exact shape:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOwnerEmail1789958000000 implements MigrationInterface {
  name = 'AddOwnerEmail1789958000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // NOT NULL, no default: this is a local-dev system with no rows to
    // preserve across the schema change (see design.md's Tech Decisions).
    await queryRunner.query(`
      ALTER TABLE processing_request
        ADD COLUMN IF NOT EXISTS owner_email text NOT NULL DEFAULT ''
    `);
    await queryRunner.query(`
      ALTER TABLE processing_request ALTER COLUMN owner_email DROP DEFAULT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE processing_request DROP COLUMN IF EXISTS owner_email`,
    );
  }
}
```

(The `DEFAULT ''` then `DROP DEFAULT` two-step lets the migration apply even if `processing_request` already has rows from an earlier feature's manual testing, without making the column nullable going forward — new inserts still fail without a real value.)

Add the column to the entity, right after `ownerUserId`:

```ts
@Column({ name: 'owner_email', type: 'text' })
ownerEmail: string;
```

Update `toDomain` and `toRow` in `typeorm-processing-request.repository.ts`:

```ts
function toDomain(row: ProcessingRequestEntity): ProcessingRequest {
  return {
    processingRequestId: row.processingRequestId,
    ownerUserId: row.ownerUserId,
    ownerEmail: row.ownerEmail,
    sourceStorageKey: row.sourceStorageKey,
    // ...unchanged
  };
}

function toRow(request: ProcessingRequest): ProcessingRequestEntity {
  const row = new ProcessingRequestEntity();
  row.processingRequestId = request.processingRequestId;
  row.ownerUserId = request.ownerUserId;
  row.ownerEmail = request.ownerEmail;
  row.sourceStorageKey = request.sourceStorageKey;
  // ...unchanged
  return row;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/persistence/processing-request.entity.ts \
        src/infrastructure/persistence/typeorm-processing-request.repository.ts \
        src/infrastructure/persistence/migrations/1789958000000-AddOwnerEmail.ts \
        test/persistence.e2e-spec.ts
git commit -m "feat(catalog): persist owner_email on processing_request"
```

---

## Task 3: `processing-catalog` — accept `ownerEmail` at the HTTP boundary, keep it off non-terminal events

**Files:**
- Modify: `processing-catalog/src/interface/create-processing-request.dto.ts`
- Modify: `processing-catalog/src/interface/create-processing-request.controller.ts`
- Modify: `processing-catalog/src/application/create-processing-request.use-case.ts`
- Test: `processing-catalog/src/interface/create-processing-request.controller.spec.ts`
- Test: `processing-catalog/src/application/create-processing-request.use-case.spec.ts`

**Interfaces:**
- Consumes: `ProcessingRequest`/`createProcessingRequest` from Task 1.
- Produces: `POST /processing-requests` accepts `ownerEmail`; `CreateProcessingRequestUseCase.execute` takes it in its input and never puts it on `VideoValidationRequested`.

- [ ] **Step 1: Write the failing tests**

In `create-processing-request.controller.spec.ts`, add to the existing `it('creates a processing request...')` test's request body and a new rejection test:

```ts
it('creates a processing request and returns its public fields', async () => {
  const response = await request.post('/processing-requests').send({
    ownerUserId: 'user-123',
    ownerEmail: 'alice@fiapx.local',
    sourceStorageKey: 'videos/input.mp4',
    idempotencyKey: 'key-1',
  });
  // ...existing assertions unchanged
});

it('rejects a missing ownerEmail with 400', async () => {
  const response = await request.post('/processing-requests').send({
    ownerUserId: 'user-123',
    sourceStorageKey: 'videos/input.mp4',
    idempotencyKey: 'key-1',
  });

  expect(response.status).toBe(400);
  expect((response.body as { message: string }).message).toBe(
    'ownerEmail is required',
  );
});
```

In `create-processing-request.use-case.spec.ts`, add a negative-leak assertion to the existing first test (`'creates a request in RECEIVED state and publishes VideoValidationRequested'`):

```ts
it('creates a request in RECEIVED state and publishes VideoValidationRequested', async () => {
  const { request } = await useCase.execute({
    eventId: 'event-123',
    ownerUserId: 'user-123',
    ownerEmail: 'alice@fiapx.local',
    sourceStorageKey: 'videos/input.mp4',
    idempotencyKey: 'key-123',
  });

  expect(request.ownerEmail).toBe('alice@fiapx.local');
  // ...existing assertions unchanged

  const published = outbox.recordedValidationRequests.at(-1);
  expect(published).toBeDefined();
  expect(published).not.toHaveProperty('ownerEmail'); // Global Constraint: never on this event
  // ...existing assertions unchanged
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- create-processing-request.use-case.spec.ts create-processing-request.controller.spec.ts`
Expected: FAIL — `CreateProcessingRequestInput` has no `ownerEmail`, so `request.ownerEmail` is `undefined`; the DTO has no such field, so the 400 rejection test gets a different (or no) rejection.

- [ ] **Step 3: Implement**

`create-processing-request.dto.ts`:

```ts
export class CreateProcessingRequestDto {
  ownerUserId!: string;
  ownerEmail!: string;
  sourceStorageKey!: string;
  idempotencyKey!: string;
}
```

`create-processing-request.controller.ts` — add to `validateDto` and the `execute` call:

```ts
private validateDto(dto: CreateProcessingRequestDto): void {
  requireString(dto, 'ownerUserId', MAX_OWNER_USER_ID_LENGTH);
  requireString(dto, 'ownerEmail', MAX_OWNER_EMAIL_LENGTH);
  requireString(dto, 'sourceStorageKey', MAX_SOURCE_STORAGE_KEY_LENGTH);
  requireString(dto, 'idempotencyKey', MAX_IDEMPOTENCY_KEY_LENGTH);
}
```

```ts
const MAX_OWNER_EMAIL_LENGTH = 255;
```

and in `create`:

```ts
const { request, outcome } =
  await this.createProcessingRequestUseCase.execute({
    eventId: randomUUID(),
    ownerUserId: dto.ownerUserId,
    ownerEmail: dto.ownerEmail,
    sourceStorageKey: dto.sourceStorageKey,
    idempotencyKey: dto.idempotencyKey,
  });
```

`create-processing-request.use-case.ts` — add `ownerEmail` to `CreateProcessingRequestInput`, pass it to `createProcessingRequest`, and confirm the `VideoValidationRequestedEvent` object literal (a few lines below) is left untouched — it must still list exactly `eventId, processingRequestId, ownerUserId, sourceStorageKey, occurredAt`:

```ts
export interface CreateProcessingRequestInput {
  eventId: string;
  ownerUserId: string;
  ownerEmail: string;
  sourceStorageKey: string;
  idempotencyKey: string;
}
```

```ts
const request = createProcessingRequest({
  ownerUserId: input.ownerUserId,
  ownerEmail: input.ownerEmail,
  sourceStorageKey: input.sourceStorageKey,
  idempotencyKey: input.idempotencyKey,
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/interface/create-processing-request.dto.ts \
        src/interface/create-processing-request.controller.ts \
        src/interface/create-processing-request.controller.spec.ts \
        src/application/create-processing-request.use-case.ts \
        src/application/create-processing-request.use-case.spec.ts
git commit -m "feat(catalog): accept ownerEmail at creation, keep it off VideoValidationRequested"
```

---

## Task 4: `processing-catalog` — carry `ownerEmail` on the terminal event only

**Files:**
- Modify: `processing-catalog/src/messaging/dto/terminal-event.dto.ts`
- Modify: `processing-catalog/src/application/complete-processing-request.use-case.ts`
- Modify: `processing-catalog/src/application/fail-processing-request.use-case.ts`
- Test: `processing-catalog/src/application/complete-processing-request.use-case.spec.ts`
- Test: `processing-catalog/src/application/fail-processing-request.use-case.spec.ts`

**Interfaces:**
- Consumes: `ProcessingRequest.ownerEmail` from Task 1; `createQueuedRequest()`/`received()` test helpers already in both spec files (must pass `ownerEmail` to the `CreateProcessingRequestUseCase.execute` call they make, per Task 3's now-required field).
- Produces: `TerminalEventDto.ownerEmail`.

- [ ] **Step 1: Write the failing tests**

In `complete-processing-request.use-case.spec.ts`, update `createQueuedRequest`'s `execute` call to pass `ownerEmail: 'alice@fiapx.local'` (required since Task 3), then extend the first test:

```ts
it('transitions a request from QUEUED to COMPLETED and publishes TerminalEvent', async () => {
  const request = await createQueuedRequest();
  // ...unchanged setup

  const updated = await useCase.execute({ /* unchanged */ });

  // ...existing assertions unchanged
  expect(published?.ownerEmail).toBe('alice@fiapx.local');
});
```

In `fail-processing-request.use-case.spec.ts`, update `received()`'s `execute` call the same way, then extend `'fails a RECEIVED request and publishes one terminal event'`:

```ts
const received = async () =>
  (
    await new CreateProcessingRequestUseCase(repository, unitOfWork).execute({
      eventId: randomUUID(),
      ownerUserId: 'user-123',
      ownerEmail: 'alice@fiapx.local',
      sourceStorageKey: 'videos/input.mp4',
      idempotencyKey: randomUUID(),
    })
  ).request;
```

```ts
it('fails a RECEIVED request and publishes one terminal event', async () => {
  const request = await received();
  // ...unchanged

  const published = outbox.recordedTerminalEvents.at(-1);
  expect(published?.ownerEmail).toBe('alice@fiapx.local');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- complete-processing-request.use-case.spec.ts fail-processing-request.use-case.spec.ts`
Expected: FAIL — `published?.ownerEmail` is `undefined`.

- [ ] **Step 3: Implement**

`terminal-event.dto.ts`:

```ts
export interface TerminalEventDto {
  eventId: string;
  processingRequestId: string;
  ownerUserId: string;
  ownerEmail: string;
  status: ProcessingRequestStatus;
  zipStorageKey?: string;
  failureReason?: string;
  attemptId?: string;
  occurredAt: string;
}
```

In `complete-processing-request.use-case.ts`, add one key to the existing `ctx.outbox.add(EVENT_ROUTES.TerminalEvent...)` payload:

```ts
await ctx.outbox.add(
  EVENT_ROUTES.TerminalEvent.queue,
  EVENT_ROUTES.TerminalEvent.pattern,
  {
    eventId: randomUUID(),
    processingRequestId: updated.processingRequestId,
    ownerUserId: updated.ownerUserId,
    ownerEmail: updated.ownerEmail,
    status: updated.status,
    zipStorageKey: updated.zipStorageKey,
    attemptId: updated.attemptId,
    occurredAt: input.occurredAt,
  },
);
```

Same change in `fail-processing-request.use-case.ts`'s outbox payload (add `ownerEmail: updated.ownerEmail` alongside the existing `ownerUserId: updated.ownerUserId`).

- [ ] **Step 4: Run tests to verify they pass**

Run: same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/messaging/dto/terminal-event.dto.ts \
        src/application/complete-processing-request.use-case.ts \
        src/application/complete-processing-request.use-case.spec.ts \
        src/application/fail-processing-request.use-case.ts \
        src/application/fail-processing-request.use-case.spec.ts
git commit -m "feat(catalog): carry ownerEmail on the terminal event only"
```

---

## Task 5: `fiap-x-api` — read the token's standard `email` claim

**Files:**
- Modify: `fiap-x-api/src/auth/token-verifier.ts`
- Test: `fiap-x-api/src/auth/token-verifier.spec.ts`

**Interfaces:**
- Produces: `TokenVerifier.verify(token): Promise<{ sub: string; email?: string }>`.

- [ ] **Step 1: Write the failing tests**

The existing test `'returns only the sub of a valid token, whatever else it carries'` (line 50) asserts `toStrictEqual({ sub: 'alice' })` for a token that includes `email: 'alice@example.com'` — that assertion is the one this task changes on purpose. Update it and add one more:

```ts
it("returns the sub and email of a valid token, and nothing else it carries", async () => {
  const token = await signToken(key, {
    email: 'alice@example.com',
    preferred_username: 'alice',
    realm_access: { roles: ['admin'] },
  });

  await expect(verifier.verify(token)).resolves.toStrictEqual({
    sub: 'alice',
    email: 'alice@example.com',
  });
});

it('returns email undefined when the token carries none', async () => {
  const token = await signToken(key, { preferred_username: 'alice' });

  await expect(verifier.verify(token)).resolves.toStrictEqual({
    sub: 'alice',
  });
});

it('treats a non-string email claim as absent', async () => {
  const token = await signToken(key, { email: 12345 });

  await expect(verifier.verify(token)).resolves.toStrictEqual({
    sub: 'alice',
  });
});
```

Also update every other existing test in this file that asserts `toStrictEqual({ sub: 'alice' })` against a token signed without an `email` claim (e.g. `'accepts an aud array...'`) — those keep passing unchanged, since `signToken(key, {...})` in this file signs `sub: 'alice'` by default and none of those payloads add `email`, so `{ sub: 'alice' }` (no `email` key) is still exactly right once the implementation only adds `email` to the returned object when the claim is actually a non-empty string.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- token-verifier.spec.ts`
Expected: FAIL on the renamed/new tests — `verify` still returns only `{ sub }`.

- [ ] **Step 3: Implement**

```ts
export class TokenVerifier {
  constructor(
    private readonly keys: SigningKeyCache,
    private readonly options: TokenVerifierOptions,
  ) {}

  async verify(token: string): Promise<{ sub: string; email?: string }> {
    const { payload } = await jwtVerify(token, this.keys.keyFor, {
      issuer: this.options.issuer,
      audience: this.options.audience,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'sub'],
    });
    if (typeof payload.sub !== 'string' || payload.sub === '') {
      throw new errors.JWTClaimValidationFailed(
        '"sub" claim must be a non-empty string',
        payload,
        'sub',
        'check_failed',
      );
    }
    return typeof payload.email === 'string' && payload.email !== ''
      ? { sub: payload.sub, email: payload.email }
      : { sub: payload.sub };
  }
}
```

Update the class comment above it (currently: `"Verifies a compact JWT and returns its sub and nothing else, so no other claim can reach an authorization decision (AC P1.9)."`) to:

```ts
/**
 * Verifies a compact JWT and returns its `sub` and, when present, its
 * standard `email` claim. Nothing else is read. `email` never enters any
 * authorization decision (AC P1.9 still holds for `sub`) — it exists only
 * so the caller can pass it on for notification purposes.
 */
```

- [ ] **Step 4: Run tests to verify they pass**

Run: same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth/token-verifier.ts src/auth/token-verifier.spec.ts
git commit -m "feat(api): read the token's standard email claim in TokenVerifier"
```

---

## Task 6: `fiap-x-api` — carry the email through the guard to the Catalog call

**Files:**
- Modify: `fiap-x-api/src/auth/jwt-auth.guard.ts`
- Create: `fiap-x-api/src/auth/owner-email.decorator.ts`
- Modify: `fiap-x-api/src/uploads/complete-upload.service.ts`
- Modify: `fiap-x-api/src/uploads/uploads.controller.ts`
- Modify: `fiap-x-api/src/processing-requests/ports/catalog-client.port.ts`
- Modify: `fiap-x-api/src/processing-requests/adapters/http-catalog-client.adapter.ts`
- Modify: `fiap-x-api/src/processing-requests/adapters/in-memory-catalog-client.adapter.ts`
- Test: `fiap-x-api/test/complete-upload.e2e-spec.ts`

**Interfaces:**
- Consumes: `TokenVerifier.verify()`'s widened return from Task 5.
- Produces: `AuthenticatedRequest.ownerEmail?: string`; `@OwnerEmail()` decorator; `CompleteUploadService.execute(owner, ownerEmail, uploadId, idempotencyKey)`; `CatalogClient.createProcessingRequest(ownerUserId, ownerEmail, sourceStorageKey, idempotencyKey)`.

- [ ] **Step 1: Write the failing tests**

Add to `test/complete-upload.e2e-spec.ts` (mirroring the existing `it("completes the upload and creates one request...")` test's structure, using `idp.token({ sub, email })`):

```ts
it('rejects confirmation with 400 when the token carries no email claim, and creates nothing', async () => {
  const noEmailToken = await idp.token({ sub: 'alice' });
  const upload = await uploaded(20 * MiB, noEmailToken);

  const res = await confirm(app, noEmailToken, upload.uploadId, 'key-no-email');

  expect(res.status).toBe(400);
  expect(res.body).toEqual({
    statusCode: 400,
    message: 'The authenticated token does not carry an email claim',
  });
  expect(await requestsOf('alice')).toEqual([]);
});

it('passes the token email to the Catalog on confirmation', async () => {
  const withEmail = await idp.token({ sub: 'alice', email: 'alice@fiapx.local' });
  const upload = await uploaded(20 * MiB, withEmail);
  const createSpy = jest.spyOn(catalog, 'createProcessingRequest');

  await confirm(app, withEmail, upload.uploadId, 'key-with-email').expect(201);

  expect(createSpy).toHaveBeenCalledWith(
    'alice',
    'alice@fiapx.local',
    `sources/alice/${upload.uploadId}.mp4`,
    'key-with-email',
  );
});

it('never logs the owner email', async () => {
  const withEmail = await idp.token({ sub: 'alice', email: 'alice@fiapx.local' });
  const upload = await uploaded(20 * MiB, withEmail);

  await confirm(app, withEmail, upload.uploadId, 'key-log-check').expect(201);

  expect(logger.lines.join('\n')).not.toContain('alice@fiapx.local');
});
```

(`beforeAll` in this file currently sets `alice = await idp.token({ sub: 'alice' })` with no `email` — update it to `alice = await idp.token({ sub: 'alice', email: 'alice@fiapx.local' })` and `bob` the same way with `bob@fiapx.local`, since every *other* existing test in this file confirms uploads as `alice`/`bob` and must keep working once `ownerEmail` becomes required.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:e2e -- complete-upload.e2e-spec.ts`
Expected: FAIL — no 400 is raised for a missing claim yet, and `createSpy` isn't called with an email argument yet (still the 3-argument signature).

- [ ] **Step 3: Implement**

`jwt-auth.guard.ts` — widen the request type and assignment:

```ts
export interface AuthenticatedRequest extends Request {
  owner: string;
  ownerEmail?: string;
}
```

```ts
try {
  const verified = await this.verifier.verify(token);
  request.owner = verified.sub;
  request.ownerEmail = verified.email;
  return true;
} catch (error) {
  // ...unchanged
}
```

`src/auth/owner-email.decorator.ts` (new, mirrors `owner.decorator.ts`):

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequest } from './jwt-auth.guard';

/** The authenticated caller's `email` claim, stored on the request by JwtAuthGuard. */
export const OwnerEmail = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().ownerEmail,
);
```

`complete-upload.service.ts` — require it before anything else, and thread it through:

```ts
async execute(
  owner: string,
  ownerEmail: string | undefined,
  uploadId: string,
  idempotencyKey: string | undefined,
): Promise<ConfirmedUpload> {
  if (!ownerEmail?.trim()) {
    throw new BadRequestException(
      'The authenticated token does not carry an email claim',
    );
  }
  if (!idempotencyKey?.trim()) {
    throw new BadRequestException('Idempotency-Key header is required');
  }
  // ...unchanged validation
```

and in `private async create(...)`:

```ts
private async create(
  owner: string,
  ownerEmail: string,
  key: string,
  idempotencyKey: string,
): Promise<CatalogCreateOutcome> {
  try {
    return await this.catalog.createProcessingRequest(
      owner,
      ownerEmail,
      key,
      idempotencyKey,
    );
  } catch (error) {
    // ...unchanged
  }
}
```

(update the one call site of `this.create(...)` inside `execute` to pass `ownerEmail` too.)

`uploads.controller.ts` — inject the new decorator into the confirm route handler, alongside the existing `@Owner()`:

```ts
@Post(':uploadId/complete')
async complete(
  @Owner() owner: string,
  @OwnerEmail() ownerEmail: string | undefined,
  @Param('uploadId') uploadId: string,
  @Headers('idempotency-key') idempotencyKey: string | undefined,
) {
  return this.completeUploadService.execute(owner, ownerEmail, uploadId, idempotencyKey);
}
```

(Match the exact existing handler name/decorators in this file — this shows the one line that changes: adding the `@OwnerEmail()` parameter and passing it through.)

`catalog-client.port.ts`:

```ts
export interface CatalogClient {
  createProcessingRequest(
    ownerUserId: string,
    ownerEmail: string,
    sourceStorageKey: string,
    idempotencyKey: string,
  ): Promise<CatalogCreateOutcome>;
  // ...unchanged
}
```

`http-catalog-client.adapter.ts`:

```ts
async createProcessingRequest(
  ownerUserId: string,
  ownerEmail: string,
  sourceStorageKey: string,
  idempotencyKey: string,
): Promise<CatalogCreateOutcome> {
  const { status, data } = await this.request(
    `${this.catalogBaseUrl}/processing-requests`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerUserId, ownerEmail, sourceStorageKey, idempotencyKey }),
    },
  );
  // ...unchanged
}
```

`in-memory-catalog-client.adapter.ts` — add `ownerEmail` to `StoredRequest`, the method signature, and the stored object:

```ts
interface StoredRequest extends CatalogOwnedItem {
  ownerUserId: string;
  ownerEmail: string;
  sourceStorageKey: string;
  idempotencyKey: string;
  zipStorageKey?: string;
}
```

```ts
createProcessingRequest(
  ownerUserId: string,
  ownerEmail: string,
  sourceStorageKey: string,
  idempotencyKey: string,
): Promise<CatalogCreateOutcome> {
  // ...unchanged rejection/lookup logic

  this.idSequence += 1;
  const now = new Date().toISOString();
  const request: StoredRequest = {
    processingRequestId: `pr-${ownerUserId}-${sourceStorageKey}-${this.idSequence}`,
    status: 'RECEIVED',
    ownerUserId,
    ownerEmail,
    sourceStorageKey,
    idempotencyKey,
    createdAt: now,
    updatedAt: now,
  };
  this.requests.push(request);
  return Promise.resolve({ ...request, outcome: 'created' });
}
```

Check `in-memory-catalog-client.adapter.spec.ts` for any direct call to `createProcessingRequest(...)` with the old 3-argument signature and update each to pass an email as the second argument (e.g. `'alice@fiapx.local'`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:e2e -- complete-upload.e2e-spec.ts` and `npm test -- in-memory-catalog-client.adapter.spec.ts http-catalog-client.adapter.spec.ts`
Expected: PASS. Also run the full suite once (`npm test && npm run test:e2e`) since `uploads.controller.ts`/`CatalogClient` are used by other e2e files (`processing-requests.e2e-spec.ts`, `start-upload.e2e-spec.ts`, etc.) that construct `InMemoryCatalogClient` or call the controller — fix any call site the type checker flags.

- [ ] **Step 5: Commit**

```bash
git add src/auth/jwt-auth.guard.ts src/auth/owner-email.decorator.ts \
        src/uploads/complete-upload.service.ts src/uploads/uploads.controller.ts \
        src/processing-requests/ports/catalog-client.port.ts \
        src/processing-requests/adapters/http-catalog-client.adapter.ts \
        src/processing-requests/adapters/in-memory-catalog-client.adapter.ts \
        src/processing-requests/adapters/in-memory-catalog-client.adapter.spec.ts \
        test/complete-upload.e2e-spec.ts
git commit -m "feat(api): require the owner's email claim and carry it to the Catalog"
```

---

## Task 7: `notification-service` — require `ownerEmail` on the terminal event contract

**Files:**
- Modify: `notification-service/src/notifications/dtos/terminal-event.dto.ts`
- Modify: `notification-service/src/notifications/application/notification-delivery.service.ts`
- Test: `notification-service/src/notifications/application/notification-delivery.service.spec.ts`
- Modify: `notification-service/test/durable-persistence.e2e-spec.ts` (fixtures only, to keep compiling/passing)

**Interfaces:**
- Produces: `TerminalEventDto.ownerEmail: string`; `recordDelivery` throws `InvalidTerminalEventError('MISSING_OWNER_EMAIL')` for a missing/blank one.

- [ ] **Step 1: Write the failing tests**

First, update the existing fixture at the top of `notification-delivery.service.spec.ts` — every existing test uses it, so this one change is what keeps them all passing once validation is added:

```ts
const validCompletedEvent = (): TerminalEventDto => ({
  eventId: 'evt-1',
  processingRequestId: 'req-1',
  ownerUserId: 'user-1',
  ownerEmail: 'owner@example.com',
  status: 'COMPLETED',
  zipStorageKey: 'zip-1',
  occurredAt: '2026-08-27T00:00:00Z',
});
```

Then add, inside the `describe('payload consistency', ...)` block:

```ts
it('rejects an event with no ownerEmail and records nothing', async () => {
  await expect(
    service.recordDelivery({ ...validCompletedEvent(), ownerEmail: '' }),
  ).rejects.toMatchObject({ code: 'MISSING_OWNER_EMAIL' });

  await expect(repository.findByEventId('evt-1')).resolves.toBeUndefined();
});

it('treats a whitespace-only ownerEmail as absent', async () => {
  await expect(
    service.recordDelivery({ ...validCompletedEvent(), ownerEmail: '   ' }),
  ).rejects.toMatchObject({ code: 'MISSING_OWNER_EMAIL' });
});
```

Also update `test/durable-persistence.e2e-spec.ts`'s `completedEvent()`/`failedEvent()` fixtures to add `ownerEmail: 'owner@example.com'`, so that gated integration suite keeps compiling and passing.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- notification-delivery.service.spec.ts`
Expected: FAIL — no `MISSING_OWNER_EMAIL` code exists yet.

- [ ] **Step 3: Implement**

`terminal-event.dto.ts`:

```ts
export class TerminalEventDto {
  eventId: string;
  processingRequestId: string;
  ownerUserId: string;
  ownerEmail: string;
  status: 'COMPLETED' | 'FAILED';
  zipStorageKey?: string;
  failureReason?: string;
  occurredAt: string;
}
```

In `notification-delivery.service.ts`'s `recordDelivery`, add the check right after the existing `status` check:

```ts
const ownerEmail = event.ownerEmail?.trim();
if (!ownerEmail) {
  throw new InvalidTerminalEventError(
    'Missing ownerEmail',
    'MISSING_OWNER_EMAIL',
  );
}
```

(Leave the rest of the method's current body untouched for this task — Task 12 is where the send logic is added. For now `record.ownerUserId = event.ownerUserId;` stays as the only owner-identifying field written to `DeliveryRecord`; Task 12 does not need a stored `ownerEmail` column since it is read straight off the validated `event` at send time, not persisted redundantly.)

- [ ] **Step 4: Run tests to verify they pass**

Run: same command as Step 2. Also: `DATABASE_HOST=localhost DATABASE_PORT=55432 DATABASE_NAME=fiapx DATABASE_SCHEMA=notification DATABASE_USER=notification DATABASE_PASSWORD=notification npm run test:e2e -- durable-persistence.e2e-spec.ts` against the running stack.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notifications/dtos/terminal-event.dto.ts \
        src/notifications/application/notification-delivery.service.ts \
        src/notifications/application/notification-delivery.service.spec.ts \
        test/durable-persistence.e2e-spec.ts
git commit -m "feat(notification): require ownerEmail on the terminal event contract"
```

---

## Task 8: `notification-service` — `DeliveryRecord` email outcome fields + `updateEmailOutcome`

**Files:**
- Modify: `notification-service/src/notifications/domain/delivery-record.ts`
- Modify: `notification-service/src/notifications/domain/delivery.repository.ts`
- Modify: `notification-service/src/notifications/infrastructure/persistence/in-memory-delivery.repository.ts`
- Modify: `notification-service/src/notifications/infrastructure/persistence/typeorm-delivery.repository.ts`
- Modify: `notification-service/src/notifications/infrastructure/persistence/delivery-record.entity.ts`
- Create: `notification-service/src/notifications/infrastructure/persistence/migrations/1789959000000-AddEmailOutcome.ts`
- Test: `notification-service/src/notifications/infrastructure/persistence/in-memory-delivery.repository.spec.ts`
- Test: `notification-service/test/durable-persistence.e2e-spec.ts`

**Interfaces:**
- Produces: `DeliveryRecord.emailSentAt?: Date`, `.emailError?: string`; `DeliveryRepository.updateEmailOutcome(eventId, outcome): Promise<void>` where `outcome` is `{ emailSentAt: Date } | { emailError: string }`.

- [ ] **Step 1: Write the failing tests**

Add to `in-memory-delivery.repository.spec.ts`:

```ts
it('records a successful send outcome against an existing row', async () => {
  const record = new DeliveryRecord();
  record.eventId = 'evt-1';
  record.processingRequestId = 'req-1';
  record.ownerUserId = 'user-1';
  record.status = 'COMPLETED';
  record.zipStorageKey = 'zip-1';
  record.recordedAt = new Date();
  await repository.save(record);

  const sentAt = new Date();
  await repository.updateEmailOutcome('evt-1', { emailSentAt: sentAt });

  const found = await repository.findByEventId('evt-1');
  expect(found?.emailSentAt).toBe(sentAt);
  expect(found?.emailError).toBeUndefined();
});

it('records a failed send outcome against an existing row', async () => {
  const record = new DeliveryRecord();
  record.eventId = 'evt-2';
  record.processingRequestId = 'req-2';
  record.ownerUserId = 'user-1';
  record.status = 'FAILED';
  record.failureReason = 'x';
  record.recordedAt = new Date();
  await repository.save(record);

  await repository.updateEmailOutcome('evt-2', { emailError: 'SMTP timeout' });

  const found = await repository.findByEventId('evt-2');
  expect(found?.emailError).toBe('SMTP timeout');
  expect(found?.emailSentAt).toBeUndefined();
});
```

(Match this spec file's existing `repository` variable setup in `beforeEach`.)

Add to `test/durable-persistence.e2e-spec.ts`, inside its existing `describe`:

```ts
it('persists and reads back an email outcome across a fresh connection', async () => {
  const event = completedEvent();
  await service.recordDelivery(event);

  await repository.updateEmailOutcome(event.eventId, {
    emailSentAt: new Date('2026-09-26T12:00:00Z'),
  });

  const reread = new TypeOrmDeliveryRepository(dataSource);
  const found = await reread.findByEventId(event.eventId);
  expect(found?.emailSentAt).toEqual(new Date('2026-09-26T12:00:00Z'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- in-memory-delivery.repository.spec.ts`
Expected: FAIL — `repository.updateEmailOutcome` doesn't exist (TypeScript compile error).

- [ ] **Step 3: Implement**

`delivery-record.ts`:

```ts
export class DeliveryRecord {
  eventId: string;
  processingRequestId: string;
  ownerUserId: string;
  status: 'COMPLETED' | 'FAILED';
  zipStorageKey?: string;
  failureReason?: string;
  recordedAt: Date;
  /** Set once an email attempt completes, successfully. */
  emailSentAt?: Date;
  /** Set once an email attempt completes, unsuccessfully. Mutually exclusive with emailSentAt. */
  emailError?: string;
}
```

`delivery.repository.ts`:

```ts
export interface DeliveryRepository {
  findByEventId(eventId: string): Promise<DeliveryRecord | undefined>;
  findByProcessingRequestId(
    processingRequestId: string,
  ): Promise<DeliveryRecord | undefined>;
  save(record: DeliveryRecord): Promise<DeliveryRecord>;
  updateEmailOutcome(
    eventId: string,
    outcome: { emailSentAt: Date } | { emailError: string },
  ): Promise<void>;
}
```

`in-memory-delivery.repository.ts` — add the method:

```ts
updateEmailOutcome(
  eventId: string,
  outcome: { emailSentAt: Date } | { emailError: string },
): Promise<void> {
  const record = this.records.get(eventId);
  if (!record) {
    return Promise.resolve();
  }
  if ('emailSentAt' in outcome) {
    record.emailSentAt = outcome.emailSentAt;
    record.emailError = undefined;
  } else {
    record.emailError = outcome.emailError;
    record.emailSentAt = undefined;
  }
  return Promise.resolve();
}
```

`delivery-record.entity.ts` — add two nullable columns:

```ts
@Column({ name: 'email_sent_at', type: 'timestamptz', nullable: true })
emailSentAt: Date | null;

@Column({ name: 'email_error', type: 'text', nullable: true })
emailError: string | null;
```

`typeorm-delivery.repository.ts` — extend `toDomain` and `save`'s insert to include both (nulled at insert time), and add `updateEmailOutcome`:

```ts
function toDomain(row: DeliveryRecordEntity): DeliveryRecord {
  const record = new DeliveryRecord();
  record.eventId = row.eventId;
  record.processingRequestId = row.processingRequestId;
  record.ownerUserId = row.ownerUserId;
  record.status = row.status as 'COMPLETED' | 'FAILED';
  record.zipStorageKey = row.zipStorageKey ?? undefined;
  record.failureReason = row.failureReason ?? undefined;
  record.recordedAt = row.recordedAt;
  record.emailSentAt = row.emailSentAt ?? undefined;
  record.emailError = row.emailError ?? undefined;
  return record;
}
```

```ts
async save(record: DeliveryRecord): Promise<DeliveryRecord> {
  try {
    await this.dataSource.manager.insert(DeliveryRecordEntity, {
      eventId: record.eventId,
      processingRequestId: record.processingRequestId,
      ownerUserId: record.ownerUserId,
      status: record.status,
      zipStorageKey: record.zipStorageKey ?? null,
      failureReason: record.failureReason ?? null,
      recordedAt: record.recordedAt,
      emailSentAt: null,
      emailError: null,
    });
    return record;
  } catch (error) {
    // ...unchanged
  }
}

async updateEmailOutcome(
  eventId: string,
  outcome: { emailSentAt: Date } | { emailError: string },
): Promise<void> {
  await this.dataSource.manager.update(
    DeliveryRecordEntity,
    { eventId },
    'emailSentAt' in outcome
      ? { emailSentAt: outcome.emailSentAt, emailError: null }
      : { emailError: outcome.emailError, emailSentAt: null },
  );
}
```

New migration, following `1789954000000-CreateDeliveryRecord.ts`'s naming pattern:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEmailOutcome1789959000000 implements MigrationInterface {
  name = 'AddEmailOutcome1789959000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE delivery_record
        ADD COLUMN IF NOT EXISTS email_sent_at timestamptz NULL,
        ADD COLUMN IF NOT EXISTS email_error   text        NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE delivery_record
        DROP COLUMN IF EXISTS email_sent_at,
        DROP COLUMN IF EXISTS email_error
    `);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- in-memory-delivery.repository.spec.ts` and (against the running stack) the `durable-persistence.e2e-spec.ts` command from Task 7's Step 4.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notifications/domain/delivery-record.ts \
        src/notifications/domain/delivery.repository.ts \
        src/notifications/infrastructure/persistence/in-memory-delivery.repository.ts \
        src/notifications/infrastructure/persistence/in-memory-delivery.repository.spec.ts \
        src/notifications/infrastructure/persistence/typeorm-delivery.repository.ts \
        src/notifications/infrastructure/persistence/delivery-record.entity.ts \
        src/notifications/infrastructure/persistence/migrations/1789959000000-AddEmailOutcome.ts \
        test/durable-persistence.e2e-spec.ts
git commit -m "feat(notification): add emailSentAt/emailError outcome fields and updateEmailOutcome"
```

---

## Task 9: `notification-service` — `EmailSender` port + in-memory fake

**Files:**
- Create: `notification-service/src/notifications/domain/email-sender.ts`
- Create: `notification-service/src/notifications/domain/email-sender.token.ts`
- Create: `notification-service/src/notifications/infrastructure/email/in-memory-email-sender.ts`
- Test: `notification-service/src/notifications/infrastructure/email/in-memory-email-sender.spec.ts`

**Interfaces:**
- Produces: `EmailMessage { to: string; subject: string; text: string }`; `EmailSender.send(message): Promise<void>`; `EMAIL_SENDER` token; `InMemoryEmailSender.sent: EmailMessage[]`.

- [ ] **Step 1: Write the failing test**

```ts
// in-memory-email-sender.spec.ts
import { InMemoryEmailSender } from './in-memory-email-sender';

describe('InMemoryEmailSender', () => {
  it('records every message it is sent, in order', async () => {
    const sender = new InMemoryEmailSender();

    await sender.send({ to: 'a@x.com', subject: 'S1', text: 'T1' });
    await sender.send({ to: 'b@x.com', subject: 'S2', text: 'T2' });

    expect(sender.sent).toEqual([
      { to: 'a@x.com', subject: 'S1', text: 'T1' },
      { to: 'b@x.com', subject: 'S2', text: 'T2' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- in-memory-email-sender.spec.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

`email-sender.ts`:

```ts
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
```

`email-sender.token.ts`:

```ts
export const EMAIL_SENDER = Symbol('EMAIL_SENDER');
```

`in-memory-email-sender.ts`:

```ts
import { EmailMessage, EmailSender } from '../../domain/email-sender';

/** Test/no-SMTP-configured fallback, mirroring InMemoryDeliveryRepository's role. */
export class InMemoryEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];

  send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notifications/domain/email-sender.ts \
        src/notifications/domain/email-sender.token.ts \
        src/notifications/infrastructure/email/in-memory-email-sender.ts \
        src/notifications/infrastructure/email/in-memory-email-sender.spec.ts
git commit -m "feat(notification): add EmailSender port and in-memory fake"
```

---

## Task 10: `notification-service` — the two templates

**Files:**
- Create: `notification-service/src/notifications/application/email-templates.ts`
- Test: `notification-service/src/notifications/application/email-templates.spec.ts`

**Interfaces:**
- Produces: `renderCompletedEmail({ processingRequestId }): { subject: string; text: string }`; `renderFailedEmail({ processingRequestId, failureReason }): { subject: string; text: string }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { renderCompletedEmail, renderFailedEmail } from './email-templates';

describe('email templates', () => {
  it('renders the completed template with the request id and no other dynamic field', () => {
    const { subject, text } = renderCompletedEmail({
      processingRequestId: 'req-123',
    });

    expect(subject).toContain('req-123');
    expect(text).toContain('req-123');
  });

  it('renders the failed template with only the safe failureReason and the request id', () => {
    const { subject, text } = renderFailedEmail({
      processingRequestId: 'req-123',
      failureReason: 'O arquivo enviado nao e um video MP4 ou MOV valido.',
    });

    expect(text).toContain('req-123');
    expect(text).toContain(
      'O arquivo enviado nao e um video MP4 ou MOV valido.',
    );
  });

  it('never includes a storage key field name in the failed template', () => {
    const { text } = renderFailedEmail({
      processingRequestId: 'req-123',
      failureReason: 'x',
    });

    expect(text).not.toMatch(/storageKey|zipStorageKey/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- email-templates.spec.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```ts
export function renderCompletedEmail(input: {
  processingRequestId: string;
}): { subject: string; text: string } {
  return {
    subject: `Seu video foi processado (${input.processingRequestId})`,
    text:
      `O video que voce enviou (pedido ${input.processingRequestId}) foi processado com sucesso.\n` +
      `Acesse a API para baixar o arquivo com os frames extraidos.`,
  };
}

export function renderFailedEmail(input: {
  processingRequestId: string;
  failureReason: string;
}): { subject: string; text: string } {
  return {
    subject: `Nao foi possivel processar seu video (${input.processingRequestId})`,
    text:
      `O video que voce enviou (pedido ${input.processingRequestId}) nao pode ser processado.\n` +
      `${input.failureReason}`,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/notifications/application/email-templates.ts \
        src/notifications/application/email-templates.spec.ts
git commit -m "feat(notification): add success/failure email templates"
```

---

## Task 11: `notification-service` — `SmtpEmailSender` adapter

**Files:**
- Modify: `notification-service/package.json` (add `nodemailer` dependency)
- Create: `notification-service/src/notifications/infrastructure/email/smtp-email-sender.ts`
- Test: `notification-service/src/notifications/infrastructure/email/smtp-email-sender.spec.ts`

**Interfaces:**
- Consumes: `EmailSender` from Task 9.
- Produces: `SmtpEmailSender` (constructor takes `{ host, port, from }` plus an optional injected `nodemailer.Transporter`, defaulting to a real one, so tests never open a socket).

- [ ] **Step 1: Write the failing tests**

```ts
import { SmtpEmailSender } from './smtp-email-sender';

describe('SmtpEmailSender', () => {
  it('sends through the injected transporter with the configured from address', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    const sender = new SmtpEmailSender(
      { host: 'mailpit', port: 1025, from: 'fiapx@local' },
      { sendMail } as never,
    );

    await sender.send({ to: 'alice@fiapx.local', subject: 'S', text: 'T' });

    expect(sendMail).toHaveBeenCalledWith({
      from: 'fiapx@local',
      to: 'alice@fiapx.local',
      subject: 'S',
      text: 'T',
    });
  });

  it('propagates a transport failure to the caller', async () => {
    const sendMail = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const sender = new SmtpEmailSender(
      { host: 'mailpit', port: 1025, from: 'fiapx@local' },
      { sendMail } as never,
    );

    await expect(
      sender.send({ to: 'a@x.com', subject: 'S', text: 'T' }),
    ).rejects.toThrow('ECONNREFUSED');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- smtp-email-sender.spec.ts`
Expected: FAIL — module doesn't exist; also `nodemailer` isn't a dependency yet.

- [ ] **Step 3: Implement**

```bash
npm install nodemailer
```

(`nodemailer` ships its own TypeScript types — no `@types/nodemailer` needed.)

```ts
import { createTransport, Transporter } from 'nodemailer';
import { EmailMessage, EmailSender } from '../../domain/email-sender';

export interface SmtpOptions {
  host: string;
  port: number;
  from: string;
}

const TIMEOUT_MS = 5000;

export class SmtpEmailSender implements EmailSender {
  private readonly transporter: Transporter;

  constructor(
    private readonly options: SmtpOptions,
    transporter?: Transporter,
  ) {
    this.transporter =
      transporter ??
      createTransport({
        host: options.host,
        port: options.port,
        secure: false,
        connectionTimeout: TIMEOUT_MS,
        greetingTimeout: TIMEOUT_MS,
        socketTimeout: TIMEOUT_MS,
      });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.options.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json \
        src/notifications/infrastructure/email/smtp-email-sender.ts \
        src/notifications/infrastructure/email/smtp-email-sender.spec.ts
git commit -m "feat(notification): add SmtpEmailSender adapter using nodemailer"
```

---

## Task 12: `notification-service` — wire the send into `NotificationDeliveryService`, crash-safe

**Files:**
- Modify: `notification-service/src/notifications/application/notification-delivery.service.ts`
- Test: `notification-service/src/notifications/application/notification-delivery.service.spec.ts`

**Interfaces:**
- Consumes: `EmailSender`/`InMemoryEmailSender` from Task 9, templates from Task 10, `DeliveryRepository.updateEmailOutcome` from Task 8.
- Produces: `NotificationDeliveryService` constructor gains `emailSender: EmailSender` as its second argument. **This is the core requirement of the whole feature (EN-11 through EN-20).**

- [ ] **Step 1: Write the failing tests**

Update the `beforeEach` in `notification-delivery.service.spec.ts`:

```ts
let emailSender: InMemoryEmailSender;

beforeEach(() => {
  repository = new StubDeliveryRepository();
  emailSender = new InMemoryEmailSender();
  service = new NotificationDeliveryService(repository, emailSender);
});
```

(Add `import { InMemoryEmailSender } from '../infrastructure/email/in-memory-email-sender';` at the top. Also add `updateEmailOutcome` to `StubDeliveryRepository`, mirroring the in-memory adapter's implementation from Task 8, since `StubDeliveryRepository` is this spec file's own local double, not the real `InMemoryDeliveryRepository`.)

Add a new `describe('email sending', ...)` block:

```ts
describe('email sending', () => {
  it('sends the completed template exactly once for a new event', async () => {
    await service.recordDelivery(validCompletedEvent());

    expect(emailSender.sent).toHaveLength(1);
    expect(emailSender.sent[0].to).toBe('owner@example.com');
    expect(emailSender.sent[0].text).toContain('req-1');
  });

  it('sends the failed template with only the safe failureReason', async () => {
    const event: TerminalEventDto = {
      ...validCompletedEvent(),
      status: 'FAILED',
      zipStorageKey: undefined,
      failureReason: 'Nao foi possivel processar o video.',
    };

    await service.recordDelivery(event);

    expect(emailSender.sent).toHaveLength(1);
    expect(emailSender.sent[0].text).toContain(
      'Nao foi possivel processar o video.',
    );
  });

  it('does not send a second email when the same eventId is redelivered after a completed attempt', async () => {
    await service.recordDelivery(validCompletedEvent());
    await service.recordDelivery(validCompletedEvent());

    expect(emailSender.sent).toHaveLength(1);
  });

  it('still sends exactly one email when a redelivered eventId finds a row with no prior outcome (crash recovery)', async () => {
    // Simulates a crash between save() and send(): the record exists, but
    // neither emailSentAt nor emailError has ever been set on it.
    const record = new DeliveryRecord();
    Object.assign(record, {
      eventId: 'evt-1',
      processingRequestId: 'req-1',
      ownerUserId: 'user-1',
      status: 'COMPLETED',
      zipStorageKey: 'zip-1',
      recordedAt: new Date(),
    });
    await repository.save(record);

    await service.recordDelivery(validCompletedEvent());

    expect(emailSender.sent).toHaveLength(1);
  });

  it('records emailError and does not throw when the send fails, and does not send again on redelivery', async () => {
    emailSender.send = () => Promise.reject(new Error('ECONNREFUSED 1.2.3.4:1025'));

    const result = await service.recordDelivery(validCompletedEvent());
    expect(result.emailError).toBeDefined();
    expect(result.emailError).not.toContain('1.2.3.4'); // bounded, not the raw error

    emailSender.send = (m) => {
      emailSender.sent.push(m);
      return Promise.resolve();
    };
    await service.recordDelivery(validCompletedEvent());

    expect(emailSender.sent).toHaveLength(0); // already-failed attempt is not retried
  });
});
```

(Add `import { DeliveryRecord } from '../domain/delivery-record';` and `import { TerminalEventDto } from '../dtos/terminal-event.dto';` if not already imported at the top of this file.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- notification-delivery.service.spec.ts`
Expected: FAIL — `NotificationDeliveryService` still takes one constructor argument, and sends nothing.

- [ ] **Step 3: Implement**

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DeliveryRecord } from '../domain/delivery-record';
import type { DeliveryRepository } from '../domain/delivery.repository';
import { DELIVERY_REPOSITORY } from '../domain/delivery-repository.token';
import { EMAIL_SENDER } from '../domain/email-sender.token';
import type { EmailSender } from '../domain/email-sender';
import { DeliveryPersistenceError } from '../domain/errors/delivery-persistence.error';
import { InvalidTerminalEventError } from '../domain/errors/invalid-terminal-event.error';
import { TerminalEventDto } from '../dtos/terminal-event.dto';
import { renderCompletedEmail, renderFailedEmail } from './email-templates';

const MAX_ERROR_MESSAGE_LENGTH = 200;

@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  constructor(
    @Inject(DELIVERY_REPOSITORY)
    private readonly deliveryRepository: DeliveryRepository,
    @Inject(EMAIL_SENDER)
    private readonly emailSender: EmailSender,
  ) {}

  async recordDelivery(event: TerminalEventDto): Promise<DeliveryRecord> {
    // ...unchanged validation from Task 7, ending with the ownerEmail check

    const zipStorageKey = event.zipStorageKey?.trim() || undefined;
    const failureReason = event.failureReason?.trim() || undefined;
    // ...unchanged remaining validation

    try {
      let record = await this.deliveryRepository.findByEventId(event.eventId);
      if (record && (record.emailSentAt || record.emailError)) {
        return record; // an attempt already completed for this event
      }

      if (!record) {
        record = new DeliveryRecord();
        record.eventId = event.eventId;
        record.processingRequestId = event.processingRequestId;
        record.ownerUserId = event.ownerUserId;
        record.status = event.status;
        record.zipStorageKey = zipStorageKey;
        record.failureReason = failureReason;
        record.recordedAt = new Date();
        record = await this.deliveryRepository.save(record);
      }

      await this.attemptEmail(record, ownerEmail);
      return record;
    } catch (error) {
      if (error instanceof InvalidTerminalEventError) {
        throw error;
      }
      throw new DeliveryPersistenceError(
        `Failed to record delivery for event ${event.eventId}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private async attemptEmail(
    record: DeliveryRecord,
    ownerEmail: string,
  ): Promise<void> {
    const template =
      record.status === 'COMPLETED'
        ? renderCompletedEmail({ processingRequestId: record.processingRequestId })
        : renderFailedEmail({
            processingRequestId: record.processingRequestId,
            failureReason: record.failureReason ?? '',
          });

    try {
      await this.emailSender.send({ to: ownerEmail, ...template });
      record.emailSentAt = new Date();
      await this.deliveryRepository.updateEmailOutcome(record.eventId, {
        emailSentAt: record.emailSentAt,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown email send failure';
      record.emailError = message.slice(0, MAX_ERROR_MESSAGE_LENGTH);
      this.logger.warn(
        `Email send failed for event ${record.eventId}: ${record.emailError}`,
      );
      await this.deliveryRepository.updateEmailOutcome(record.eventId, {
        emailError: record.emailError,
      });
    }
  }
}
```

(`ownerEmail` here is the same trimmed local variable Task 7's validation step already computed inside `recordDelivery`, from `event.ownerEmail` — pass it down to `attemptEmail` as shown. The `ECONNREFUSED 1.2.3.4:1025` message in the failing test above is deliberately short enough to fit under `MAX_ERROR_MESSAGE_LENGTH` unmodified, so that test's "not.toContain('1.2.3.4')" only passes because a *real* `nodemailer` connection error is far longer than 200 characters and gets truncated — adjust the test fixture's injected error message to something realistically long, e.g. include ` at TCPConnectWrap.afterConnect [as oncomplete] (node:net:...)`-style padding, if the short literal above doesn't actually get cut by the slice. Verify this assertion is meaningful, not accidentally true, when running Step 4.)

- [ ] **Step 4: Run tests to verify they pass**

Run: same command as Step 2.
Expected: PASS. If the parenthetical above's concern is real (the short error message isn't actually truncated), lengthen the test's rejected error message until the truncation is genuinely exercised, and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/notifications/application/notification-delivery.service.ts \
        src/notifications/application/notification-delivery.service.spec.ts
git commit -m "feat(notification): send exactly one email per terminal event, crash-safely"
```

---

## Task 13: `notification-service` — wire `EMAIL_SENDER` into `NotificationsModule`

**Files:**
- Create: `notification-service/src/notifications/infrastructure/email/smtp-config.ts`
- Modify: `notification-service/src/notifications/notifications.module.ts`
- Test: `notification-service/src/notifications/infrastructure/email/smtp-config.spec.ts`

**Interfaces:**
- Produces: `isSmtpConfigured(): boolean`; `buildSmtpOptions(): SmtpOptions`; `NotificationsModule` provides `EMAIL_SENDER`.

- [ ] **Step 1: Write the failing tests**

```ts
// smtp-config.spec.ts
import { buildSmtpOptions, isSmtpConfigured } from './smtp-config';

describe('smtp-config', () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('is not configured when SMTP_HOST is unset', () => {
    delete process.env.SMTP_HOST;
    expect(isSmtpConfigured()).toBe(false);
  });

  it('is configured when SMTP_HOST is set', () => {
    process.env.SMTP_HOST = 'mailpit';
    expect(isSmtpConfigured()).toBe(true);
  });

  it('builds options from env, with defaults for port and from', () => {
    process.env.SMTP_HOST = 'mailpit';
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_FROM;

    expect(buildSmtpOptions()).toEqual({
      host: 'mailpit',
      port: 1025,
      from: 'fiapx@local',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- smtp-config.spec.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

`smtp-config.ts`:

```ts
import { SmtpOptions } from './smtp-email-sender';

export function isSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST);
}

export function buildSmtpOptions(): SmtpOptions {
  return {
    host: process.env.SMTP_HOST ?? 'localhost',
    port: Number(process.env.SMTP_PORT ?? 1025),
    from: process.env.SMTP_FROM ?? 'fiapx@local',
  };
}
```

`notifications.module.ts` — add the provider alongside the existing `dataSourceProvider`:

```ts
import { EMAIL_SENDER } from './domain/email-sender.token';
import { InMemoryEmailSender } from './infrastructure/email/in-memory-email-sender';
import { SmtpEmailSender } from './infrastructure/email/smtp-email-sender';
import { buildSmtpOptions, isSmtpConfigured } from './infrastructure/email/smtp-config';
```

```ts
const emailSenderProvider = {
  provide: EMAIL_SENDER,
  useFactory: () =>
    isSmtpConfigured()
      ? new SmtpEmailSender(buildSmtpOptions())
      : new InMemoryEmailSender(),
};
```

```ts
@Module({
  controllers: [TerminalEventConsumer],
  providers: [
    NotificationDeliveryService,
    dataSourceProvider,
    emailSenderProvider,
    {
      provide: DELIVERY_REPOSITORY,
      useFactory: (dataSource?: DataSource) =>
        dataSource
          ? new TypeOrmDeliveryRepository(dataSource)
          : new InMemoryDeliveryRepository(),
      inject: [DATA_SOURCE],
    },
  ],
  exports: [DELIVERY_REPOSITORY, DATA_SOURCE],
})
export class NotificationsModule {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2. Then run the full unit and e2e suites (`npm test && npm run test:e2e`) to confirm `AppModule` still boots with no `SMTP_HOST` set (falls back to `InMemoryEmailSender`, same as the database's existing fallback).

- [ ] **Step 5: Commit**

```bash
git add src/notifications/infrastructure/email/smtp-config.ts \
        src/notifications/infrastructure/email/smtp-config.spec.ts \
        src/notifications/notifications.module.ts
git commit -m "feat(notification): wire EMAIL_SENDER into NotificationsModule"
```

---

## Task 14: `fiap-x-platform` — Mailpit in `compose.yaml`

**Files:**
- Modify: `fiap-x-platform/compose.yaml`

**Interfaces:**
- Produces: a healthy `mailpit` service; `notification`'s `SMTP_HOST`/`SMTP_PORT`/`SMTP_FROM` env vars and its `depends_on.mailpit`.

- [ ] **Step 1: Confirm the image tag and healthcheck before writing compose (no failing test to write here — this is infrastructure config, verified by bringing the stack up, per this repo's existing convention for `storage`/`rabbitmq`/`identity` entries)**

Check the current `axllent/mailpit` tags are pullable, the way AD-014 now requires:

```bash
docker pull axllent/mailpit:v1.22
docker run --rm axllent/mailpit:v1.22 --version
```

If that tag doesn't exist or doesn't pull, use whatever the pull output resolves to instead — do not guess further; this is exactly the check AD-014 was written to enforce.

- [ ] **Step 2: Implement**

Add to `compose.yaml`'s `services:`:

```yaml
  mailpit:
    image: axllent/mailpit:<confirmed-tag>
    ports:
      - "8025:8025"
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:8025/"]
      interval: 5s
      timeout: 3s
      retries: 10
```

Modify the existing `notification` service block:

```yaml
  notification:
    build: ../notification-service
    ports:
      - "3003:3003"
    environment:
      - PORT=3003
      - LOCAL_INTEGRATION=true
      - RABBITMQ_URL=amqp://rabbitmq:5672
      - DATABASE_HOST=postgres
      - DATABASE_PORT=5432
      - DATABASE_NAME=fiapx
      - DATABASE_SCHEMA=notification
      - DATABASE_USER=notification
      - DATABASE_PASSWORD=notification
      - SMTP_HOST=mailpit
      - SMTP_PORT=1025
      - SMTP_FROM=fiapx@local
    depends_on:
      rabbitmq:
        condition: service_healthy
      postgres:
        condition: service_healthy
      mailpit:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:3003/health || exit 1"]
      interval: 5s
      timeout: 3s
      retries: 5
```

- [ ] **Step 3: Verify**

Run: `docker compose config -q` (syntax check, matching the build gate's step 2), then:

```bash
export POSTGRES_HOST_PORT=55432   # or whatever local port avoids the conflict noted in this session
docker compose up --build -d --wait
docker compose ps mailpit notification
curl -fsS http://localhost:8025/
```

Expected: both `Up (healthy)`; the `curl` returns Mailpit's UI HTML with 200.

- [ ] **Step 4: Commit**

```bash
git add compose.yaml
git commit -m "feat(platform): add Mailpit to the local topology"
```

---

## Task 15: `fiap-x-platform` — regenerate the database creation script

**Files:**
- Modify: `fiap-x-platform/db/create-database.sql` (generated, not hand-edited)

**Interfaces:**
- Consumes: the two new migrations from Task 2 (`processing-catalog`) and Task 8 (`notification-service`) — both sibling repos must already have those migrations committed before this task runs.

- [ ] **Step 1: Verify the drift check currently fails**

Run: `node scripts/generate-db-script.mjs --check`
Expected: exits 1, naming `db/create-database.sql` and the first differing line (the two new columns are missing from the committed script).

- [ ] **Step 2: Regenerate**

Run: `node scripts/generate-db-script.mjs`

- [ ] **Step 3: Verify it's clean now**

Run: `node scripts/generate-db-script.mjs --check`
Expected: exits 0.

Also apply it to an empty database and confirm the two new columns exist:

```bash
docker compose down -v
docker compose up -d --wait postgres
psql "postgresql://postgres:postgres@localhost:${POSTGRES_HOST_PORT:-5432}/fiapx" -f db/create-database.sql
psql "postgresql://postgres:postgres@localhost:${POSTGRES_HOST_PORT:-5432}/fiapx" \
  -c "\d catalog.processing_request" -c "\d notification.delivery_record"
```

Expected: `owner_email` listed under `processing_request`; `email_sent_at`/`email_error` listed under `delivery_record`.

- [ ] **Step 4: Commit**

```bash
git add db/create-database.sql
git commit -m "chore(platform): regenerate db/create-database.sql for the email-notification schema changes"
```

---

## Task 16: `fiap-x-platform` — prove the failure email in the smoke

**Files:**
- Modify: `fiap-x-platform/scripts/smoke-local-integration.mjs`

**Interfaces:**
- Consumes: `ctx.rejectedId`, `ctx.delivery.failureReason`, `ctx.failedId`, `ctx.failedDelivery.failureReason` — all already populated by the existing `delivery sentence`/`processing failure delivery` steps.
- Produces: two new steps, `failure email` and `processing failure email`, and a `searchMailpit`/`assertExactlyOneMessage` helper pair with their own `--self-test` coverage, following this script's existing convention (every assertion helper gets a bad/near-miss/good case in `--self-test`).

- [ ] **Step 1: Confirm Mailpit's search API shape before writing the helper**

Against the stack brought up in Task 14:

```bash
curl -s "http://localhost:8025/api/v1/messages" | head -c 2000
```

Read the response shape (message list fields — likely `messages`, `total`, each with `To`, `Subject`, a snippet or an id to fetch the full body from `/api/v1/message/<id>`) and confirm the query-parameter syntax Mailpit's own `/api/v1/search` or `?query=` support before writing `searchMailpit` below verbatim — adjust the implementation to match what is actually returned, not what this plan assumed at design time (per the spec's logged open question).

- [ ] **Step 2: Write the failing self-test cases**

Add, near the other assertion self-tests (the `['delivery sentence given ...', ...]` array pattern already in this file):

```js
const EXACTLY_ONE_MESSAGE_CASES = [
  ['zero messages found', () => assertExactlyOneMessage('req-1', 0),
    'Mailpit holds 0 message(s) for req-1, expected exactly 1'],
  ['two messages found', () => assertExactlyOneMessage('req-1', 2),
    'Mailpit holds 2 message(s) for req-1, expected exactly 1'],
];

for (const [what, run, expected] of EXACTLY_ONE_MESSAGE_CASES) {
  test(`assertExactlyOneMessage fails given ${what}`, () => {
    assert.throws(run, { message: expected });
  });
}

test('assertExactlyOneMessage passes given exactly one message', () => {
  assert.doesNotThrow(() => assertExactlyOneMessage('req-1', 1));
});
```

(Match this file's actual self-test harness — it may use Node's built-in `node:test`/`assert` or a hand-rolled runner; read the existing self-test block for `assertDeliverySentence` immediately above and mirror its exact harness calls, not `describe`/`it` from Jest, since this script is a standalone Node script, not a Jest suite.)

- [ ] **Step 3: Run to verify the self-test fails**

Run: `node scripts/smoke-local-integration.mjs --self-test`
Expected: FAIL — `assertExactlyOneMessage` doesn't exist.

- [ ] **Step 4: Implement**

```js
const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';

async function searchMailpit(processingRequestId) {
  const res = await fetch(
    `${MAILPIT_URL}/api/v1/messages?query=${encodeURIComponent(processingRequestId)}`,
  );
  const body = await res.json();
  return body.messages ?? []; // adjust to whatever field Step 1 found
}

function assertExactlyOneMessage(processingRequestId, count) {
  if (count !== 1) {
    throw new Error(
      `Mailpit holds ${count} message(s) for ${processingRequestId}, expected exactly 1`,
    );
  }
}
```

Add the two new steps to `SMOKE_STEPS`, right after `'delivery sentence'`/`'single delivery'` and after `'processing failure delivery'` respectively:

```js
{
  name: 'failure email',
  observe: async (ctx) => {
    ctx.failureEmails = await searchMailpit(ctx.rejectedId);
  },
  check: (ctx) =>
    assertExactlyOneMessage(
      observed(ctx, 'rejectedId'),
      observedFor(ctx, 'failureEmails', 'rejectedId').length,
    ),
  report: (ctx) => `Mailpit holds exactly one failure email for ${ctx.rejectedId}`,
},
```

```js
{
  name: 'processing failure email',
  observe: async (ctx) => {
    ctx.processingFailureEmails = await searchMailpit(ctx.failedId);
  },
  check: (ctx) =>
    assertExactlyOneMessage(
      observed(ctx, 'failedId'),
      observedFor(ctx, 'processingFailureEmails', 'failedId').length,
    ),
  report: (ctx) => `Mailpit holds exactly one failure email for ${ctx.failedId}`,
},
```

Add both new step names to the `--dry-run` step-name list (`'video delivery', 'delivery sentence', 'single delivery', ...` around line 1232) in the same relative order, and to the README's `SMOKE_STEPS` table (the self-test requires every step be documented there by name, in backticks).

- [ ] **Step 5: Run to verify the self-test and a real run pass**

Run: `node scripts/smoke-local-integration.mjs --self-test`
Expected: PASS.

Run against the live stack from Task 14:

```bash
node scripts/smoke-local-integration.mjs
```

Expected: all steps pass, including the two new ones. Then, without tearing the stack down, run it a second time:

```bash
node scripts/smoke-local-integration.mjs
```

Expected: still passes — this is the Review Focus item about an accumulating Mailpit inbox; if the second run's `failure email`/`processing failure email` steps fail with "more than 1", the `searchMailpit` query is matching more broadly than by this run's own `processingRequestId` and needs narrowing.

- [ ] **Step 6: Commit**

```bash
git add scripts/smoke-local-integration.mjs README.md
git commit -m "feat(platform): prove the failure email lands in Mailpit exactly once"
```

---

## Task 17: `fiap-x-platform` — record AD-015

**Files:**
- Modify: `fiap-x-platform/.specs/STATE.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Write the entry**

Append, after `### AD-014`:

```markdown
### AD-015
- **Decision**: The owner's email address is resolved exactly once, at `fiap-x-api`, by reading the standard OIDC `email` claim already present on the verified access token — never by querying Keycloak's Admin API and never through a second contact registry. It is stored on `processing-catalog`'s `ProcessingRequest` and added only to the terminal event; `VideoValidationRequested`, `ProcessingQueued`, and `ProcessingStarted` never carry it, so the Worker's PII surface stays at zero.
- **Reason**: Keycloak's Admin REST API is vendor-specific, not a standard protocol — adopting it to resolve `sub` to an address would cost AD-005's portability argument more than reading a claim the token already carries, and would give `notification-service` a new runtime dependency (an admin credential, a new failure mode) for a service whose whole point is to stay decoupled. A service-local contact registry was rejected too: it duplicates a fact Keycloak already owns and still needs the same Admin API (or a manual seed) to populate.
- **Trade-off**: Touches `fiap-x-api` (`TokenVerifier`, the guard, upload confirmation) and `processing-catalog` (a new required column, one field added to one event) in addition to `notification-service`. In exchange, no service outside `fiap-x-api` ever queries an identity provider for anything beyond validating a token, and the Worker never sees an email address at all.
- **Scope**: `fiap-x-api` auth and upload confirmation; `processing-catalog` domain, persistence, and the terminal event contract; `notification-service`'s consumption of that contract; `fiap-x-platform`'s Mailpit service and smoke.
- **Date**: 2026-09-26
- **Status**: active
```

(Use today's actual implementation date if it differs from the design date above.)

- [ ] **Step 2: Verify**

Run: `grep -c "^### AD-015" .specs/STATE.md`
Expected: `1`.

- [ ] **Step 3: Commit**

```bash
git add .specs/STATE.md
git commit -m "docs(platform): record AD-015 (email address resolution via the token's email claim)"
```
