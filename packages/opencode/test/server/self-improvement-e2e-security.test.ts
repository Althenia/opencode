import { expect, test } from "bun:test"
import { Clock, Effect, Schema } from "effect"
import {
  SelfImprovement,
  SelfImprovementApi,
  SelfImprovementEvaluation,
  SelfImprovementLearning,
  SelfImprovementLifecycle,
} from "@opencode-ai/schema"
import { SelfImprovementAuthorization } from "@opencode-ai/core/self-improvement/authorization"
import { SelfImprovementAuditStore } from "@opencode-ai/core/self-improvement/audit-store"
import { SelfImprovementEvaluationStore } from "@opencode-ai/core/self-improvement/evaluation-store"
import { SelfImprovementKeyring } from "@opencode-ai/core/self-improvement/keyring"
import { SelfImprovementLifecycleWorkflow } from "@opencode-ai/core/self-improvement/lifecycle-workflow"
import { SelfImprovementPrivateArtifactCommand } from "@opencode-ai/core/self-improvement/private-artifact-command"
import { SelfImprovementPrivateEvidenceCommand } from "@opencode-ai/core/self-improvement/private-evidence-command"
import { SelfImprovementRetention } from "@opencode-ai/core/self-improvement/retention"
import { selfImprovementFixture } from "../fixture/self-improvement"

type Fixture = Awaited<ReturnType<typeof selfImprovementFixture>>

const manifest = new SelfImprovementLifecycle.CapabilityManifest({
  toolIDs: [],
  filesystemScopeIDs: [],
  networkOriginIDs: [],
  modelRoutes: [],
  childAgentTargets: [],
  artifactReferences: [],
  denies: [],
})

const request = (name: string, content: string) =>
  new SelfImprovementApi.CreateArtifactRequest({
    proposalBytes: new TextEncoder().encode(
      JSON.stringify({
        kind: "skill",
        name,
        definition: { description: name, content },
        references: [],
      }),
    ),
    behaviorClass: "instruction-only",
    capabilityManifest: manifest,
  })

const metrics = () =>
  new SelfImprovementEvaluation.MetricComponents({
    taskQuality: { earnedAllowlistedPoints: 1, possibleAllowlistedPoints: 1 },
    correctness: { passedRequiredChecks: 1, requiredChecks: 1 },
    repeatFixRate: { repeatedTasks: 0, completedTasks: 1 },
    precision: { acceptedRelevantItems: 1, assessedItems: 1 },
    latencyMs: 1,
    tokensPerSuccess: new SelfImprovementEvaluation.TokensPerSuccessMetric({
      inputTokens: 1,
      outputTokens: 1,
      successfulTasks: 1,
    }),
    cacheHitRatio: { cacheReadTokens: 1, cacheEligibleTokens: 1 },
  })

const evidencePrincipal = (locationID: SelfImprovementLifecycle.LocationID) =>
  new SelfImprovementLifecycle.Principal({
    id: SelfImprovementLifecycle.PrincipalID.make("security-runtime-evidence"),
    kind: "runtime-evidence-service",
    locationID,
  })

const coordinatorPrincipal = (locationID: SelfImprovementLifecycle.LocationID, name: string) =>
  new SelfImprovementLifecycle.Principal({
    id: SelfImprovementLifecycle.PrincipalID.make(`security-${name}-coordinator`),
    kind: "coordinator",
    locationID,
  })

