import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

const html = await readFile(new URL("./embed-demo.html", import.meta.url));

createServer((request, response) => {
  if (request.url !== "/") {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Referrer-Policy": "no-referrer" }).end(html);
}).listen(5174, "127.0.0.1", () => console.log("Open the demo host at http://localhost:5174"));
