import { randomUUID } from "node:crypto";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { LIMITS, type DocumentInfo, type Usage } from "../shared/contracts.js";

export class RequestError extends Error {
  constructor(readonly status: 400 | 401 | 404 | 409 | 413 | 422 | 429 | 503, message: string) {
    super(message);
  }
}

export interface Passage {
  id: string;
  documentId?: string;
  name: string;
  page: number;
  text: string;
}

export interface ParsedPdf {
  pages: number;
  chunks: { page: number; text: string }[];
}

const documentColumns = "id, name, size, pages, status, error, replaces, created_at AS createdAt";

export function createStore(db: DatabaseSync) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS assistants (
      org_id TEXT PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      sealed_token TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      bytes BLOB NOT NULL,
      size INTEGER NOT NULL,
      pages INTEGER,
      status TEXT NOT NULL CHECK(status IN ('processing', 'ready', 'failed')),
      error TEXT,
      replaces TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (org_id, id),
      FOREIGN KEY (org_id, replaces) REFERENCES documents(org_id, id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS documents_by_org ON documents(org_id);
    CREATE UNIQUE INDEX IF NOT EXISTS one_replacement ON documents(org_id, replaces) WHERE replaces IS NOT NULL;
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY,
      org_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      page INTEGER NOT NULL CHECK(page > 0),
      text TEXT NOT NULL,
      FOREIGN KEY (org_id, document_id) REFERENCES documents(org_id, id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS chunks_by_document ON chunks(org_id, document_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS chunk_search USING fts5(text, content='chunks', content_rowid='id', tokenize='porter unicode61');
    CREATE TRIGGER IF NOT EXISTS chunk_insert AFTER INSERT ON chunks BEGIN
      INSERT INTO chunk_search(rowid, text) VALUES (new.id, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS chunk_delete AFTER DELETE ON chunks BEGIN
      INSERT INTO chunk_search(chunk_search, rowid, text) VALUES ('delete', old.id, old.text);
    END;
    CREATE TABLE IF NOT EXISTS usage (
      org_id TEXT PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
      asked INTEGER NOT NULL DEFAULT 0,
      answered INTEGER NOT NULL DEFAULT 0,
      no_answer INTEGER NOT NULL DEFAULT 0,
      needs_clarification INTEGER NOT NULL DEFAULT 0,
      unresolved INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0
    );
    UPDATE documents SET status = 'failed', error = 'Processing was interrupted. Retry this upload.' WHERE status = 'processing';
  `);

  function one<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return db.prepare(sql).get(...params) as T | undefined;
  }
  function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return db.prepare(sql).all(...params) as T[];
  }
  function atomic<T>(action: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  function pageText(org: string, documentId: string, page: number) {
    const chunks = all<{ text: string }>(
      "SELECT text FROM chunks WHERE org_id = ? AND document_id = ? AND page = ? ORDER BY id", org, documentId, page,
    );
    let text = "";
    for (const chunk of chunks) {
      let overlap = Math.min(text.length, chunk.text.length, 200);
      while (overlap > 0 && !text.endsWith(chunk.text.slice(0, overlap))) overlap--;
      text += (text && !overlap ? "\n" : "") + chunk.text.slice(overlap);
    }
    return text;
  }
  function document(org: string, id: string) {
    return one<DocumentInfo>(`SELECT ${documentColumns} FROM documents WHERE org_id = ? AND id = ?`, org, id);
  }

  return {
    organization(userId: string, activeId: string | null | undefined) {
      return one<{ id: string; name: string }>(
        `SELECT o.id, o.name FROM organization o JOIN member m ON m.organizationId = o.id
         WHERE m.userId = ? AND m.role IN ('owner', 'admin') AND (? IS NULL OR o.id = ?)
         ORDER BY o.createdAt LIMIT 1`, userId, activeId ?? null, activeId ?? null,
      );
    },
    assistant(org: string) {
      return one<{ sealed_token: string }>("SELECT sealed_token FROM assistants WHERE org_id = ?", org);
    },
    setAssistant(org: string, hash: string, sealed: string) {
      db.prepare(`INSERT INTO assistants VALUES (?, ?, ?) ON CONFLICT(org_id)
        DO UPDATE SET token_hash = excluded.token_hash, sealed_token = excluded.sealed_token`).run(org, hash, sealed);
    },
    tokenOrganization(hash: string) {
      return one<{ id: string; name: string }>(
        `SELECT o.id, o.name FROM assistants a JOIN organization o ON o.id = a.org_id WHERE a.token_hash = ?`, hash,
      );
    },
    list(org: string) {
      return all<DocumentInfo>(`SELECT ${documentColumns} FROM documents WHERE org_id = ? ORDER BY created_at DESC, rowid DESC`, org);
    },
    document,
    file(org: string, id: string) {
      return one<{ name: string; bytes: Uint8Array }>("SELECT name, bytes FROM documents WHERE org_id = ? AND id = ?", org, id);
    },
    reserve(org: string, name: string, bytes: Uint8Array, replaces: string | null) {
      return atomic(() => {
        if (replaces) {
          const old = document(org, replaces);
          if (!old) throw new RequestError(404, "Document not found.");
          if (old.status !== "ready") throw new RequestError(409, "Retry or delete the incomplete document first.");
          if (one("SELECT id FROM documents WHERE org_id = ? AND replaces = ?", org, replaces)) {
            throw new RequestError(409, "A replacement is already listed. Retry or delete it first.");
          }
        } else {
          const count = one<{ total: number }>(
            "SELECT COUNT(*) AS total FROM documents WHERE org_id = ? AND replaces IS NULL", org,
          )!.total;
          if (count >= LIMITS.documents) throw new RequestError(409, "Each organization can store up to 10 PDFs.");
        }
        const id = randomUUID();
        db.prepare("INSERT INTO documents (id, org_id, name, bytes, size, status, replaces) VALUES (?, ?, ?, ?, ?, 'processing', ?)")
          .run(id, org, name, bytes, bytes.byteLength, replaces);
        return id;
      });
    },
    retry(org: string, id: string) {
      return atomic(() => {
        const current = document(org, id);
        if (!current) throw new RequestError(404, "Document not found.");
        if (current.status !== "failed") throw new RequestError(409, "Only failed uploads can be retried.");
        db.prepare("UPDATE documents SET status = 'processing', error = NULL WHERE org_id = ? AND id = ?").run(org, id);
        return one<{ bytes: Uint8Array }>("SELECT bytes FROM documents WHERE org_id = ? AND id = ?", org, id)!.bytes;
      });
    },
    publish(org: string, id: string, pdf: ParsedPdf) {
      return atomic(() => {
        const current = document(org, id);
        if (current?.status !== "processing") throw new RequestError(404, "Upload was removed.");
        const insert = db.prepare("INSERT INTO chunks (org_id, document_id, page, text) VALUES (?, ?, ?, ?)");
        for (const chunk of pdf.chunks) insert.run(org, id, chunk.page, chunk.text);
        db.prepare("UPDATE documents SET status = 'ready', pages = ?, replaces = NULL WHERE org_id = ? AND id = ?")
          .run(pdf.pages, org, id);
        if (current.replaces) db.prepare("DELETE FROM documents WHERE org_id = ? AND id = ?").run(org, current.replaces);
        return document(org, id)!;
      });
    },
    failed(org: string, id: string, error: string) {
      db.prepare("UPDATE documents SET status = 'failed', error = ? WHERE org_id = ? AND id = ? AND status = 'processing'")
        .run(error, org, id);
      return document(org, id);
    },
    delete(org: string, id: string) {
      return db.prepare("DELETE FROM documents WHERE org_id = ? AND id = ?").run(org, id).changes > 0;
    },
    search(org: string, question: string): Passage[] {
      const stop = new Set(["what", "which", "when", "where", "how", "does", "with", "have", "from", "that", "will", "about", "please", "could", "would", "tell", "this", "the", "and", "can", "are", "for", "who"]);
      const terms = [...new Set((question.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
        .filter(term => term.length > 2 && !stop.has(term)))].slice(0, 24);
      if (!terms.length) return [];
      const quoted = terms.map(term => `"${term}"`);
      const match = quoted.join(" OR ");
      const hits = all<{ name: string; document_id: string; page: number }>(`
        SELECT d.name, c.document_id, c.page FROM chunk_search
        JOIN chunks c ON c.id = chunk_search.rowid
        JOIN documents d ON d.org_id = c.org_id AND d.id = c.document_id
        WHERE chunk_search MATCH ? AND c.org_id = ? AND d.status = 'ready'
        ORDER BY bm25(chunk_search), c.id LIMIT 30
      `, match, org);
      const pages = new Map<string, typeof hits[number]>();
      for (const hit of hits) pages.set(`${hit.document_id}:${hit.page}`, pages.get(`${hit.document_id}:${hit.page}`) ?? hit);
      return [...pages.values()].slice(0, 6).map((page, index) => {
        const text = pageText(org, page.document_id, page.page);
        return { id: `E${index + 1}`, documentId: page.document_id, name: page.name, page: page.page, text };
      });
    },
    policyContext(org: string, selected: Passage[]): Passage[] {
      const documents = all<{id: string; name: string; pages: number}>(
        "SELECT id, name, pages FROM documents WHERE org_id = ? AND status = 'ready'", org,
      );
      const ids = new Set(selected.map(passage => passage.documentId));
      const context: Passage[] = [];
      // Walk exact document-title cross-references, always inside the resolved organization.
      for (let round = 0; round < documents.length; round++) {
        const pending = documents.filter(doc => ids.has(doc.id) && !context.some(page => page.documentId === doc.id));
        if (!pending.length) break;
        for (const doc of pending) {
          for (let page = 1; page <= doc.pages; page++) {
            const text = pageText(org, doc.id, page);
            context.push({id: `E${context.length + 1}`, documentId: doc.id, name: doc.name, page, text});
            for (const linked of documents) {
              if (text.toLowerCase().includes(linked.name.replace(/\.pdf$/i, "").toLowerCase())) ids.add(linked.id);
            }
          }
        }
      }
      return context;
    },
    count(org: string, event: keyof Usage) {
      db.prepare("INSERT OR IGNORE INTO usage (org_id) VALUES (?)").run(org);
      db.prepare(`UPDATE usage SET ${event} = ${event} + 1 WHERE org_id = ?`).run(org);
    },
    usage(org: string) {
      return one<Usage>(
        "SELECT asked, answered, no_answer, needs_clarification, unresolved, failed FROM usage WHERE org_id = ?", org,
      ) ?? { asked: 0, answered: 0, no_answer: 0, needs_clarification: 0, unresolved: 0, failed: 0 };
    },
  };
}
