import { and, desc, gte, lte } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { measurements } from "./schema";
import { calculateTrend, trendPeriods } from "./trend";

const measurementFields = {
  grpid: measurements.grpid,
  timestamp: measurements.timestamp,
  weightKg: measurements.weightKg,
  fatRatioPercent: measurements.fatRatioPercent,
  fatMassKg: measurements.fatMassKg,
  fatFreeMassKg: measurements.fatFreeMassKg,
  muscleMassKg: measurements.muscleMassKg,
  hydrationKg: measurements.hydrationKg,
  boneMassKg: measurements.boneMassKg,
};

export async function getLatestMeasurement(db: AppDatabase) {
  const [latest] = await db
    .select(measurementFields)
    .from(measurements)
    .orderBy(desc(measurements.timestamp), desc(measurements.grpid))
    .limit(1);

  return latest;
}

export async function getRecentMeasurements(db: AppDatabase, limit: number) {
  return db
    .select(measurementFields)
    .from(measurements)
    .orderBy(desc(measurements.timestamp), desc(measurements.grpid))
    .limit(limit);
}

export async function getMeasurementTrend(db: AppDatabase) {
  const latest = await getLatestMeasurement(db);
  if (!latest) return { latest: null, current: null, previous: null, delta: null };
  const periods = trendPeriods(latest.timestamp);

  const rows = await db
    .select({ timestamp: measurements.timestamp, weightKg: measurements.weightKg })
    .from(measurements)
    .where(
      and(
        gte(measurements.timestamp, periods.previous.startTimestamp),
        lte(measurements.timestamp, periods.current.endTimestamp),
      ),
    );

  return { latest, ...calculateTrend(latest.timestamp, rows) };
}
