export async function register() {
  // The web app, the worker and the deploy user share data/ through the
  // group "extdir"; files they create (SQLite's -wal and -shm, uploads) must
  // stay group-writable and closed to everyone else.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    process.umask(0o007);
    // A production server doesn't start without its own session secret,
    // token pepper and address-hash salt. The error names each one that is
    // missing or refused, never a value.
    const { secretProblems } = await import("@/lib/auth/secrets");
    const problems = secretProblems();
    if (problems.length) throw new Error(problems.join("\n"));
  }
}
