import fs from "node:fs";
import Parser from "rss-parser";

const body = process.env.ISSUE_BODY || "";
const result = { ok: false, message: "" };
const done = (ok, message) => {
  result.ok = ok;
  result.message = message;
  fs.writeFileSync("add-source-result.json", JSON.stringify(result));
  process.exit(0);
};

const urlMatch = body.match(/https?:\/\/[^\s<>"')]+/i);
if (!urlMatch) done(false, "Aucune URL trouvée dans l'issue.");
const nameMatch = body.match(/^\s*Nom\s*:\s*(.+)$/im);

const headers = { "User-Agent": "Mozilla/5.0 (compatible; veille-equipe/1.0)" };
const parser = new Parser();

async function tryFeed(url) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000), redirect: "follow" });
    if (!res.ok) return null;
    const text = await res.text();
    if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(text.slice(0, 2000))) return { html: text, base: res.url };
    const feed = await parser.parseString(text);
    return { feed, url: res.url };
  } catch {
    return null;
  }
}

async function resolveFeed(input) {
  const first = await tryFeed(input);
  if (first?.feed) return { url: input, title: first.feed.title };
  const candidates = [];
  if (first?.html) {
    const re = /<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/gi;
    for (const tag of first.html.match(re) || []) {
      const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
      if (href) candidates.push(new URL(href, first.base).href);
    }
  }
  const origin = new URL(input).origin;
  candidates.push(...["/feed", "/feed/", "/rss", "/rss.xml", "/atom.xml", "/index.xml"].map((p) => origin + p));
  for (const c of [...new Set(candidates)]) {
    const r = await tryFeed(c);
    if (r?.feed) return { url: c, title: r.feed.title };
  }
  return null;
}

const found = await resolveFeed(urlMatch[0]);
if (!found) done(false, `Aucun flux RSS/Atom détecté pour ${urlMatch[0]}. Indiquez l'URL exacte du flux.`);

const config = JSON.parse(fs.readFileSync("sources.json", "utf8"));
const norm = (u) => u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
if (config.sources.some((s) => norm(s.url) === norm(found.url))) {
  done(false, `Cette source est déjà suivie (${found.url}).`);
}

const name = (nameMatch?.[1] || found.title || new URL(found.url).hostname).trim().slice(0, 80);
config.sources.push({ name, url: found.url });
fs.writeFileSync("sources.json", JSON.stringify(config, null, 2) + "\n");
done(true, `Source **${name}** ajoutée (${found.url}). Le site sera mis à jour dans quelques minutes.`);
