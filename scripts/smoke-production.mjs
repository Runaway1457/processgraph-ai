import { spawn } from "node:child_process";

const port = 3217;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["dist/index.js"], {
  env: { ...process.env, NODE_ENV: "production", PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});

let diagnostics = "";
server.stdout.on("data", chunk => {
  diagnostics += chunk.toString();
});
server.stderr.on("data", chunk => {
  diagnostics += chunk.toString();
});

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function get(path) {
  const response = await fetch(`${origin}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  return response.text();
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const health = JSON.parse(await get("/healthz"));
      ready = health.status === "ok";
      if (ready) break;
    } catch {
      await wait(100);
    }
  }
  if (!ready) throw new Error("health endpoint did not become ready");

  const home = await get("/");
  const fallback = await get("/route-that-does-not-exist");
  const title =
    "<title>ProcessGraph AI · Evidence-first process intelligence</title>";
  if (!home.includes(title) || !fallback.includes(title)) {
    throw new Error(
      "SPA entry point or fallback did not serve the application"
    );
  }

  console.log("Production smoke passed: health, SPA entry and fallback route.");
} catch (error) {
  console.error(diagnostics.trim());
  throw error;
} finally {
  server.kill("SIGTERM");
}
