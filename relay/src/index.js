/* Comput relay: lets brangic.studio/comput use Claude without putting the API key in the page.
 *
 * - The key lives in a Cloudflare secret (ANTHROPIC_API_KEY), never in the page or the repo.
 * - Only requests from the origins in ALLOWED_ORIGINS are served, rate limited per visitor.
 * - It accepts only Comput's three steps (build, check, fix) with a description and a scene;
 *   the prompts are written here, so it cannot be used as a general-purpose Claude proxy.
 * - Build and fix use Claude Opus 5.5; the check that looks at the render uses Claude Haiku 5.5.
 */
import Anthropic from "@anthropic-ai/sdk";
import P from "./prompts.gen.js";

const BUILD_MODEL = "claude-opus-5-5";
const CHECK_MODEL = "claude-haiku-5-5";
const MAX_BODY = 2_500_000; // characters; a JPEG render plus a scene

export default {
  async fetch(req, env) {
    const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const origin = req.headers.get("Origin") || "";
    const okOrigin = allowed.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": okOrigin ? origin : allowed[0] || "null",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

    if (req.method === "OPTIONS") return new Response(null, { status: okOrigin ? 204 : 403, headers: cors });
    if (req.method === "GET") return json({ ok: true, service: "comput-relay", configured: !!env.ANTHROPIC_API_KEY });
    if (req.method !== "POST") return json({ error: "method" }, 405);
    if (!okOrigin) return json({ error: "origin" }, 403);
    if (!env.ANTHROPIC_API_KEY) return json({ error: "not_configured" }, 503);
    if (env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: req.headers.get("CF-Connecting-IP") || "anon" });
      if (!success) return json({ error: "rate_limited" }, 429);
    }

    let body;
    try {
      const text = await req.text();
      if (text.length > MAX_BODY) return json({ error: "too_large" }, 413);
      body = JSON.parse(text);
    } catch {
      return json({ error: "bad_request" }, 400);
    }
    const want = String(body.want || "").slice(0, 800).trim();
    if (!want) return json({ error: "bad_request" }, 400);
    const small = (v, max) => { const t = JSON.stringify(v ?? {}); return t.length > max ? null : JSON.parse(t); };

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    try {
      let response;
      if (body.task === "check") {
        const image = String(body.image || "");
        if (!image || image.length > 2_000_000 || !/^[A-Za-z0-9+/=]+$/.test(image)) return json({ error: "bad_request" }, 400);
        const parts = (Array.isArray(body.parts) ? body.parts : []).slice(0, 24).map((x) => String(x).slice(0, 24));
        response = await client.messages.create({
          model: CHECK_MODEL,
          max_tokens: 2000,
          output_config: { effort: "low" },
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
              { type: "text", text: P.check(want, parts) },
            ],
          }],
        });
      } else if (body.task === "build" || body.task === "fix") {
        let prompt;
        if (body.task === "build") {
          const scene = small(body.scene, 40_000);
          if (!scene) return json({ error: "too_large" }, 413);
          prompt = P.build(want, scene);
        } else {
          const first = small(body.first, 40_000);
          const issues = (Array.isArray(body.issues) ? body.issues : []).slice(0, 5).map((x) => String(x).slice(0, 300));
          if (!first || !issues.length) return json({ error: "bad_request" }, 400);
          prompt = P.fix(want, first, issues);
        }
        // server-side fallback: if Claude Opus 5.5 declines, the API re-runs the request on a fallback model
        response = await client.beta.messages.create({
          model: BUILD_MODEL,
          max_tokens: 16000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "medium" },
          messages: [{ role: "user", content: prompt }],
        });
      } else {
        return json({ error: "bad_request" }, 400);
      }

      if (response.stop_reason === "refusal") return json({ error: "refused" });
      const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const data = parseJson(text);
      if (data === undefined) return json({ error: "invalid_json" });
      return json({ data });
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) return json({ error: "rate_limited" }, 429);
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return json({ error: "not_configured" }, 503);
      if (e instanceof Anthropic.BadRequestError) return json({ error: "bad_request" }, 400);
      if (e instanceof Anthropic.APIError) return json({ error: "upstream_error" }, 502);
      return json({ error: "upstream_error" }, 502);
    }
  },
};

// the reply as JSON: the whole text, else the body of a code fence, else first { to last }
function parseJson(text) {
  const tries = [text, (text.match(/```(?:json)?\s*([\s\S]*?)```/) || [])[1], text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)];
  for (const t of tries) { if (!t) continue; try { return JSON.parse(t); } catch {} }
  return undefined;
}
