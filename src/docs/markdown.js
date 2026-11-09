const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Solo enlaces web o anclas internas: nada de `javascript:` ni rutas del repositorio que aquí no existen.
const safeHref = (href) => (/^(https?:\/\/|#)/i.test(href) ? href : null);

// Formato dentro de una línea: `código`, **negrita** y [enlaces](url). El texto se escapa antes de dar formato.
function inline(text) {
  const codes = [];
  let out = escapeHtml(text).replace(/`([^`]+)`/g, (_, code) => `\u0000${codes.push(`<code>${code}</code>`) - 1}\u0000`);
  out = out
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
      const safe = safeHref(href.replace(/&amp;/g, '&'));
      return safe ? `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
    });
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

const splitRow = (line) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
const isTableSeparator = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
const slug = (text) => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Convierte el subconjunto de Markdown que usa docs/API.md (títulos, párrafos, listas, tablas, bloques de código,
// reglas horizontales, negrita, código y enlaces) en HTML. Todo el texto se escapa.
export function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const code = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
      i++;
      html.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level} id="${slug(heading[2])}">${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^---+\s*$/.test(line)) {
      html.push('<hr>');
      i++;
      continue;
    }

    if (line.includes('|') && isTableSeparator(lines[i + 1] ?? '')) {
      const head = splitRow(line);
      const rows = [];
      for (i += 2; i < lines.length && lines[i].includes('|') && lines[i].trim(); i++) rows.push(splitRow(lines[i]));
      const cells = (tag, row) => row.map((cell) => `<${tag}>${inline(cell)}</${tag}>`).join('');
      html.push(`<div class="table"><table><thead><tr>${cells('th', head)}</tr></thead><tbody>${rows.map((row) => `<tr>${cells('td', row)}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        let text = lines[i].replace(/^\s*[-*]\s+/, '');
        for (i++; i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i]); i++) text += ` ${lines[i].trim()}`;
        items.push(`<li>${inline(text)}</li>`);
      }
      html.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const paragraph = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|---+\s*$|\s*[-*]\s+)/.test(lines[i]) && !(lines[i].includes('|') && isTableSeparator(lines[i + 1] ?? ''))) {
      paragraph.push(lines[i].trim());
      i++;
    }
    html.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }

  return html.join('\n');
}

const PAGE_STYLE = `
  :root { color-scheme: dark; }
  body { margin: 0; background: #11151c; color: #d8dee9; font: 15px/1.55 system-ui, sans-serif; }
  main { max-width: 980px; margin: 0 auto; padding: 24px 20px 80px; }
  h1, h2, h3, h4 { color: #fff; line-height: 1.25; }
  h2 { margin-top: 2.2em; border-bottom: 1px solid #2c3442; padding-bottom: .3em; }
  a { color: #6cb6ff; }
  code { background: #1d2430; padding: .1em .35em; border-radius: 4px; font-size: .9em; }
  pre { background: #0b0e13; border: 1px solid #2c3442; border-radius: 6px; padding: 12px 14px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  .table { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #2c3442; padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: #1d2430; }
  hr { border: 0; border-top: 1px solid #2c3442; margin: 2em 0; }
`;

// Página HTML completa y autocontenida (sin scripts ni recursos externos).
export function renderDocsPage(markdown, title = 'API de SmartCity') {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title><style>${PAGE_STYLE}</style></head>
<body><main>
${markdownToHtml(markdown)}
</main></body></html>
`;
}
