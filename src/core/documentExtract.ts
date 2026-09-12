import fetch from "node-fetch";

const MAX_TEXT_CHARS = 300_000; // guard against runaway ingestion of huge pages/files

function htmlToText(html: string): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  // Turn common block-level boundaries into paragraph breaks so retrieval's
  // paragraph-based chunking still gets something sensible out of a page.
  const withBreaks = withoutNoise.replace(
    /<\/(p|div|section|article|li|h[1-6]|br|tr)>/gi,
    "\n\n"
  );

  return withBreaks
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n\n")
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_TEXT_CHARS);
}

/**
 * Fetches a URL and extracts readable text from its HTML for use as a
 * knowledge-base source. Basic tag-stripping rather than a full readability
 * parser — good enough for typical FAQ/docs/product pages.
 */
export async function extractTextFromUrl(url: string): Promise<string> {
  const parsed = new URL(url); // throws on invalid URL
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error("Only http(s) URLs are supported.");
  }

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; AIChatAgentsBot/1.0)" },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch URL (${res.status})`);
  }
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("html") && !contentType.includes("text")) {
    throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
  }

  const html = await res.text();
  const text = htmlToText(html);
  if (!text) throw new Error("No readable text found on that page.");
  return text;
}

/**
 * Extracts plain text from an uploaded file buffer based on its extension.
 * Supports .txt/.md (as-is), .pdf (pdf-parse), and .docx (mammoth).
 */
export async function extractTextFromFile(buffer: Buffer, filename: string): Promise<string> {
  const ext = (filename.split(".").pop() || "").toLowerCase();

  if (ext === "txt" || ext === "md") {
    return buffer.toString("utf-8").slice(0, MAX_TEXT_CHARS);
  }

  if (ext === "pdf") {
    const pdfParse = (await import("pdf-parse")).default;
    const result = await pdfParse(buffer);
    return result.text.trim().slice(0, MAX_TEXT_CHARS);
  }

  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim().slice(0, MAX_TEXT_CHARS);
  }

  throw new Error(`Unsupported file type ".${ext}". Supported: .txt, .md, .pdf, .docx`);
}
