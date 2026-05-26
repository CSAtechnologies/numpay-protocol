const { execSync } = require("child_process");
const path = require("path");
process.chdir(__dirname);
require("child_process").spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["vite", "--port", "3002"],
  { stdio: "inherit", cwd: __dirname }
);
