// bitrecipe AI chef: "what do you want to make?" in, a bitrecipe-format recipe out.
// Engines, picked in the app: Claude (best quality), Gemini, Groq, Cerebras, OpenRouter.
//
// The API keys live only here, as Edge Function secrets (any of them):
// ANTHROPIC_API_KEY, GEMINI_API_KEY, GROQ_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY. The app calls this function with the signed-in 128bit
// user's token; each account gets a daily limit (bitrecipe_ai_take in
// supabase/bitrecipe-ai.sql) so nobody can run up the bill.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";

const MODEL = "claude-opus-5-5";
// Groq: OpenAI-compatible API; gpt-oss-120b supports strict JSON-schema output.
const GROQ_MODEL = Deno.env.get("GROQ_MODEL") ?? "openai/gpt-oss-120b";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
// Cerebras and OpenRouter: OpenAI-compatible, like Groq.
const CEREBRAS_MODEL = Deno.env.get("CEREBRAS_MODEL") ?? "gpt-oss-120b";
// OpenRouter's free models change often: unless OPENROUTER_MODEL is set, pick from
// the live list of free models that support structured outputs (best first).
const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") ?? "";
const OPENROUTER_PREFER = [
  "nvidia/nemotron-3.5-super-vl:free", "baidu/ernie-5.5-flash-preview:free",
  "dots-studio/dots-3-note-preview:free", "particle-ai/particle-1:free",
];
// Gemini: generateContent with a JSON-schema response constraint.
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.8-flash";
const GEMINI_URL = (m: string) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
const DAILY_LIMIT = Number(Deno.env.get("BITRECIPE_AI_DAILY_LIMIT") ?? "25");

const UNITS = ["", "g", "kg", "oz", "lb", "ml", "l", "tsp", "tbsp", "cup", "fl oz", "clove", "can", "pinch", "dash", "slice", "stick", "sprig", "bunch", "head", "piece", "packet", "jar", "knob", "sheet", "fillet", "stalk", "leaf"];
const LANE = { type: "string", enum: ["A", "B", "C"] };
const NUM_OR_NULL = { anyOf: [{ type: "number" }, { type: "null" }] };
const STR_OR_NULL = { anyOf: [{ type: "string" }, { type: "null" }] };

// The exact shape bitrecipe stores (see app/js/samples.js).
const RECIPE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "servings", "servingsLabel", "time", "equipment", "lanes", "ingredients", "steps", "tips"],
  properties: {
    title: { type: "string" },
    servings: { type: "integer" },
    servingsLabel: { type: "string", description: "servings, people, cookies, bowls, slices…" },
    time: {
      type: "object", additionalProperties: false, required: ["active", "total"],
      properties: { active: { type: "integer" }, total: { type: "integer" } },
    },
    equipment: { type: "array", items: { type: "string" } },
    lanes: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["id", "name"], properties: { id: LANE, name: { type: "string" } } },
    },
    ingredients: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "qty", "qty2", "unit", "item", "prep", "loose"],
        properties: {
          id: { type: "string", description: "short lowercase id, e.g. flour, butter2" },
          qty: NUM_OR_NULL,
          qty2: { ...NUM_OR_NULL, description: "upper end of a range (1–2 tbsp), else null" },
          unit: { type: "string", enum: UNITS },
          item: { type: "string", description: "singular for counted things: egg, clove" },
          prep: { type: "string", description: "chopped, softened… or empty" },
          loose: { ...STR_OR_NULL, description: "'to taste' / 'for garnish' when qty is null, else null" },
        },
      },
    },
    steps: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["lane", "text", "merges", "timer", "wait"],
        properties: {
          lane: LANE,
          text: { type: "string" },
          merges: { type: "array", items: LANE },
          timer: {
            anyOf: [
              { type: "null" },
              { type: "object", additionalProperties: false, required: ["min", "label"], properties: { min: { type: "integer" }, label: { type: "string" } } },
            ],
          },
          wait: { type: "boolean" },
        },
      },
    },
    tips: { type: "array", items: { type: "string" } },
  },
};

