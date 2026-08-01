// Vercel Serverless Function — POST /api/recipes
// Keeps your Anthropic API key on the server. The browser never sees it.
//
// Setup: in your Vercel project, add an Environment Variable named
//   ANTHROPIC_API_KEY = your key from https://console.anthropic.com
// then redeploy.

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  return await new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch (e) { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

function extractRecipes(text) {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch (e) {}
  }
  try { return JSON.parse(t); } catch (e) {}
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "The server is missing its ANTHROPIC_API_KEY. Add it in your Vercel project settings, then redeploy." });
    return;
  }

  const body = await readBody(req);
  const ingredients = Array.isArray(body.ingredients) ? body.ingredients.filter(Boolean) : [];
  if (ingredients.length === 0) {
    res.status(400).json({ error: "No ingredients were sent." });
    return;
  }

  const prompt =
    "I have these ingredients at home: " + ingredients.join(", ") + ". " +
    "Search the web for the highest-rated, most popular meals I can make mainly from these ingredients. " +
    "Return ONLY a JSON array of 4 recipes and nothing else — no explanation, no markdown fences. " +
    "Each object must have exactly these keys: " +
    '"name" (string), "rating" (number from 1 to 5), "description" (one short sentence), ' +
    '"have" (array of my ingredients the recipe uses), "need" (array of common items I would still need to buy), ' +
    '"source" (the website name), "url" (link to the recipe page). ' +
    "Sort the array by rating, highest first.";

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        // A current model that supports web search. Swap for another if you like
        // (e.g. "claude-sonnet-5", "claude-haiku-4-5" for cheaper/faster).
        model: "claude-sonnet-4-5",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
      }),
    });

    const data = await r.json();
    if (data.error) {
      res.status(502).json({ error: data.error.message || "The AI request failed." });
      return;
    }

    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const recipes = extractRecipes(text);
    if (!recipes || !Array.isArray(recipes) || recipes.length === 0) {
      res.status(502).json({ error: "Couldn't read recipes from the response. Try again." });
      return;
    }

    res.status(200).json({ recipes });
  } catch (e) {
    res.status(500).json({ error: "Something went wrong reaching the AI service." });
  }
}
