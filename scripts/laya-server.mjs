import { spawn } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";

const child = spawn(process.argv[2], [], { stdio: "inherit", env: process.env });
let stopped = false;
let stopping = false;
child.on("error", error => {
  stopped = true;
  console.error("Could not start Laya:", error.message);
  process.exitCode = 1;
});
child.on("exit", code => {
  stopped = true;
  process.exitCode = stopping ? 0 : code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    stopped = true;
    child.kill(signal);
  });
}

const url = `http://127.0.0.1:${process.env.LAYA_PORT ?? 8000}`;
try {
  const deadline = Date.now() + 180_000;
  let healthy = false;
  while (!stopped && Date.now() < deadline) {
    healthy = await fetch(url + "/health", { signal: AbortSignal.timeout(2_000) }).then(response => response.ok).catch(() => false);
    if (healthy) break;
    await pause(500);
  }
  if (!healthy || stopped) throw new Error("The server did not become ready.");
  console.log("Laya is loading its first Choice and Boolean checks…");
  const response = await fetch(url + "/v1/systemone", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "english", state: "The visitor completed the required safety orientation and asks to book equipment.",
      questions: {
        readiness: { type: "choice", instructions: "Which topic is requested?", criteria: { equipment: "Equipment booking.", other: "An unrelated topic." } },
        orientation: { type: "noul", instructions: "Did the visitor complete the required orientation?" },
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await response.json();
  if (stopped || !response.ok || !data.answers?.readiness || !data.answers?.orientation || data.usage?.truncated) {
    throw new Error("The startup policy checks did not complete successfully.");
  }
  console.log(`Laya is ready at ${url}. Choice and Boolean checks are warmed up.`);
} catch (error) {
  if (!stopped) console.error("Laya startup failed:", error.message);
  child.kill("SIGTERM");
  process.exitCode = stopping ? 0 : 1;
}
