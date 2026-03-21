import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const workloopModule = await import(pathToFileURL(path.resolve("F:/openclaw/miya/src/workloop.ts")).href);

test("triggerContinuationWake requests a real heartbeat wake for agent_end", () => {
  assert.equal(typeof workloopModule.triggerContinuationWake, "function");

  const enqueued = [];
  const wakes = [];
  const result = workloopModule.triggerContinuationWake({
    runtime: {
      system: {
        enqueueSystemEvent(text, options) {
          enqueued.push({ text, options });
          return true;
        },
        requestHeartbeatNow(options) {
          wakes.push(options);
        },
      },
    },
    hook: "agent_end",
    payload: {
      decision: "RUN",
      taskId: "T006",
      taskStatus: "retry",
      nextAction: "Run the chained validation suite.",
      summary: "Resume the next runnable task.",
    },
    event: { success: true },
    ctx: { sessionKey: "agent:main:default" },
  });

  assert.equal(result.triggered, true);
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].options.sessionKey, "agent:main:default");
  assert.match(enqueued[0].options.contextKey, /T006/);
  assert.equal(wakes.length, 1);
  assert.equal(wakes[0].sessionKey, "agent:main:default");
});

test("triggerContinuationWake routes subagent completion wake back to the requester session", () => {
  assert.equal(typeof workloopModule.triggerContinuationWake, "function");

  const enqueued = [];
  const wakes = [];
  const result = workloopModule.triggerContinuationWake({
    runtime: {
      system: {
        enqueueSystemEvent(text, options) {
          enqueued.push({ text, options });
          return true;
        },
        requestHeartbeatNow(options) {
          wakes.push(options);
        },
      },
    },
    hook: "subagent_ended",
    payload: {
      decision: "RUN",
      taskId: "T007",
      taskStatus: "queued",
      nextAction: "Continue the next queued orchestration task.",
      summary: "Parent session should pick up the next task.",
    },
    event: {
      targetSessionKey: "agent:child:session",
      outcome: "ok",
    },
    ctx: {
      requesterSessionKey: "agent:parent:session",
      childSessionKey: "agent:child:session",
    },
  });

  assert.equal(result.triggered, true);
  assert.equal(result.routeKind, "descendant-settle");
  assert.equal(result.routeSource, "agent:child:session");
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].options.sessionKey, "agent:parent:session");
  assert.equal(wakes.length, 1);
  assert.equal(wakes[0].sessionKey, "agent:parent:session");
});

test("triggerContinuationWake suppresses heartbeat-triggered session_start self-wakes", () => {
  const enqueued = [];
  const wakes = [];

  const result = workloopModule.triggerContinuationWake({
    runtime: {
      system: {
        enqueueSystemEvent(text, options) {
          enqueued.push({ text, options });
          return true;
        },
        requestHeartbeatNow(options) {
          wakes.push(options);
        },
      },
    },
    hook: "session_start",
    payload: {
      decision: "RUN",
      taskId: "T006",
      taskStatus: "running",
      nextAction: "Continue the running task.",
    },
    ctx: {
      sessionKey: "agent:main:default",
      trigger: "heartbeat",
    },
  });

  assert.equal(result.triggered, false);
  assert.equal(result.reason, "suppressed-heartbeat-session-start");
  assert.equal(enqueued.length, 0);
  assert.equal(wakes.length, 0);
});

test("triggerContinuationWake skips heartbeat requests when system event was not enqueued", () => {
  workloopModule.resetContinuationWakeThrottleForTests();
  const wakes = [];

  const result = workloopModule.triggerContinuationWake({
    runtime: {
      system: {
        enqueueSystemEvent() {
          return false;
        },
        requestHeartbeatNow(options) {
          wakes.push(options);
        },
      },
    },
    hook: "agent_end",
    payload: {
      decision: "RUN",
      taskId: "T006",
      taskStatus: "retry",
      nextAction: "Retry the current task.",
    },
    ctx: {
      sessionKey: "agent:main:system-event-skip",
    },
  });

  assert.equal(result.triggered, false);
  assert.equal(result.reason, "system-event-not-enqueued");
  assert.equal(wakes.length, 0);
});

test("triggerContinuationWake dedupes repeated wake requests for the same session and task", () => {
  assert.equal(typeof workloopModule.resetContinuationWakeThrottleForTests, "function");
  workloopModule.resetContinuationWakeThrottleForTests();

  const wakes = [];
  const runtime = {
    system: {
      enqueueSystemEvent() {
        return true;
      },
      requestHeartbeatNow(options) {
        wakes.push(options);
      },
    },
  };

  const first = workloopModule.triggerContinuationWake({
    runtime,
    hook: "agent_end",
    payload: {
      decision: "RUN",
      taskId: "T006",
      taskStatus: "retry",
      nextAction: "Retry the current task.",
    },
    ctx: {
      sessionKey: "agent:main:default",
    },
    nowMs: 1_000,
    throttleWindowMs: 5_000,
  });
  const second = workloopModule.triggerContinuationWake({
    runtime,
    hook: "agent_end",
    payload: {
      decision: "RUN",
      taskId: "T006",
      taskStatus: "retry",
      nextAction: "Retry the current task.",
    },
    ctx: {
      sessionKey: "agent:main:default",
    },
    governorState: first.governorStatePatch,
    nowMs: 1_500,
    throttleWindowMs: 5_000,
  });

  assert.equal(first.triggered, true);
  assert.equal(second.triggered, false);
  assert.equal(second.reason, "suppressed-duplicate-wake");
  assert.equal(wakes.length, 1);
});

