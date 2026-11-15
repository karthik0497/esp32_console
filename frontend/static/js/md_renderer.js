/* Zero-dependency Markdown -> HTML renderer with nested list support & TOC extraction for /guide */

(function () {
  function escHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function slugify(str) {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  function formatInline(text) {
    let out = escHtml(text);
    // Inline code first (protect content inside backticks from further regexes)
    const codeTokens = [];
    out = out.replace(/`([^`]+)`/g, (_, inner) => {
      const idx = codeTokens.length;
      codeTokens.push(`<code>${inner}</code>`);
      return `\x00CODE${idx}\x00`;
    });
    // Markdown links [label](url)
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // Bold **text**
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    // Italic *text*
    out = out.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    // Restore code tokens
    out = out.replace(/\x00CODE(\d+)\x00/g, (_, i) => codeTokens[Number(i)]);
    return out;
  }

  window.renderMarkdown = function renderMarkdown(md) {
    const lines = md.replace(/\r\n/g, "\n").split("\n");
    const headings = [];
    const html = [];
    let i = 0;

    function parseIndentedBody(minIndent) {
      const extras = [];
      while (i < lines.length) {
        const ln = lines[i];
        if (ln.trim() === "") {
          i++;
          continue;
        }
        const indent = ln.search(/\S/);
        if (indent < minIndent) break;
        const trimmed = ln.trim();

        // Indented fenced code block
        if (trimmed.startsWith("```")) {
          const lang = trimmed.slice(3).trim();
          const codeLines = [];
          i++;
          while (i < lines.length && !lines[i].trim().startsWith("```")) {
            codeLines.push(lines[i].replace(new RegExp(`^ {0,${indent}}`), ""));
            i++;
          }
          i++;
          extras.push(`<pre><code class="lang-${escHtml(lang)}">${escHtml(codeLines.join("\n"))}</code></pre>`);
          continue;
        }

        // Indented blockquote
        if (trimmed.startsWith(">")) {
          const qLines = [];
          while (i < lines.length && lines[i].trim().startsWith(">")) {
            qLines.push(lines[i].trim().replace(/^>\s?/, ""));
            i++;
          }
          extras.push(`<blockquote>${qLines.map(formatInline).join("<br />")}</blockquote>`);
          continue;
        }

        // Indented sub-bullet list
        if (/^[-*]\s+/.test(trimmed)) {
          const subItems = [];
          while (i < lines.length && lines[i].search(/\S/) >= minIndent && /^[-*]\s+/.test(lines[i].trim())) {
            subItems.push(`<li>${formatInline(lines[i].trim().replace(/^[-*]\s+/, ""))}</li>`);
            i++;
          }
          extras.push(`<ul>${subItems.join("")}</ul>`);
          continue;
        }

        // Indented continuation line
        extras.push(`<p>${formatInline(trimmed)}</p>`);
        i++;
      }
      return extras.join("");
    }

    while (i < lines.length) {
      const line = lines[i];

      // Fenced code blocks
      if (line.trim().startsWith("```")) {
        const lang = line.trim().slice(3).trim();
        const codeLines = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith("```")) {
          codeLines.push(lines[i]);
          i++;
        }
        html.push(`<pre><code class="lang-${escHtml(lang)}">${escHtml(codeLines.join("\n"))}</code></pre>`);
        i++;
        continue;
      }

      // Horizontal rule
      if (/^---+$/.test(line.trim())) {
        html.push("<hr />");
        i++;
        continue;
      }

      // Headings
      const hMatch = line.match(/^(#{1,4})\s+(.*)$/);
      if (hMatch) {
        const level = hMatch[1].length;
        const rawText = hMatch[2].trim();
        const id = slugify(rawText) || `sec-${headings.length}`;
        if (level <= 3) headings.push({ level, text: rawText, id });
        html.push(`<h${level} id="${id}">${formatInline(rawText)}</h${level}>`);
        i++;
        continue;
      }

      // Blockquote
      if (line.trim().startsWith(">")) {
        const qLines = [];
        while (i < lines.length && lines[i].trim().startsWith(">")) {
          qLines.push(lines[i].trim().replace(/^>\s?/, ""));
          i++;
        }
        html.push(`<blockquote>${qLines.map(formatInline).join("<br />")}</blockquote>`);
        continue;
      }

      // Markdown table
      if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:-]+\|/.test(lines[i + 1])) {
        const splitRow = (r) =>
          r
            .trim()
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
            .map((c) => c.trim());
        const headers = splitRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
          rows.push(splitRow(lines[i]));
          i++;
        }
        html.push(
          `<table><thead><tr>${headers.map((h) => `<th>${formatInline(h)}</th>`).join("")}</tr></thead><tbody>` +
            rows.map((r) => `<tr>${r.map((c) => `<td>${formatInline(c)}</td>`).join("")}</tr>`).join("") +
            `</tbody></table>`
        );
        continue;
      }

      // Unordered list (supports nested sub-bullets/code)
      if (/^[-*]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
          const text = lines[i].replace(/^[-*]\s+/, "");
          i++;
          const nested = parseIndentedBody(2);
          items.push(`<li>${formatInline(text)}${nested}</li>`);
        }
        html.push(`<ul>${items.join("")}</ul>`);
        continue;
      }

      // Ordered list (supports nested sub-bullets, blockquotes, code & start index!)
      const olMatch = line.match(/^(\d+)\.\s+/);
      if (olMatch) {
        const startNum = Number(olMatch[1]);
        const items = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
          const text = lines[i].replace(/^\d+\.\s+/, "");
          i++;
          const nested = parseIndentedBody(2);
          items.push(`<li>${formatInline(text)}${nested}</li>`);
        }
        const startAttr = startNum !== 1 ? ` start="${startNum}"` : "";
        html.push(`<ol${startAttr}>${items.join("")}</ol>`);
        continue;
      }

      // Blank line
      if (line.trim() === "") {
        i++;
        continue;
      }

      // Paragraph
      const pLines = [];
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !lines[i].trim().startsWith("```") &&
        !lines[i].trim().startsWith(">") &&
        !/^(#{1,4})\s+/.test(lines[i]) &&
        !/^[-*]\s+/.test(lines[i]) &&
        !/^\d+\.\s+/.test(lines[i]) &&
        !/^---+$/.test(lines[i].trim())
      ) {
        pLines.push(lines[i]);
        i++;
      }
      html.push(`<p>${formatInline(pLines.join(" "))}</p>`);
    }

    return { html: html.join("\n"), headings };
  };
})();
