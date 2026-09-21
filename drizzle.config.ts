import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: ["./src/auth/schema.ts", "./src/measurements/schema.ts", "./src/withings/schema.ts"],
  out: "./drizzle",
  dialect: "sqlite",
});