test("triggerContinuationWake persists dedupe state across invocations via governorState", () => {
  workloopModule.resetContinuationWakeThrottleForTests();

  const wakes = [];
  const runtime = {
    system: {
      enqueueSystemEvent() {
        return true;
      },
      requestHeartbeatNow(options) {
        wakes.push(options);
      },
    },
  };

  const first = workloopModule.triggerContinuationWake({
    runtime,
    hook: "agent_end",
    payload: {
      decision: "RUN",
      taskId: "T008",
      taskStatus: "queued",
      nextAction: "Start the queued orchestration task.",
    },
    ctx: {
      sessionKey: "agent:main:persisted",
    },
    nowMs: 2_000,
    throttleWindowMs: 5_000,
  });

  // Simulate a plugin reload/process restart: in-memory dedupe is gone, persisted governor survives.
  workloopModule.resetContinuationWakeThrottleForTests();
  const second = workloopModule.triggerContinuationWake({
    runtime,
    hook: "agent_end",
    payload: {
      decision: "RUN",
      taskId: "T008",
      taskStatus: "queued",
      nextAction: "Start the queued orchestration task.",
    },
    ctx: {
      sessionKey: "agent:main:persisted",
    },
    governorState: first.governorStatePatch,
    nowMs: 2_500,
    throttleWindowMs: 5_000,
  });

  assert.equal(first.triggered, true);
  assert.equal(second.triggered, false);
  assert.equal(second.reason, "suppressed-duplicate-wake");
  assert.equal(wakes.length, 1);
});

test("triggerContinuationWake coalesces session-resume wakes at the session level", () => {
  workloopModule.resetContinuationWakeThrottleForTests();

  const wakes = [];
  const runtime = {
    system: {
      enqueueSystemEvent() {
        return true;
      },
      requestHeartbeatNow(options) {
        wakes.push(options);
      },
    },
  };

  const first = workloopModule.triggerContinuationWake({
    runtime,
    hook: "session_start",
    payload: {
      decision: "RUN",
      taskId: "T010",
      taskStatus: "queued",
      nextAction: "Resume the resumed session queue.",
    },
    ctx: {
      sessionKey: "agent:main:resume",
      trigger: "session_resume",
    },
    nowMs: 4_000,
    throttleWindowMs: 5_000,
  });

  const second = workloopModule.triggerContinuationWake({
    runtime,
    hook: "session_start",
    payload: {
      decision: "RUN",
      taskId: "T011",
      taskStatus: "retry",
      nextAction: "Resume the same session again.",
    },
    ctx: {
      sessionKey: "agent:main:resume",
      trigger: "session_resume",
    },
    governorState: first.governorStatePatch,
    nowMs: 4_200,
    throttleWindowMs: 5_000,
  });

  assert.equal(first.triggered, true);
  assert.equal(first.routeKind, "session-resume");
  assert.equal(second.triggered, false);
  assert.equal(second.reason, "suppressed-session-resume-coalesced");
  assert.equal(wakes.length, 1);
});

test("triggerContinuationWake coalesces descendant-settle wakes per parent-child route", () => {
  workloopModule.resetContinuationWakeThrottleForTests();

  const wakes = [];
  const runtime = {
    system: {
      enqueueSystemEvent() {
        return true;
      },
      requestHeartbeatNow(options) {
        wakes.push(options);
      },
    },
  };

  const first = workloopModule.triggerContinuationWake({
    runtime,
    hook: "subagent_ended",
    payload: {
      decision: "RUN",
      taskId: "T012",
      taskStatus: "queued",
      nextAction: "Parent should settle descendant work.",
    },
    ctx: {
      requesterSessionKey: "agent:main:parent",
      childSessionKey: "agent:child:a",
    },
    nowMs: 5_000,
    throttleWindowMs: 5_000,
  });

  const second = workloopModule.triggerContinuationWake({
    runtime,
    hook: "subagent_ended",
    payload: {
      decision: "RUN",
      taskId: "T013",
      taskStatus: "retry",
      nextAction: "Same child should not cause another immediate wake.",
    },
    ctx: {
      requesterSessionKey: "agent:main:parent",
      childSessionKey: "agent:child:a",
    },
    governorState: first.governorStatePatch,
    nowMs: 5_300,
    throttleWindowMs: 5_000,
  });

  const third = workloopModule.triggerContinuationWake({
    runtime,
    hook: "subagent_ended",
    payload: {
      decision: "RUN",
      taskId: "T014",
      taskStatus: "queued",
      nextAction: "Different child may still wake the same parent.",
    },
    ctx: {
      requesterSessionKey: "agent:main:parent",
      childSessionKey: "agent:child:b",
    },
    governorState: first.governorStatePatch,
    nowMs: 5_300,
    throttleWindowMs: 5_000,
  });

  assert.equal(first.triggered, true);
  assert.equal(first.routeKind, "descendant-settle");
  assert.equal(second.triggered, false);
  assert.equal(second.reason, "suppressed-descendant-settle-coalesced");
  assert.equal(third.triggered, false);
  assert.equal(third.reason, "suppressed-session-target-coalesced");
  assert.equal(wakes.length, 1);
});

