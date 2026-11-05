import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { organizations } from "../fixtures/demo.js";
import { createFixturePdf } from "../fixtures/pdf.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const { app } = await createApp(config);
const accountsPath = resolve(dirname(process.env.COGNIVA_DB_PATH ?? "data/cogniva.sqlite"), "demo-accounts.json");
const generated = organizations.map(org => ({
  name: org.name, email: org.email, password: randomBytes(20).toString("base64url"),
}));
try {
  writeFileSync(accountsPath, JSON.stringify(generated, null, 2) + "\n", { flag: "wx", mode: 0o600 });
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
}
const accounts = JSON.parse(readFileSync(accountsPath, "utf8")) as typeof generated;
const request = (path: string, init: RequestInit = {}) => app.request(config.origin + path, init);
for (const org of organizations) {
  const account = accounts.find(item => item.email === org.email);
  if (!account) throw new Error("Demo credentials file is incomplete.");
  const authOptions = {
    method: "POST", headers: { "Content-Type": "application/json", Origin: config.origin }, body: JSON.stringify(account),
  };
  const registered = config.db.prepare("SELECT 1 FROM user WHERE email = ?").get(account.email);
  const signed = await request(registered ? "/api/auth/sign-in/email" : "/api/auth/sign-up/email", authOptions);
  const cookie = signed.headers.getSetCookie().find(value => value.includes("session_token="))?.split(";")[0];
  if (!signed.ok || !cookie) throw new Error(`Could not sign in to demo organization ${org.name}.`);
  const headers = { Origin: config.origin, Cookie: cookie };
  let dashboard = await request("/api/admin/dashboard", { headers });
  if (dashboard.status === 403) {
    const created = await request("/api/auth/organization/create", {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ name: org.name, slug: org.slug }),
    });
    if (!created.ok) throw new Error(`Could not create demo organization ${org.name}.`);
    dashboard = await request("/api/admin/dashboard", { headers });
  }
  if (!dashboard.ok) throw new Error(`Could not open dashboard for ${org.name}.`);
  const existing = await dashboard.json();
  const output = resolve(dirname(accountsPath), "demo-pdfs", org.slug);
  mkdirSync(output, { recursive: true, mode: 0o700 });
  for (const file of org.files) {
    const bytes = Buffer.from(await createFixturePdf(file.pages));
    writeFileSync(resolve(output, file.name), bytes);
    if (existing.documents.some((item: { name: string }) => item.name === file.name)) continue;
    const form = new FormData();
    form.set("file", new File([bytes], file.name, { type: "application/pdf" }));
    const uploaded = await request("/api/admin/documents", { method: "POST", headers, body: form });
    if (!uploaded.ok) throw new Error(`Could not index demo PDF ${file.name}.`);
  }
  if (!existing.token && !(await request("/api/admin/assistant", { method: "POST", headers })).ok) {
    throw new Error(`Could not generate an assistant for ${org.name}.`);
  }
  console.log(`Seeded ${org.name}`);
}
console.log(`Local demo login details: ${accountsPath}`);
console.log(`Generated PDFs: ${resolve(dirname(accountsPath), "demo-pdfs")}`);
config.db.close();