async function openMetricRun(fixture: Fixture, name: string) {
  const now = SelfImprovementLifecycle.TimestampMillis.make(await fixture.run(Clock.currentTimeMillis))
  const artifact = await fixture.createSkill({ name, content: "Use scoped instructions." })
  const principal = evidencePrincipal(fixture.locationID)
  const suiteID = SelfImprovementLifecycle.SuiteID.create()
  const baselineID = SelfImprovementLifecycle.BaselineID.create()
  const workload = SelfImprovementEvaluation.Workload.make("typescript")
  const revision = SelfImprovementLifecycle.Revision.make(1)
  await fixture.run(
    SelfImprovementLifecycleWorkflow.Service.use((workflow) =>
      workflow.prepareShadow({
        locationID: fixture.locationID,
        principal: coordinatorPrincipal(fixture.locationID, name),
        artifactID: artifact.artifact.id,
        versionID: artifact.version.id,
        now,
        idempotencyKey: SelfImprovementLearning.IdempotencyKey.make(`${name}-prepare-shadow`),
      }),
    ),
  )
  await fixture.run(
    SelfImprovementEvaluationStore.Service.use((evaluation) =>
      evaluation.bootstrapBaseline(
        new SelfImprovementEvaluation.Baseline({
          id: baselineID,
          locationID: fixture.locationID,
          workload,
          workloadRevision: revision,
          suiteID,
          suiteRevision: revision,
          producerAllowlistRevision: revision,
          controlSource: "control",
          acceptanceStart: now,
          acceptanceEnd: SelfImprovementLifecycle.TimestampMillis.make(now + 10),
          cutoffAt: SelfImprovementLifecycle.TimestampMillis.make(now + 20),
          uniqueSampleCount: 20,
          orderedSampleIDDigest: SelfImprovement.Digest.make("2".repeat(64)),
          metricTotals: {
            taskQualityEarnedAllowlistedPoints: 20,
            taskQualityPossibleAllowlistedPoints: 20,
            correctnessPassedRequiredChecks: 20,
            correctnessRequiredChecks: 20,
            repeatFixRepeatedTasks: 0,
            repeatFixCompletedTasks: 20,
            precisionAcceptedRelevantItems: 20,
            precisionAssessedItems: 20,
            acceptedLatencySampleCount: 20,
            latencySampleSetDigest: SelfImprovement.Digest.make("3".repeat(64)),
            inputTokens: 20,
            outputTokens: 20,
            successfulTasks: 20,
            cacheReadTokens: 20,
            cacheEligibleTokens: 20,
          },
          aggregates: new SelfImprovementEvaluation.MetricAggregates({
            taskQuality: 1,
            correctness: 1,
            repeatFixRate: 0,
            precision: 1,
            latencyP95Ms: 1,
            tokensPerSuccess: 1,
            cacheHitRatio: 1,
          }),
          createdAt: now,
          evaluatorSignatureDigest: SelfImprovement.Digest.make("4".repeat(64)),
          bootstrapAuthorityID: fixture.principal.id,
        }),
      ),
    ),
  )
  const request = new SelfImprovementApi.CreateMetricRunRequest({
    versionID: artifact.version.id,
    stage: "shadow",
    suiteID,
    suiteRevision: revision,
    workload,
    workloadRevision: revision,
    baselineID,
    acceptanceStart: now,
    acceptanceEnd: SelfImprovementLifecycle.TimestampMillis.make(now + 10),
    cutoffAt: SelfImprovementLifecycle.TimestampMillis.make(now + 20),
    requestDigest: SelfImprovement.Digest.make("5".repeat(64)),
  })
  const run = await fixture.run(
    SelfImprovementPrivateEvidenceCommand.Service.use((command) =>
      command.createMetricRun(
        {
          principal,
          locationID: fixture.locationID,
          now,
          idempotencyKey: SelfImprovementLearning.IdempotencyKey.make(`${name}-run`),
        },
        request,
      ),
    ),
  )
  return { artifact, baselineID, now, principal, request, run }
}

