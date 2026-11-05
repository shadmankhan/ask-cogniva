import { createServer } from "node:http";

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Cogniva embed demo</title>
<style>body{font:16px system-ui;margin:2rem auto;padding:0 1rem;max-width:760px;color:#172a29}
form{display:grid;gap:.5rem} textarea,button{font:inherit;padding:.55rem}
iframe{width:100%;height:650px;border:1px solid #b4c9c1;border-radius:.8rem;margin-top:1rem}
</style></head><body><h1>Organization website</h1><p>External page for the local Cogniva demo.</p>
<form><label for="code">Paste the embed code copied from the Cogniva dashboard</label>
<textarea id="code" rows="3" required></textarea><button>Load assistant</button></form>
<p id="message" role="alert"></p><div id="embed"></div>
<script>
document.querySelector("form").addEventListener("submit", (event) => {
  event.preventDefault();
  const message = document.getElementById("message");
  try {
    const parsed = new DOMParser().parseFromString(document.getElementById("code").value, "text/html");
    const src = new URL(parsed.querySelector("iframe").getAttribute("src"));
    if (!["http://localhost:5173", "http://localhost:3001"].includes(src.origin) ||
        src.pathname !== "/assistant" || !new URLSearchParams(src.hash.slice(1)).has("token")) {
      throw new Error("Invalid local Cogniva embed");
    }
    const iframe = document.createElement("iframe");
    iframe.src = src.href;
    iframe.title = "Cogniva assistant";
    iframe.referrerPolicy = "no-referrer";
    document.getElementById("embed").replaceChildren(iframe);
    message.textContent = "";
  } catch {
    message.textContent = "Paste an iframe snippet from your local Cogniva dashboard.";
  }
});
</script></body></html>`;
createServer((request, response) => {
  if (request.url !== "/") {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Referrer-Policy": "no-referrer" }).end(html);
}).listen(5174, "127.0.0.1", () => console.log("Open the demo host at http://localhost:5174"));
