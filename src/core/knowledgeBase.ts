import { db } from "../firebaseAdmin";

const MAX_CHUNK_CHARS = 800;
const TOP_K = 4;
const MIN_SCORE = 0.05;
const CACHE_TTL_MS = 60_000;

const STOPWORDS = new Set(
  "a an the is are was were be been being to of in on for with and or but if then so as at by from this that it its your you we our i my me they them he she his her not no do does did can could should would will just about into over under how what when where why who which".split(
    " "
  )
);

interface StoredChunk {
  text: string;
  source: string;
}

interface IndexedChunk extends StoredChunk {
  id: string;
  termFreq: Map<string, number>;
}

interface TenantIndex {
  chunks: IndexedChunk[];
  idf: Map<string, number>;
  expiresAt: number;
}

const cache = new Map<string, TenantIndex>();

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function splitIntoChunks(text: string): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const result: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if ((current + "\n\n" + p).length > MAX_CHUNK_CHARS && current) {
      result.push(current);
      current = p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current) result.push(current);
  return result;
}

function knowledgeCollection(tenantId: string) {
  return db.collection("tenants").doc(tenantId).collection("knowledge");
}

/**
 * Splits raw text into paragraph-sized chunks and stores each as its own
 * Firestore document for this tenant. Call once per source document (an
 * uploaded file, a pasted FAQ, etc.) — `source` is just a label shown back
 * in retrieved context, e.g. a filename or "Refund Policy".
 */
export async function addKnowledgeText(tenantId: string, source: string, text: string): Promise<number> {
  const chunks = splitIntoChunks(text);
  const batch = db.batch();
  for (const chunkText of chunks) {
    const ref = knowledgeCollection(tenantId).doc();
    batch.set(ref, { text: chunkText, source });
  }
  await batch.commit();
  cache.delete(tenantId);
  return chunks.length;
}

export async function clearKnowledge(tenantId: string): Promise<void> {
  const snap = await knowledgeCollection(tenantId).get();
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  cache.delete(tenantId);
}

export async function listKnowledgeSources(tenantId: string): Promise<{ id: string; source: string }[]> {
  const snap = await knowledgeCollection(tenantId).get();
  return snap.docs.map((doc) => ({ id: doc.id, source: (doc.data().source as string) ?? "" }));
}

async function loadIndex(tenantId: string): Promise<TenantIndex> {
  const cached = cache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const snap = await knowledgeCollection(tenantId).get();
  const chunks: IndexedChunk[] = snap.docs.map((doc) => {
    const data = doc.data() as StoredChunk;
    const termFreq = new Map<string, number>();
    for (const term of tokenize(data.text)) {
      termFreq.set(term, (termFreq.get(term) ?? 0) + 1);
    }
    return { id: doc.id, text: data.text, source: data.source, termFreq };
  });

  const docFreq = new Map<string, number>();
  for (const chunk of chunks) {
    for (const term of chunk.termFreq.keys()) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [term, df] of docFreq) {
    idf.set(term, Math.log((chunks.length + 1) / (df + 0.5)) + 1);
  }

  const index: TenantIndex = { chunks, idf, expiresAt: Date.now() + CACHE_TTL_MS };
  cache.set(tenantId, index);
  return index;
}

function scoreChunk(queryTerms: string[], chunk: IndexedChunk, idf: Map<string, number>): number {
  let score = 0;
  for (const term of queryTerms) {
    const tf = chunk.termFreq.get(term);
    if (!tf) continue;
    score += tf * (idf.get(term) ?? 0);
  }
  return score;
}

/**
 * Returns up to TOP_K relevant chunks of this tenant's knowledge base for
 * the given message, formatted for inclusion in the system prompt. Empty
 * string if the tenant has no knowledge base or nothing scores above the
 * relevance floor. Retrieval uses lightweight TF-IDF over an in-memory,
 * per-tenant index refreshed from Firestore every CACHE_TTL_MS.
 */
export async function retrieveContext(tenantId: string, message: string): Promise<string> {
  const { chunks, idf } = await loadIndex(tenantId);
  if (chunks.length === 0) return "";

  const queryTerms = tokenize(message);
  if (queryTerms.length === 0) return "";

  const scored = chunks
    .map((chunk) => ({ chunk, score: scoreChunk(queryTerms, chunk, idf) }))
    .filter((s) => s.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);

  if (scored.length === 0) return "";

  const blocks = scored.map((s, i) => `[${i + 1}] (from ${s.chunk.source})\n${s.chunk.text}`).join("\n\n");

  return [
    "Reference information from our knowledge base (use it to answer if relevant; ignore it if it isn't):",
    blocks,
  ].join("\n\n");
}
