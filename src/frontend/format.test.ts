import { describe, expect, test } from "bun:test";
import type { TaskItem } from "../shared/types.ts";
import { formatCost, formatTokens, formatUSD, openBlockers, relTime } from "./format.ts";

describe("formatTokens", () => {
  test("scales units", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(12_400)).toBe("12.4k");
    expect(formatTokens(1_213_711)).toBe("1.21M");
  });
});

describe("formatCost", () => {
  test("marks partial totals as a lower bound", () => {
    expect(formatCost(1.234, false)).toBe("$1.23");
    expect(formatCost(1.234, true)).toBe("≥ $1.23");
    expect(formatCost(null, true)).toBe("—");
  });
});

describe("formatUSD", () => {
  test("renders dollars or em dash for null", () => {
    expect(formatUSD(27.110987)).toBe("$27.11");
    expect(formatUSD(0.004)).toBe("$0.004");
    expect(formatUSD(0)).toBe("$0.00");
    expect(formatUSD(null)).toBe("—");
  });
});

describe("relTime", () => {
  const now = Date.parse("2026-08-04T12:00:00Z");
  test("humanizes deltas", () => {
    expect(relTime(now - 20_000, now)).toBe("20s ago");
    expect(relTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(relTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(relTime(now - 2 * 86_400_000, now)).toBe("2d ago");
    expect(relTime(0, now)).toBe("—");
  });
});

describe("openBlockers", () => {
  const task = (id: string, status: TaskItem["status"], blockedBy: string[] = []): TaskItem => ({ id, subject: id, status, blocks: [], blockedBy });
  const tasks = [task("1", "completed"), task("2", "in_progress", ["1"]), task("3", "pending", ["1", "2"]), task("4", "completed", ["2"])];

  test("drops blockers that are already completed", () => {
    expect(openBlockers(tasks[1]!, tasks)).toEqual([]);
    expect(openBlockers(tasks[2]!, tasks)).toEqual(["2"]);
  });

  test("a completed task has no open blockers", () => {
    expect(openBlockers(tasks[3]!, tasks)).toEqual([]);
  });

  test("keeps a blocker id that is not in the list", () => {
    expect(openBlockers(task("5", "pending", ["9"]), tasks)).toEqual(["9"]);
  });
});