const SYSTEM = `You are the chef inside bitrecipe, a home-cooking app. Write one complete, reliable recipe for what the cook asks for, in bitrecipe's recipe format.

How bitrecipe recipes work:
- Tracks (lanes): each bowl, pan, pot or appliance is a track, A, B or C (never more than 3). Name them by the vessel ("Dry bowl", "Pan", "Oven"). Use one track for a simple recipe; use more only when two things genuinely happen at the same time.
- Steps are in the order the cook does them. Each step has a track. When a step combines another track into this one (pour the sauce into the pan), list that track in "merges"; a merged track ends there. Put "preheat the oven" on an Oven track early, and have the baking step merge into it.
- Amounts live inside steps: write {id} the first time a step uses an ingredient (e.g. "Whisk {flour} and {salt}"). The app replaces it with the scaled amount and name, so don't also write the amount or the name next to it. If an ingredient is split across steps, use {id*0.5} style parts that add up to 1.
- Every ingredient must be used in at least one step.
- Give a step a timer (whole minutes and a short label like "Simmer sauce") when it takes a set time. Set "wait" true for hands-off steps (resting, baking, chilling, simmering unattended).
- Ingredients: realistic home quantities with a unit from the list; use "" for counted items (2 egg). Use qty null with loose "to taste" only for seasoning to taste.
- time.active is hands-on minutes; time.total is start to finish.
- tips: 0–3 short, genuinely useful tips (substitutions, make-ahead, doneness cues).
Keep step text short, clear and friendly. Follow the cook's diet, allergy and equipment notes strictly. If they list ingredients they have, build around those.`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Count this request against the signed-in account's daily limit.
async function takeQuota(auth: string): Promise<number> {
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/bitrecipe_ai_take`, {
    method: "POST",
    headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY")!, Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ daily_limit: DAILY_LIMIT }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = String(body?.message ?? "");
    if (/limit/i.test(msg)) throw Object.assign(new Error(`You've used today's ${DAILY_LIMIT} AI recipes. More tomorrow!`), { status: 429 });
    if (/sign in|permission denied|jwt/i.test(msg) || res.status === 401) throw Object.assign(new Error("Sign in to your 128bit account to use the AI chef."), { status: 401 });
    throw Object.assign(new Error("The 128bit server isn't set up for the AI chef yet (run supabase/bitrecipe-ai.sql)."), { status: 503 });
  }
  return Number(body);
}

function buildPrompt(b: Record<string, unknown>): string {
  const lines = [`What I want to make: ${String(b.prompt ?? "").slice(0, 600)}`];
  if (b.servings) lines.push(`Servings: ${Number(b.servings)}`);
  if (b.diet) lines.push(`Diet / allergies / avoid: ${String(b.diet).slice(0, 300)}`);
  if (b.time) lines.push(`Time I have: ${String(b.time).slice(0, 60)}`);
  if (b.equipment) lines.push(`Equipment notes: ${String(b.equipment).slice(0, 200)}`);
  if (Array.isArray(b.have) && b.have.length) lines.push(`Ingredients I already have (use what fits): ${b.have.slice(0, 60).map(String).join(", ")}`);
  lines.push(`Units: ${b.units === "us" ? "US cups, tbsp, tsp, oz, lb" : b.units === "metric" ? "metric (g, ml) with tsp/tbsp for small amounts" : "whatever is most natural for this dish"}`);
  if (b.base && typeof b.base === "object") {
    lines.push(`\nChange this existing recipe as asked above, keeping what still works:\n${JSON.stringify(b.base).slice(0, 12000)}`);
  }
  return lines.join("\n");
}

type Recipe = {
  ingredients: { id: string }[];
  steps: { text: string; lane: string; merges: string[] }[];
  lanes: { id: string; name: string }[];
};

// Small clean-ups so the app never shows a broken token or track.
function tidy(r: Recipe): Recipe {
  const ids = new Set(r.ingredients.map((i) => i.id));
  const lanes = new Set(r.lanes.map((l) => l.id));
  for (const s of r.steps) {
    s.text = s.text.replace(/\{([\w-]+)(\*[\d.]+)?\}/g, (all, id) => (ids.has(id) ? all : id));
    if (!lanes.has(s.lane)) { r.lanes.push({ id: s.lane, name: `Track ${s.lane}` }); lanes.add(s.lane); }
    s.merges = s.merges.filter((m) => m !== s.lane && lanes.has(m));
  }
  return r;
}

const fail = (code: number, message: string) => Object.assign(new Error(message), { status: code });

async function withClaude(prompt: string): Promise<{ recipe: Recipe; model: string }> {
  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY"), timeout: 120_000, maxRetries: 1 });
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: RECIPE_SCHEMA } },
      // If the model declines a request for safety reasons, retry on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason === "refusal") throw fail(422, "The AI chef can't help with that one. Try asking for a different dish.");
    if (response.stop_reason === "max_tokens") throw fail(502, "That recipe came out too long. Try something a bit simpler.");
    const text = response.content.find((b: { type: string }) => b.type === "text") as { text: string } | undefined;
    if (!text) throw fail(502, "The AI chef didn't send a recipe. Try again.");
    return { recipe: JSON.parse(text.text), model: response.model };
  } catch (e) {
    if ((e as { status?: number }).status && !(e instanceof Anthropic.APIError)) throw e;
    if (e instanceof Anthropic.RateLimitError) throw fail(429, "The AI chef is busy. Try again in a minute.");
    if (e instanceof Anthropic.AuthenticationError) throw fail(503, "Claude isn't connected yet (ANTHROPIC_API_KEY secret missing or wrong).");
    if (e instanceof Anthropic.APIConnectionError) throw fail(504, "Couldn't reach Claude. Try again.");
    if (e instanceof Anthropic.APIError) throw fail(502, `Claude error ${e.status}. Try again.`);
    throw e;
  }
}

// One helper for every OpenAI-compatible engine (Groq, Cerebras, OpenRouter).
// Asks for the strict recipe schema first; if that engine/model can't do it,
// asks again with the schema written into the instructions. normalize() then
// guarantees a valid recipe either way.
type Compat = { name: string; url: string; key: string; model: string; tokensParam?: string; headers?: Record<string, string>; body?: Record<string, unknown> };
async function compatEngine(c: Compat, prompt: string): Promise<{ recipe: Recipe; model: string }> {
  const call = async (strictSchema: boolean) => {
    const system = strictSchema ? SYSTEM : `${SYSTEM}\n\nReply with only a JSON object matching this JSON Schema:\n${JSON.stringify(RECIPE_SCHEMA)}`;
    try {
      return await fetch(c.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${Deno.env.get(c.key)}`, "Content-Type": "application/json", ...(c.headers ?? {}) },
        body: JSON.stringify({
          model: c.model,
          [c.tokensParam ?? "max_completion_tokens"]: 16000,
          messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
          response_format: strictSchema
            ? { type: "json_schema", json_schema: { name: "bitrecipe_recipe", strict: true, schema: RECIPE_SCHEMA } }
            : { type: "json_object" },
          ...(c.body ?? {}),
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch { throw fail(504, `Couldn't reach ${c.name}. Try again.`); }
  };
  let res = await call(true);
  let json = await res.json().catch(() => null);
  const errText = () => JSON.stringify(json ?? "");
  if ((res.status === 400 || res.status === 404 || res.status === 422) && /schema|response_format|structured|json|support|endpoints?/i.test(errText()) && !/model.*(not exist|not found|invalid)/i.test(errText())) {
    res = await call(false);
    json = await res.json().catch(() => null);
  }
  if (res.status === 401 || res.status === 403) throw fail(503, `${c.name} isn't connected yet (${c.key} secret missing or wrong).`);
  if (res.status === 402) throw fail(503, `${c.name} needs credits on your account. Switch engines or top it up.`);
  if (res.status === 429) throw fail(429, `${c.name} is busy or out of free requests for today. Try another engine.`);
  if (res.status === 404 || (res.status === 400 && /model/i.test(errText()))) {
    throw fail(502, /endpoints/i.test(errText())
      ? `${c.name}'s ${c.model} can't take recipe requests right now. Try again or switch engines.`
      : `${c.name} can't find the model ${c.model}. Set the ${c.key.replace("_API_KEY", "_MODEL")} secret.`);
  }
  if (!res.ok) throw fail(502, `${c.name} error ${res.status}. Try again.`);
  const choice = json?.choices?.[0];
  if (choice?.finish_reason === "length") throw fail(502, "That recipe came out too long. Try something a bit simpler.");
  if (choice?.finish_reason === "content_filter") throw fail(422, "The AI chef can't help with that one. Try asking for a different dish.");
  const content = String(choice?.message?.content ?? "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  if (!content) throw fail(502, `${c.name} didn't send a recipe. Try again.`);
  return { recipe: normalize(JSON.parse(content)), model: json?.model ?? c.model };
}

const withGroq = (p: string) => compatEngine({ name: "Groq", url: GROQ_URL, key: "GROQ_API_KEY", model: GROQ_MODEL }, p);
const withCerebras = (p: string) => compatEngine({ name: "Cerebras", url: "https://api.cerebras.ai/v1/chat/completions", key: "CEREBRAS_API_KEY", model: CEREBRAS_MODEL }, p);
let orCache: { at: number; ids: string[] } | null = null;
async function openRouterModels(): Promise<string[]> {
  if (OPENROUTER_MODEL) return [OPENROUTER_MODEL];
  if (orCache && Date.now() - orCache.at < 6 * 3600_000) return orCache.ids;
  let ids: string[] = [];
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(15_000) });
    const list = ((await res.json())?.data ?? []) as { id: string; supported_parameters?: string[] }[];
    const free = list.filter((m) => m.id.endsWith(":free"));
    const so = free.filter((m) => m.supported_parameters?.includes("structured_outputs")).map((m) => m.id);
    const rf = free.filter((m) => m.supported_parameters?.includes("response_format")).map((m) => m.id);
    ids = [...OPENROUTER_PREFER.filter((id) => so.includes(id)), ...so, ...rf];
  } catch { /* use the built-in list */ }
  ids = [...new Set(ids.length ? ids : OPENROUTER_PREFER)];
  orCache = { at: Date.now(), ids };
  return ids;
}
async function withOpenRouter(p: string): Promise<{ recipe: Recipe; model: string }> {
  const models = (await openRouterModels()).slice(0, 3);
  let last: unknown;
  for (const model of models) {
    try {
      return await compatEngine({
        name: "OpenRouter", url: "https://openrouter.ai/api/v1/chat/completions", key: "OPENROUTER_API_KEY", model, tokensParam: "max_tokens",
        headers: { "X-Title": "bitrecipe" },
        body: { provider: { require_parameters: true } }, // only providers that honour the recipe schema
      }, p);
    } catch (e) {
      last = e;
      const code = (e as { status?: number }).status;
      // model gone / busy / garbled: try the next free model; key or credit problems: stop
      if (code === 503 || code === 422) throw e;
      orCache = null;
    }
  }
  throw last ?? fail(502, "OpenRouter has no free model available right now. Try another engine.");
}

