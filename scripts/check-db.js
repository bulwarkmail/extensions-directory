const D = require("better-sqlite3");
const db = new D("data/extensions.db");
const r = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all();
console.log(JSON.stringify(r, null, 2));
db.close();
