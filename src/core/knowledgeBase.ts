import fs from "fs";
import path from "path";

const KNOWLEDGE_DIR = path.join(process.cwd(), "knowledge");
const MAX_CHUNK_CHARS = 800;
const TOP_K = 4;
const MIN_SCORE = 0.05;

const STOPWORDS = new Set(
  "a an the is are was were be been being to of in on for with and or but if then so as at by from this that it its your you we our i my me they them he she his her not no do does did can could should would will just about into over under how what when where why who which".split(
    " "
  )
);

interface Chunk {
  text: string;
  source: string;
  termFreq: Map<string, number>;
}

let chunks: Chunk[] = [];
let idf: Map<string, number> = new Map();
let loaded = false;

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

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(walkFiles(full));
    } else if (/\.(txt|md)$/i.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Loads every .txt/.md file under ./knowledge, splits each into paragraph-sized
 * chunks, and builds a simple TF-IDF index so replies can be grounded in your
 * own content without needing a vector database. Call reloadKnowledgeBase()
 * again any time you add/edit files (or hit POST /knowledge/reload).
 */
export function reloadKnowledgeBase(): { files: number; chunks: number } {
  const files = walkFiles(KNOWLEDGE_DIR);
  chunks = [];

  for (const file of files) {
    const raw = fs.readFileSync(file, "utf-8");
    const source = path.relative(KNOWLEDGE_DIR, file);
    for (const text of splitIntoChunks(raw)) {
      const termFreq = new Map<string, number>();
      for (const term of tokenize(text)) {
        termFreq.set(term, (termFreq.get(term) ?? 0) + 1);
      }
      chunks.push({ text, source, termFreq });
    }
  }

  // Document frequency -> IDF, so common words across the whole knowledge base
  // count for less than distinctive ones.
  const docFreq = new Map<string, number>();
  for (const chunk of chunks) {
    for (const term of chunk.termFreq.keys()) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }
  idf = new Map();
  for (const [term, df] of docFreq) {
    idf.set(term, Math.log((chunks.length + 1) / (df + 0.5)) + 1);
  }

  loaded = true;
  console.log(`[knowledge] loaded ${files.length} file(s) into ${chunks.length} chunk(s)`);
  return { files: files.length, chunks: chunks.length };
}

function scoreChunk(queryTerms: string[], chunk: Chunk): number {
  let score = 0;
  for (const term of queryTerms) {
    const tf = chunk.termFreq.get(term);
    if (!tf) continue;
    score += tf * (idf.get(term) ?? 0);
  }
  return score;
}

/**
 * Returns up to TOP_K relevant chunks of knowledge-base text for the given
 * user message, formatted for inclusion in the system prompt. Empty string
 * if no knowledge base is loaded or nothing scores above the relevance floor.
 */
export function retrieveContext(message: string): string {
  if (!loaded) reloadKnowledgeBase();
  if (chunks.length === 0) return "";

  const queryTerms = tokenize(message);
  if (queryTerms.length === 0) return "";

  const scored = chunks
    .map((chunk) => ({ chunk, score: scoreChunk(queryTerms, chunk) }))
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

export function knowledgeBaseStatus(): { loaded: boolean; chunks: number } {
  return { loaded, chunks: chunks.length };
}
