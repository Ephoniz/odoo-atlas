import { useMemo } from "react";

type Lang = "py" | "js" | "xml";

const PY_KW = /\b(def|class|return|if|elif|else|for|in|not|and|or|is|None|True|False|import|from|as|with|try|except|finally|raise|yield|lambda|pass|break|continue|while|async|await|self|super|del|global|nonlocal|assert)\b/g;
const JS_KW = /\b(const|let|var|function|return|if|else|for|of|in|new|class|extends|static|async|await|this|super|import|export|from|default|null|undefined|true|false|typeof|instanceof|try|catch|finally|throw|switch|case|break|continue|while|do|get|set)\b/g;

/** Small, dependency-free highlighter. Good enough for reading, not for parsing. */
export function highlight(src: string, lang: Lang): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (lang === "xml") {
    return esc(src)
      .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="c">$1</span>')
      .replace(/(&lt;\/?)([\w:.-]+)/g, '$1<span class="t">$2</span>')
      .replace(/([\w:.-]+)=(&quot;|")([^"]*)(&quot;|")/g, '<span class="n">$1</span>=<span class="s">"$3"</span>');
  }
  // Tokenise: strings, comments, rest.
  const out: string[] = [];
  const re = lang === "py"
    ? /("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|#[^\n]*|@[\w.]+)/g
    : /(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const plain = (s: string) => esc(s).replace(lang === "py" ? PY_KW : JS_KW, '<span class="k">$1</span>');
  while ((m = re.exec(src))) {
    out.push(plain(src.slice(last, m.index)));
    const tok = m[0];
    if (tok.startsWith("#") || tok.startsWith("//") || tok.startsWith("/*")) out.push(`<span class="c">${esc(tok)}</span>`);
    else if (tok.startsWith("@")) out.push(`<span class="d">${esc(tok)}</span>`);
    else out.push(`<span class="s">${esc(tok)}</span>`);
    last = m.index + tok.length;
  }
  out.push(plain(src.slice(last)));
  return out.join("");
}

export function Source({ code, lang, dedent = true }: { code: string; lang: Lang; dedent?: boolean }) {
  const html = useMemo(() => {
    let src = code;
    if (dedent) {
      const lines = src.split("\n");
      const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)![0].length);
      const min = indents.length ? Math.min(...indents) : 0;
      src = lines.map((l) => l.slice(min)).join("\n");
    }
    return highlight(src, lang);
  }, [code, lang, dedent]);
  return <pre className="src" dangerouslySetInnerHTML={{ __html: html }} />;
}
