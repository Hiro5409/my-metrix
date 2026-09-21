import { expect, test } from "bun:test";
import { parseWithingsNotification } from "./notification";

test("interprets Withings measurement windows and dates as a measurement selection", () => {
  expect(
    parseWithingsNotification({
      appli: 1,
      enddate: 200,
      startdate: 100,
    }).notification,
  ).toEqual({
    kind: "measurements",
    userId: null,
    selection: { kind: "period", startTimestamp: 100, endTimestamp: 200 },
  });

  expect(
    parseWithingsNotification({
      appli: 1,
      date: 1_720_000_001,
    }).notification,
  ).toEqual({
    kind: "measurements",
    userId: null,
    selection: { kind: "period", startTimestamp: 1_720_000_001, endTimestamp: 1_720_000_001 },
  });

  expect(
    parseWithingsNotification({
      appli: 1,
      startdate: 300,
    }).notification,
  ).toEqual({
    kind: "measurements",
    userId: null,
    selection: { kind: "period", startTimestamp: 300, endTimestamp: 300 },
  });

  expect(
    parseWithingsNotification({
      appli: 1,
      enddate: 400,
    }).notification,
  ).toEqual({
    kind: "measurements",
    userId: null,
    selection: { kind: "period", startTimestamp: 400, endTimestamp: 400 },
  });

  expect(
    parseWithingsNotification({
      appli: 1,
      date: "2026-06-13",
    }).notification,
  ).toEqual({
    kind: "measurements",
    userId: null,
    selection: { kind: "period", startTimestamp: 1_781_308_800, endTimestamp: 1_781_395_199 },
  });
});
