// bitrecipe AI chef: "what do you want to make?" in, a bitrecipe-format recipe out.
// Two engines, picked in the app: Claude (best quality) or Groq (fastest, cheapest).
//
// The API keys live only here, as the Edge Function secrets ANTHROPIC_API_KEY
// and GROQ_API_KEY (either or both). The app calls this function with the signed-in 128bit
// user's token; each account gets a daily limit (bitrecipe_ai_take in
// supabase/bitrecipe-ai.sql) so nobody can run up the bill.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";

const MODEL = "claude-opus-5-5";
// Groq: OpenAI-compatible API; gpt-oss-120b supports strict JSON-schema output.
const GROQ_MODEL = Deno.env.get("GROQ_MODEL") ?? "openai/gpt-oss-120b";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
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

async function withGroq(prompt: string): Promise<{ recipe: Recipe; model: string }> {
  let res: Response;
  try {
    res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("GROQ_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_completion_tokens: 16000,
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }],
        response_format: { type: "json_schema", json_schema: { name: "bitrecipe_recipe", strict: true, schema: RECIPE_SCHEMA } },
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch { throw fail(504, "Couldn't reach Groq. Try again."); }
  const json = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403) throw fail(503, "Groq isn't connected yet (GROQ_API_KEY secret missing or wrong).");
  if (res.status === 429) throw fail(429, "Groq is busy. Try again in a minute, or switch to Claude.");
  if (!res.ok) throw fail(502, `Groq error ${res.status}. Try again.`);
  const choice = json?.choices?.[0];
  if (choice?.finish_reason === "length") throw fail(502, "That recipe came out too long. Try something a bit simpler.");
  const content = choice?.message?.content;
  if (!content) throw fail(502, "Groq didn't send a recipe. Try again.");
  return { recipe: JSON.parse(content), model: json.model ?? GROQ_MODEL };
}

const ENGINES = { claude: { key: "ANTHROPIC_API_KEY", run: withClaude }, groq: { key: "GROQ_API_KEY", run: withGroq } } as const;
const configured = () => Object.fromEntries(Object.entries(ENGINES).map(([k, v]) => [k, !!Deno.env.get(v.key)]));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method === "GET") return reply(200, { engines: configured(), limit: DAILY_LIMIT });
  if (req.method !== "POST") return reply(405, { error: "POST only" });
  const auth = req.headers.get("Authorization") ?? "";
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply(400, { error: "Send JSON." }); }
  if (!String(body.prompt ?? "").trim()) return reply(400, { error: "Say what you'd like to make." });

  const want = body.engine === "groq" ? "groq" : "claude";
  const avail = configured();
  // use the engine asked for; if only the other one is set up, use that
  const engine = avail[want] ? want : avail.claude ? "claude" : avail.groq ? "groq" : null;
  if (!engine) return reply(503, { error: "The AI chef isn't connected yet (add ANTHROPIC_API_KEY or GROQ_API_KEY in Supabase)." });

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