test("denies unauthorized artifact writes, conceals cross-Location artifacts, and replays only matching commands", async () => {
  await using fixture = await selfImprovementFixture()
  const now = SelfImprovementLifecycle.TimestampMillis.make(await fixture.run(Clock.currentTimeMillis))
  const created = await fixture.run(
    SelfImprovementPrivateArtifactCommand.Service.use((command) =>
      command.createArtifact({
        locationID: fixture.locationID,
        principal: fixture.principal,
        request: request("security-skill", "Use scoped instructions."),
        idempotencyKey: SelfImprovementLearning.IdempotencyKey.make("security-create"),
        now,
      }),
    ),
  )
  const artifact = created.response.body
  if (!(artifact instanceof SelfImprovementApi.CreateArtifactResponse)) throw new Error("Expected artifact response")

  const auditReader = new SelfImprovementLifecycle.Principal({
    id: SelfImprovementLifecycle.PrincipalID.make("security-audit-reader"),
    kind: "audit-reader",
    locationID: fixture.locationID,
  })
  const denied = await fixture.run(
    SelfImprovementPrivateArtifactCommand.Service.use((command) =>
      command
        .createArtifact({
          locationID: fixture.locationID,
          principal: auditReader,
          request: request("denied-skill", "Must not be created."),
          idempotencyKey: SelfImprovementLearning.IdempotencyKey.make("security-denied"),
          now,
        })
        .pipe(Effect.flip),
    ),
  )
  expect(denied.response).toMatchObject({ status: 403, body: { code: "forbidden" } })

  const otherLocationID = SelfImprovementLifecycle.LocationID.make("b".repeat(64))
  const otherLocationPrincipal = new SelfImprovementLifecycle.Principal({
    id: SelfImprovementLifecycle.PrincipalID.make("security-other-location"),
    kind: "first-party-user",
    locationID: otherLocationID,
  })
  const concealed = await fixture.run(
    SelfImprovementPrivateArtifactCommand.Service.use((command) =>
      command
        .archiveVersion({
          locationID: otherLocationID,
          principal: otherLocationPrincipal,
          request: new SelfImprovementApi.ArchiveVersionRequest({
            artifactID: artifact.artifact.id,
            versionID: artifact.version.id,
            reason: "user-archive",
            expectedRevision: artifact.revision,
          }),
          idempotencyKey: SelfImprovementLearning.IdempotencyKey.make("security-concealed"),
          now,
        })
        .pipe(Effect.flip),
    ),
  )
  expect(concealed.response).toMatchObject({ status: 404, body: { code: "artifact-not-found" } })

  const replay = await fixture.run(
    SelfImprovementPrivateArtifactCommand.Service.use((command) =>
      command.createArtifact({
        locationID: fixture.locationID,
        principal: fixture.principal,
        request: request("security-skill", "Use scoped instructions."),
        idempotencyKey: SelfImprovementLearning.IdempotencyKey.make("security-create"),
        now,
      }),
    ),
  )
  expect(replay).toEqual({ ...created, replayed: true })

  const conflict = await fixture.run(
    SelfImprovementPrivateArtifactCommand.Service.use((command) =>
      command
        .createArtifact({
          locationID: fixture.locationID,
          principal: fixture.principal,
          request: request("security-skill", "Changed request."),
          idempotencyKey: SelfImprovementLearning.IdempotencyKey.make("security-create"),
          now,
        })
        .pipe(Effect.flip),
    ),
  )
  expect(conflict.response).toMatchObject({ status: 409, body: { code: "idempotency-mismatch" } })
})

test("fails closed on raw observation fields and preserves only Location-keyed, retained metadata", async () => {
  await using fixture = await selfImprovementFixture()
  const observation = Schema.decodeUnknownSync(SelfImprovementApi.CreateObservationRequest)({
    workload: SelfImprovementEvaluation.Workload.make("typescript"),
    workloadRevision: SelfImprovementLifecycle.Revision.make(1),
    errorClass: "type-error",
    orderedToolSymbolIDs: ["tool-a"],
    outcomeClass: "failure",
    taskIDDigest: SelfImprovement.Digest.make("a".repeat(64)),
    transcript: "must-not-persist",
  })
  expect(observation).not.toHaveProperty("transcript")

  const keyring = SelfImprovementKeyring.make("fixture-security-key")
  const current = await fixture.run(keyring.digestObservation(fixture.locationID, observation))
  const other = await fixture.run(
    keyring.digestObservation(SelfImprovementLifecycle.LocationID.make("b".repeat(64)), observation),
  )
  expect(current).not.toEqual(other)

  const now = SelfImprovementLifecycle.TimestampMillis.make(await fixture.run(Clock.currentTimeMillis))
  expect(
    new SelfImprovementLearning.ObservationRetention({
      createdAt: now,
      expiresAt: SelfImprovementLifecycle.TimestampMillis.make(now + 30 * 86_400_000),
    }).expiresAt,
  ).toBe(SelfImprovementLifecycle.TimestampMillis.make(now + 30 * 86_400_000))
  expect(
    new SelfImprovementLearning.EvidenceRetention({
      createdAt: now,
      expiresAt: SelfImprovementLifecycle.TimestampMillis.make(now + 180 * 86_400_000),
    }).expiresAt,
  ).toBe(SelfImprovementLifecycle.TimestampMillis.make(now + 180 * 86_400_000))
  expect(new SelfImprovementLearning.GovernedMetadataRetention({ createdAt: now })).not.toHaveProperty("expiresAt")

  const auditReader = new SelfImprovementLifecycle.Principal({
    id: SelfImprovementLifecycle.PrincipalID.make("security-audit-reader"),
    kind: "audit-reader",
    locationID: fixture.locationID,
  })
  expect(
    await fixture.run(SelfImprovementAuthorization.authorize(auditReader, "audit.read", fixture.locationID)),
  ).toBeUndefined()
  expect(
    await fixture.run(
      SelfImprovementAuthorization.authorize(fixture.principal, "audit.read", fixture.locationID).pipe(Effect.flip),
    ),
  ).toMatchObject({ _tag: "SelfImprovementAuthorization.Forbidden" })
})

