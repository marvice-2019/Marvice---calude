// Runs once when a server starts. With the Postgres store it starts the email and cleanup jobs in the same process.
// Set HOURHAND_WORKER=0 to run a server without them (for example a second web replica, if one process runs the jobs).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.HOURHAND_DATA !== "postgres" || process.env.HOURHAND_WORKER === "0") return;
  const { startJobsFromEnv } = await import("./lib/jobs/start");
  startJobsFromEnv();
}
