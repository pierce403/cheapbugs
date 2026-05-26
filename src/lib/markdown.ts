import { escapeHtml } from "./utils";

type CodeCopyHandlers = {
  onCopied?: () => void;
  onError?: (message: string) => void;
};

const linkMarker = (index: number): string => `\uE000CHEAPBUGS_LINK_${index}\uE001`;

const isBlockStart = (line: string): boolean =>
  /^```/.test(line) ||
  /^#{1,4}\s+/.test(line) ||
  /^\s*[-*]\s+/.test(line) ||
  /^\s*\d+\.\s+/.test(line) ||
  /^>\s?/.test(line);

const safeLinkHref = (raw: string): string | null => {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:") {
      return parsed.href;
    }
  } catch {
    return null;
  }
  return null;
};

const renderInlineNoCode = (text: string): string => {
  const links: string[] = [];
  const withLinkMarkers = text.replace(
    /\[([^\]\n]{1,240})\]\(([^)\s]{1,600})\)/g,
    (match, label: string, href: string) => {
      const safeHref = safeLinkHref(href);
      if (!safeHref) {
        return match;
      }
      const marker = linkMarker(links.length);
      links.push(
        `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noreferrer">${escapeHtml(label.trim())}</a>`
      );
      return marker;
    }
  );

  let rendered = escapeHtml(withLinkMarkers)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  links.forEach((link, index) => {
    rendered = rendered.replaceAll(linkMarker(index), link);
  });
  return rendered;
};

const renderInline = (text: string): string => {
  const codeSpans: string[] = [];
  const withCodeMarkers = text.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    const marker = `\uE000CHEAPBUGS_CODE_${codeSpans.length}\uE001`;
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return marker;
  });

  let rendered = renderInlineNoCode(withCodeMarkers);
  codeSpans.forEach((code, index) => {
    rendered = rendered.replaceAll(`\uE000CHEAPBUGS_CODE_${index}\uE001`, code);
  });
  return rendered;
};

const renderCodeBlock = (code: string, language: string): string => {
  const safeLanguage = /^[A-Za-z0-9_-]{1,40}$/.test(language) ? language : "";
  const className = safeLanguage ? ` class="language-${escapeHtml(safeLanguage)}"` : "";
  return `
    <div class="markdown-code-block">
      <button class="copy-code-button" type="button" data-copy-code>copy</button>
      <pre><code${className}>${escapeHtml(code)}</code></pre>
    </div>
  `;
};

const renderList = (items: string[], ordered: boolean): string => {
  const tag = ordered ? "ol" : "ul";
  return `<${tag}>${items.map((item) => `<li>${renderInline(item.trim())}</li>`).join("")}</${tag}>`;
};

export const renderMarkdown = (source: string): string => {
  const normalized = source.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return `<p class="muted-copy">-</p>`;
  }

  const lines = normalized.split("\n");
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```\s*([A-Za-z0-9_-]*)\s*$/);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? "")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push(renderCodeBlock(codeLines.join("\n"), fence[1] ?? ""));
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1]?.length ?? 2, 4);
      blocks.push(`<h${level}>${renderInline(heading[2] ?? "")}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(renderList(items, false));
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^\s*\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push(renderList(items, true));
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? "")) {
        quoteLines.push((lines[index] ?? "").replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(`<blockquote>${quoteLines.map((quoteLine) => renderInline(quoteLine)).join("<br />")}</blockquote>`);
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && (lines[index] ?? "").trim() && !isBlockStart(lines[index] ?? "")) {
      paragraphLines.push((lines[index] ?? "").trim());
      index += 1;
    }
    blocks.push(`<p>${renderInline(paragraphLines.join(" "))}</p>`);
  }

  return blocks.join("");
};

export const bindMarkdownCodeCopy = (root: HTMLElement | Document, handlers: CodeCopyHandlers = {}): void => {
  root.querySelectorAll<HTMLButtonElement>("[data-copy-code]").forEach((button) => {
    button.addEventListener("click", async () => {
      const code = button.closest(".markdown-code-block")?.querySelector("code")?.textContent ?? "";
      try {
        await navigator.clipboard.writeText(code);
        handlers.onCopied?.();
      } catch (error) {
        handlers.onError?.(error instanceof Error ? error.message : "Copy failed.");
      }
    });
  });
};
