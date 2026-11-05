import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const { app } = await createApp(loadConfig());
app.use("/assets/*", serveStatic({ root: "./dist" }));
app.get("/", serveStatic({ path: "./dist/index.html" }));
app.get("/assistant", serveStatic({ path: "./dist/index.html" }));
const port = Number(process.env.PORT ?? 3001);
serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, info => {
  console.log(`Cogniva API is listening on http://127.0.0.1:${info.port}`);
});
