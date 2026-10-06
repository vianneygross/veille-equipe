import fs from "node:fs";
import Parser from "rss-parser";

const config = JSON.parse(fs.readFileSync("sources.json", "utf8"));
const OUT = "site/data/items.json";
const MAX_AGE_DAYS = 30;
const MAX_ITEMS = 300;
const MAX_NEW_PER_RUN = 40;
const MIN_SCORE = 5;

const API_KEY = process.env.LLM_API_KEY || process.env.GITHUB_TOKEN;
const BASE_URL = process.env.LLM_BASE_URL || "https://models.github.ai/inference";
const MODEL = process.env.LLM_MODEL || "openai/gpt-4o-mini";

const parser = new Parser({ timeout: 15000, headers: { "User-Agent": "veille-equipe/1.0" } });

const strip = (s = "") => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

async function analyze(item) {
  const prompt = `Tu es analyste de veille pour une équipe produit/marketing (sujets: ${config.topics.join(", ")}).
Évalue l'article ci-dessous. Réponds uniquement en JSON:
{"score": 0-10 (utilité concrète pour l'équipe), "topics": [sous-ensemble de la liste des sujets], "summary": "2 phrases en français, faits et enseignements actionnables", "takeaway": "1 action concrète à retenir"}

Titre: ${item.title}
Source: ${item.source}
Extrait: ${item.excerpt}`;
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`LLM ${res.status}: ${raw.slice(0, 200)}`);
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`LLM réponse non-JSON (${res.status}) via ${BASE_URL}: ${raw.slice(0, 200)}`);
  }
  const txt = data.choices[0].message.content;
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw Object.assign(new Error("réponse non-JSON"), { soft: true });
  try {
    return JSON.parse(m[0]);
  } catch {
    throw Object.assign(new Error("JSON invalide"), { soft: true });
  }
}

function fallback(item) {
  return { score: 6, topics: [], summary: item.excerpt.slice(0, 220), takeaway: "" };
}

const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { items: [] };
const known = new Map(existing.items.map((i) => [i.url, i]));
const cutoff = Date.now() - MAX_AGE_DAYS * 864e5;

const fresh = [];
for (const src of config.sources) {
  try {
    const resp = await fetch(src.url, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; veille-equipe/1.0)" },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const feed = await parser.parseString(await resp.text());
    console.log(`ok ${src.name}: ${feed.items.length}`);
    for (const e of feed.items) {
      const url = e.link;
      const date = new Date(e.isoDate || e.pubDate || Date.now()).getTime();
      if (!url || known.has(url) || date < cutoff) continue;
      fresh.push({
        url,
        title: strip(e.title),
        source: src.name,
        date: new Date(date).toISOString(),
        excerpt: strip(e.contentSnippet || e.content || e.summary || "").slice(0, 1200),
      });
    }
  } catch (err) {
    console.warn(`⚠ ${src.name}: ${err.message}`);
  }
}

fresh.sort((a, b) => b.date.localeCompare(a.date));
const toProcess = fresh.slice(0, MAX_NEW_PER_RUN);
console.log(`${fresh.length} nouveaux articles, ${toProcess.length} analysés`);

let llmOk = Boolean(API_KEY);
for (const item of toProcess) {
  console.log(`-> ${item.source}: ${item.title.slice(0, 60)}`);
  let result;
  if (llmOk) {
    try {
      result = await analyze(item);
    } catch (err) {
      console.warn(`⚠ ${err.message}`);
      if (!err.soft) llmOk = false;
      result = fallback(item);
    }
  } else {
    result = fallback(item);
  }
  const score = Number(result.score) || 0;
  if (score < MIN_SCORE) continue;
  known.set(item.url, {
    url: item.url,
    title: item.title,
    source: item.source,
    date: item.date,
    score,
    topics: (result.topics || []).filter((t) => config.topics.includes(t)),
    summary: result.summary,
    takeaway: result.takeaway || "",
  });
}

const items = [...known.values()]
  .filter((i) => new Date(i.date).getTime() >= cutoff)
  .sort((a, b) => b.date.localeCompare(a.date))
  .slice(0, MAX_ITEMS);

fs.mkdirSync("site/data", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), topics: config.topics, items }, null, 1));
console.log(`✔ ${items.length} articles au total`);
