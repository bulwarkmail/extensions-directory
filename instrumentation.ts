export async function register() {
  // The web app, the worker and the deploy user share data/ through the
  // group "extdir"; files they create (SQLite's -wal and -shm, uploads) must
  // stay group-writable and closed to everyone else.
  if (process.env.NEXT_RUNTIME === "nodejs") process.umask(0o007);
}
