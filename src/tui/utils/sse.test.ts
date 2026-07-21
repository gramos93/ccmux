import { describe, it, expect } from "bun:test";
import { dispatchSSEEvent, type SSECallbacks } from "./sse";
import type { InvocationSnapshotEntry, SSEEvent } from "../../types";
import type { TaskInstance } from "../../lib/task";

// Locks the client half of the invocation-snapshot wiring: `onInit` is the
// only consumer of the optional `invocations` arg, so a dropped third arg or a
// missing `?? []` would silently disable reconnect reconciliation with every
// other test still green. Driven through the pure dispatcher (no socket) so it
// is immune to App.test's process-wide SSEClient mock.

function makeCallbacks(over: Partial<SSECallbacks> = {}): SSECallbacks {
  return {
    onInit: () => {},
    onSessionCreated: () => {},
    onSessionUpdated: () => {},
    onSessionRemoved: () => {},
    onConnectionStateChange: () => {},
    onError: () => {},
    ...over,
  };
}

describe("dispatchSSEEvent init handling", () => {
  it("threads init.invocations through to onInit", () => {
    let received: InvocationSnapshotEntry[] | undefined;
    dispatchSSEEvent(
      {
        type: "init",
        timestamp: "2024-01-15T12:00:00Z",
        sessions: [],
        activePaneId: null,
        invocations: [{ invocationId: "inv_a", status: "running" }],
      },
      makeCallbacks({ onInit: (_s, _p, inv) => (received = inv) }),
    );
    expect(received).toEqual([{ invocationId: "inv_a", status: "running" }]);
  });

  it("passes [] to onInit when an init frame omits invocations (older daemon)", () => {
    let called = false;
    let received: InvocationSnapshotEntry[] | undefined;
    // An older daemon's init frame has no invocations field; the wire shape
    // predates the snapshot, so cast past the now-required property.
    const legacyInit = {
      type: "init",
      timestamp: "2024-01-15T12:00:00Z",
      sessions: [],
      activePaneId: null,
    } as unknown as SSEEvent;
    dispatchSSEEvent(
      legacyInit,
      makeCallbacks({
        onInit: (_s, _p, inv) => {
          called = true;
          received = inv;
        },
      }),
    );
    expect(called).toBe(true);
    expect(received).toEqual([]);
  });
});

describe("dispatchSSEEvent task events", () => {
  const task: TaskInstance = {
    id: "t1",
    project: "p",
    target: "new-window",
    agent: "claude",
    prompt: "hi",
    status: "pending",
    createdAt: "2024-01-15T12:00:00Z",
    updatedAt: "2024-01-15T12:00:00Z",
  };

  it("routes task_created to onTaskCreated", () => {
    let got: TaskInstance | undefined;
    dispatchSSEEvent(
      { type: "task_created", timestamp: "2024-01-15T12:00:00Z", task },
      makeCallbacks({ onTaskCreated: (t) => (got = t) }),
    );
    expect(got?.id).toBe("t1");
  });

  it("routes task_updated to onTaskUpdated", () => {
    let got: TaskInstance | undefined;
    dispatchSSEEvent(
      { type: "task_updated", timestamp: "2024-01-15T12:00:00Z", task },
      makeCallbacks({ onTaskUpdated: (t) => (got = t) }),
    );
    expect(got?.id).toBe("t1");
  });

  it("routes task_removed to onTaskRemoved", () => {
    let got: string | undefined;
    dispatchSSEEvent(
      { type: "task_removed", timestamp: "2024-01-15T12:00:00Z", id: "t1" },
      makeCallbacks({ onTaskRemoved: (id) => (got = id) }),
    );
    expect(got).toBe("t1");
  });

  it("ignores an unknown event type without throwing", () => {
    const unknown = {
      type: "not_a_real_event",
      timestamp: "2024-01-15T12:00:00Z",
    } as unknown as SSEEvent;
    expect(() => dispatchSSEEvent(unknown, makeCallbacks())).not.toThrow();
  });
});