test("triggerContinuationWake does not consume dedupe state when enqueueSystemEvent returns false", () => {
  workloopModule.resetContinuationWakeThrottleForTests();

  let allowEnqueue = false;
  const wakes = [];
  const runtime = {
    system: {
      enqueueSystemEvent() {
        return allowEnqueue;
      },
      requestHeartbeatNow(options) {
        wakes.push(options);
      },
    },
  };

  const first = workloopModule.triggerContinuationWake({
    runtime,
    hook: "agent_end",
    payload: {
      decision: "RUN",
      taskId: "T009",
      taskStatus: "retry",
      nextAction: "Retry after the failed enqueue.",
    },
    ctx: {
      sessionKey: "agent:main:enqueue-false",
    },
    nowMs: 3_000,
    throttleWindowMs: 5_000,
  });

  allowEnqueue = true;
  const second = workloopModule.triggerContinuationWake({
    runtime,
    hook: "agent_end",
    payload: {
      decision: "RUN",
      taskId: "T009",
      taskStatus: "retry",
      nextAction: "Retry after the failed enqueue.",
    },
    ctx: {
      sessionKey: "agent:main:enqueue-false",
    },
    governorState: first.governorStatePatch,
    nowMs: 3_200,
    throttleWindowMs: 5_000,
  });

  assert.equal(first.triggered, false);
  assert.equal(first.reason, "system-event-not-enqueued");
  assert.equal(second.triggered, true);
  assert.equal(wakes.length, 1);
});

test("triggerContinuationWake coalesces different default routes that target the same session", () => {
  workloopModule.resetContinuationWakeThrottleForTests();

  const wakes = [];
  const runtime = {
    system: {
      enqueueSystemEvent() {
        return true;
      },
      requestHeartbeatNow(options) {
        wakes.push(options);
      },
    },
  };

  const first = workloopModule.triggerContinuationWake({
    runtime,
    hook: "agent_end",
    payload: {
      decision: "RUN",
      taskId: "T020",
      taskStatus: "queued",
      nextAction: "Wake the parent session once.",
    },
    ctx: {
      sessionKey: "agent:main:shared-session",
    },
    nowMs: 6_000,
    throttleWindowMs: 5_000,
  });

  const second = workloopModule.triggerContinuationWake({
    runtime,
    hook: "subagent_ended",
    payload: {
      decision: "RUN",
      taskId: "T021",
      taskStatus: "retry",
      nextAction: "Do not wake the same session twice immediately.",
    },
    ctx: {
      requesterSessionKey: "agent:main:shared-session",
      childSessionKey: "agent:child:shared-session",
    },
    governorState: first.governorStatePatch,
    nowMs: 6_200,
    throttleWindowMs: 5_000,
  });

  assert.equal(first.triggered, true);
  assert.equal(second.triggered, false);
  assert.equal(second.reason, "suppressed-session-target-coalesced");
  assert.equal(wakes.length, 1);
});

test("triggerContinuationWake prunes stale governor history while preserving the latest wake", () => {
  workloopModule.resetContinuationWakeThrottleForTests();

  const runtime = {
    system: {
      enqueueSystemEvent() {
        return true;
      },
      requestHeartbeatNow() {},
    },
  };

  const result = workloopModule.triggerContinuationWake({
    runtime,
    hook: "agent_end",
    payload: {
      decision: "RUN",
      taskId: "T030",
      taskStatus: "queued",
      nextAction: "Keep only fresh governor state.",
    },
    ctx: {
      sessionKey: "agent:main:prune",
    },
    governorState: {
      recentWakeByKey: {
        "stale::wake": 1,
        "fresh::wake": 59_500,
      },
      recentWakeBySession: {
        "agent:stale": {
          at: 1,
          hook: "agent_end",
          taskId: "T001",
          routeKind: "default",
        },
        "agent:fresh": {
          at: 59_500,
          hook: "agent_end",
          taskId: "T002",
          routeKind: "default",
        },
      },
    },
    nowMs: 60_002,
    throttleWindowMs: 5_000,
  });

  assert.equal(result.triggered, true);
  assert.deepEqual(result.governorStatePatch?.recentWakeByKey, {
    "fresh::wake": 59_500,
    "agent:main:prune::agent_end::T030": 60_002,
  });
  assert.deepEqual(result.governorStatePatch?.recentWakeBySession, {
    "agent:fresh": {
      at: 59_500,
      hook: "agent_end",
      taskId: "T002",
      routeKind: "default",
    },
    "agent:main:prune": {
      at: 60_002,
      hook: "agent_end",
      taskId: "T030",
      routeKind: "default",
      routeSource: undefined,
    },
  });
});