test("replays matching samples and rejects different, late, and out-of-stage evidence", async () => {
  await using fixture = await selfImprovementFixture()
  const setup = await openMetricRun(fixture, "sample-security")
  const sample = new SelfImprovementApi.AddMetricSampleRequest({
    runID: setup.run.id,
    sampleIDDigest: SelfImprovement.Digest.make("6".repeat(64)),
    taskIDDigest: SelfImprovement.Digest.make("7".repeat(64)),
    metrics: metrics(),
    outcome: "success",
    startedAt: setup.now,
    terminalAt: setup.now,
    requestDigest: SelfImprovement.Digest.make("8".repeat(64)),
  })
  const first = await fixture.run(
    SelfImprovementPrivateEvidenceCommand.Service.use((command) =>
      command.addMetricSample(
        {
          principal: setup.principal,
          locationID: fixture.locationID,
          now: setup.now,
          idempotencyKey: SelfImprovementLearning.IdempotencyKey.make("sample"),
        },
        sample,
      ),
    ),
  )
  const replay = await fixture.run(
    SelfImprovementPrivateEvidenceCommand.Service.use((command) =>
      command.addMetricSample(
        {
          principal: setup.principal,
          locationID: fixture.locationID,
          now: setup.now,
          idempotencyKey: SelfImprovementLearning.IdempotencyKey.make("sample"),
        },
        sample,
      ),
    ),
  )
  expect(replay).toEqual(first)

  const different = await fixture.run(
    SelfImprovementPrivateEvidenceCommand.Service.use((command) =>
      command
        .addMetricSample(
          {
            principal: setup.principal,
            locationID: fixture.locationID,
            now: setup.now,
            idempotencyKey: SelfImprovementLearning.IdempotencyKey.make("sample"),
          },
          new SelfImprovementApi.AddMetricSampleRequest({
            runID: sample.runID,
            sampleIDDigest: sample.sampleIDDigest,
            taskIDDigest: sample.taskIDDigest,
            metrics: sample.metrics,
            outcome: sample.outcome,
            startedAt: sample.startedAt,
            terminalAt: sample.terminalAt,
            requestDigest: SelfImprovement.Digest.make("9".repeat(64)),
          }),
        )
        .pipe(Effect.flip),
    ),
  )
  expect(different).toMatchObject({
    _tag: "SelfImprovementPrivateEvidenceCommand.Conflict",
    code: "duplicate-different",
  })

  const late = await fixture.run(
    SelfImprovementPrivateEvidenceCommand.Service.use((command) =>
      command
        .addMetricSample(
          {
            principal: setup.principal,
            locationID: fixture.locationID,
            now: setup.now,
            idempotencyKey: SelfImprovementLearning.IdempotencyKey.make("late"),
          },
          new SelfImprovementApi.AddMetricSampleRequest({
            runID: sample.runID,
            sampleIDDigest: SelfImprovement.Digest.make("a".repeat(64)),
            taskIDDigest: SelfImprovement.Digest.make("b".repeat(64)),
            metrics: sample.metrics,
            outcome: sample.outcome,
            startedAt: sample.startedAt,
            terminalAt: SelfImprovementLifecycle.TimestampMillis.make(setup.now + 1),
            requestDigest: sample.requestDigest,
          }),
        )
        .pipe(Effect.flip),
    ),
  )
  expect(late).toMatchObject({ _tag: "SelfImprovementPrivateEvidenceCommand.Conflict", code: "late" })

  const outOfStage = await fixture.run(
    SelfImprovementPrivateEvidenceCommand.Service.use((command) =>
      command
        .createMetricRun(
          {
            principal: setup.principal,
            locationID: fixture.locationID,
            now: setup.now,
            idempotencyKey: SelfImprovementLearning.IdempotencyKey.make("out-of-stage"),
          },
          new SelfImprovementApi.CreateMetricRunRequest({
            versionID: setup.request.versionID,
            stage: "canary",
            suiteID: setup.request.suiteID,
            suiteRevision: setup.request.suiteRevision,
            workload: setup.request.workload,
            workloadRevision: setup.request.workloadRevision,
            baselineID: setup.request.baselineID,
            acceptanceStart: setup.request.acceptanceStart,
            acceptanceEnd: setup.request.acceptanceEnd,
            cutoffAt: setup.request.cutoffAt,
            requestDigest: setup.request.requestDigest,
          }),
        )
        .pipe(Effect.flip),
    ),
  )
  expect(outOfStage).toMatchObject({ _tag: "SelfImprovementPrivateEvidenceCommand.Conflict", code: "out-of-stage" })
})