// Fill anything a less strict engine left out, so the app always gets a valid recipe.
function normalize(x: Record<string, unknown>): Recipe {
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const r = x as Record<string, any>;
  r.title = String(r.title || "AI recipe");
  r.servings = Number.isInteger(r.servings) && r.servings > 0 ? r.servings : 4;
  r.servingsLabel = String(r.servingsLabel || "servings");
  r.time = { active: Number(r.time?.active) || 0, total: Number(r.time?.total) || 0 };
  r.equipment = arr(r.equipment).map(String);
  r.lanes = arr(r.lanes).filter((l: any) => ["A", "B", "C"].includes(l?.id)).map((l: any) => ({ id: l.id, name: String(l.name || `Track ${l.id}`) }));
  if (!r.lanes.length) r.lanes = [{ id: "A", name: "Main" }];
  r.ingredients = arr(r.ingredients).filter((i: any) => i?.item).map((i: any, k: number) => ({
    id: String(i.id || `i${k}`), qty: typeof i.qty === "number" ? i.qty : null, qty2: typeof i.qty2 === "number" ? i.qty2 : null,
    unit: UNITS.includes(i.unit) ? i.unit : "", item: String(i.item), prep: String(i.prep || ""), loose: i.loose ? String(i.loose) : null,
  }));
  r.steps = arr(r.steps).filter((s: any) => s?.text).map((s: any) => ({
    lane: ["A", "B", "C"].includes(s.lane) ? s.lane : "A", text: String(s.text), merges: arr(s.merges).filter((m: any) => ["A", "B", "C"].includes(m)),
    timer: s.timer && Number(s.timer.min) > 0 ? { min: Math.round(Number(s.timer.min)), label: String(s.timer.label || "Timer") } : null, wait: !!s.wait,
  }));
  r.tips = arr(r.tips).map(String).slice(0, 3);
  if (!r.ingredients.length || !r.steps.length) throw fail(502, "The AI chef sent an incomplete recipe. Try again.");
  return r as Recipe;
}

