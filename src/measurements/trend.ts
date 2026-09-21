const DAY_SECONDS = 86_400;

type WeightSample = Readonly<{
  timestamp: number;
  weightKg: number | null;
}>;

type Period = Readonly<{ startTimestamp: number; endTimestamp: number }>;

type TrendWindow = Period &
  Readonly<{
    count: number;
    weightKgAverage: number | null;
  }>;

export function trendPeriods(latestTimestamp: number) {
  return {
    current: {
      startTimestamp: latestTimestamp - 7 * DAY_SECONDS,
      endTimestamp: latestTimestamp,
    },
    previous: {
      startTimestamp: latestTimestamp - 37 * DAY_SECONDS,
      endTimestamp: latestTimestamp - 30 * DAY_SECONDS,
    },
  };
}

function summarizeWindow(measurements: readonly WeightSample[], period: Period): TrendWindow {
  const inWindow = measurements.filter(
    ({ timestamp }) => timestamp >= period.startTimestamp && timestamp <= period.endTimestamp,
  );
  const weights = inWindow.flatMap(({ weightKg }) => (weightKg === null ? [] : [weightKg]));
  return {
    ...period,
    count: inWindow.length,
    weightKgAverage:
      weights.length === 0
        ? null
        : weights.reduce((sum, weight) => sum + weight, 0) / weights.length,
  };
}

export function calculateTrend(latestTimestamp: number, measurements: readonly WeightSample[]) {
  const periods = trendPeriods(latestTimestamp);
  const current = summarizeWindow(measurements, periods.current);
  const previous = summarizeWindow(measurements, periods.previous);
  const delta =
    current.weightKgAverage !== null && previous.weightKgAverage !== null
      ? { weightKgAverage: current.weightKgAverage - previous.weightKgAverage }
      : null;

  return { current, previous, delta };
}