test("purges expired observation and evidence while retaining governed audit metadata", async () => {
  await using fixture = await selfImprovementFixture()
  const setup = await openMetricRun(fixture, "retention-security")
  await fixture.run(
    SelfImprovementPrivateEvidenceCommand.Service.use((command) =>
      command.createObservation(
        {
          principal: setup.principal,
          locationID: fixture.locationID,
          now: setup.now,
          idempotencyKey: SelfImprovementLearning.IdempotencyKey.make("observation"),
        },
        new SelfImprovementApi.CreateObservationRequest({
          workload: SelfImprovementEvaluation.Workload.make("typescript"),
          workloadRevision: SelfImprovementLifecycle.Revision.make(1),
          errorClass: "type-error",
          orderedToolSymbolIDs: ["tool-a"],
          outcomeClass: "failure",
          taskIDDigest: SelfImprovement.Digest.make("c".repeat(64)),
        }),
      ),
    ),
  )
  await fixture.run(
    SelfImprovementPrivateEvidenceCommand.Service.use((command) =>
      command.addMetricSample(
        {
          principal: setup.principal,
          locationID: fixture.locationID,
          now: setup.now,
          idempotencyKey: SelfImprovementLearning.IdempotencyKey.make("retention-sample"),
        },
        new SelfImprovementApi.AddMetricSampleRequest({
          runID: setup.run.id,
          sampleIDDigest: SelfImprovement.Digest.make("d".repeat(64)),
          taskIDDigest: SelfImprovement.Digest.make("e".repeat(64)),
          metrics: metrics(),
          outcome: "success",
          startedAt: setup.now,
          terminalAt: setup.now,
          requestDigest: SelfImprovement.Digest.make("f".repeat(64)),
        }),
      ),
    ),
  )
  const auditReader = new SelfImprovementLifecycle.Principal({
    id: SelfImprovementLifecycle.PrincipalID.make("retention-audit-reader"),
    kind: "audit-reader",
    locationID: fixture.locationID,
  })
  await fixture.run(
    SelfImprovementPrivateEvidenceCommand.Service.use((command) =>
      command.auditReadAccess({ principal: auditReader, locationID: fixture.locationID, now: setup.now }, {}),
    ),
  )
  await fixture.advance("30 days")
  const atThirtyDays = await fixture.run(
    SelfImprovementRetention.Service.use((retention) =>
      retention.purgeExpired(SelfImprovementLifecycle.TimestampMillis.make(30 * 86_400_000)),
    ),
  )
  expect(atThirtyDays.observations).toBe(1)
  await fixture.advance("150 days")
  const atOneEightyDays = await fixture.run(
    SelfImprovementRetention.Service.use((retention) =>
      retention.purgeExpired(SelfImprovementLifecycle.TimestampMillis.make(180 * 86_400_000)),
    ),
  )
  expect(atOneEightyDays.evidence).toBeGreaterThan(0)
  const audit = await fixture.run(
    SelfImprovementAuditStore.Service.use((store) => store.list({ locationID: fixture.locationID })),
  )
  expect(audit.some((entry) => entry.eventType === "audit-read" && entry.retention._tag === "governed-metadata")).toBe(
    true,
  )
})