async function withGemini(prompt: string): Promise<{ recipe: Recipe; model: string }> {
  const call = async (strictSchema: boolean) => {
    const system = strictSchema ? SYSTEM : `${SYSTEM}\n\nReply with only a JSON object matching this JSON Schema:\n${JSON.stringify(RECIPE_SCHEMA)}`;
    try {
      return await fetch(GEMINI_URL(GEMINI_MODEL), {
        method: "POST",
        headers: { "x-goog-api-key": Deno.env.get("GEMINI_API_KEY")!, "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 16000,
            responseMimeType: "application/json",
            ...(strictSchema ? { responseJsonSchema: RECIPE_SCHEMA } : {}),
          },
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch { throw fail(504, "Couldn't reach Gemini. Try again."); }
  };
  let res = await call(true);
  let json = await res.json().catch(() => null);
  // If this model won't take the schema field, ask again with the schema in the instructions.
  if (res.status === 400 && /schema|unknown name|invalid json payload/i.test(JSON.stringify(json ?? ""))) {
    res = await call(false);
    json = await res.json().catch(() => null);
  }
  if (res.status === 401 || res.status === 403 || (res.status === 400 && /api key/i.test(JSON.stringify(json ?? "")))) {
    throw fail(503, "Gemini isn't connected yet (GEMINI_API_KEY secret missing or wrong).");
  }
  if (res.status === 404) throw fail(502, `Gemini model ${GEMINI_MODEL} isn't available. Set the GEMINI_MODEL secret.`);
  if (res.status === 429) throw fail(429, "Gemini is busy. Try again in a minute, or switch engines.");
  if (!res.ok) throw fail(502, `Gemini error ${res.status}. Try again.`);
  if (json?.promptFeedback?.blockReason) throw fail(422, "The AI chef can't help with that one. Try asking for a different dish.");
  const cand = json?.candidates?.[0];
  if (cand?.finishReason === "MAX_TOKENS") throw fail(502, "That recipe came out too long. Try something a bit simpler.");
  if (["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"].includes(cand?.finishReason)) {
    throw fail(422, "The AI chef can't help with that one. Try asking for a different dish.");
  }
  const text = (cand?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("").trim();
  if (!text) throw fail(502, "Gemini didn't send a recipe. Try again.");
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "");
  return { recipe: normalize(JSON.parse(cleaned)), model: json?.modelVersion ?? GEMINI_MODEL };
}

const ENGINES = {
  claude: { key: "ANTHROPIC_API_KEY", run: withClaude },
  gemini: { key: "GEMINI_API_KEY", run: withGemini },
  groq: { key: "GROQ_API_KEY", run: withGroq },
  cerebras: { key: "CEREBRAS_API_KEY", run: withCerebras },
  openrouter: { key: "OPENROUTER_API_KEY", run: withOpenRouter },
} as const;
const ORDER = ["claude", "gemini", "groq", "cerebras", "openrouter"] as const;
const configured = () => Object.fromEntries(Object.entries(ENGINES).map(([k, v]) => [k, !!Deno.env.get(v.key)]));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method === "GET") return reply(200, { engines: configured(), limit: DAILY_LIMIT });
  if (req.method !== "POST") return reply(405, { error: "POST only" });
  const auth = req.headers.get("Authorization") ?? "";
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply(400, { error: "Send JSON." }); }
  if (!String(body.prompt ?? "").trim()) return reply(400, { error: "Say what you'd like to make." });

  const want = ORDER.find((e) => e === body.engine) ?? "claude";
  const avail = configured();
  // use the engine asked for; if it isn't set up, use whichever one is
  const engine = avail[want] ? want : ORDER.find((e) => avail[e]) ?? null;
  if (!engine) return reply(503, { error: "The AI chef isn't connected yet (add an AI key such as GEMINI_API_KEY or GROQ_API_KEY in Supabase)." });

  let remaining: number;
  try { remaining = await takeQuota(auth); } catch (e) {
    return reply((e as { status?: number }).status ?? 500, { error: (e as Error).message });
  }
  try {
    const { recipe, model } = await ENGINES[engine].run(buildPrompt(body));
    return reply(200, { recipe: tidy(recipe), remaining, engine, model });
  } catch (e) {
    const code = (e as { status?: number }).status;
    if (code) return reply(code, { error: (e as Error).message });
    if (e instanceof SyntaxError) return reply(502, { error: "The recipe came back garbled. Try again." });
    return reply(500, { error: "Something went wrong making that recipe." });
  }
});
