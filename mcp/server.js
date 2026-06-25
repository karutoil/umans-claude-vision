#!/usr/bin/env node
// ponytail: one file, zero deps. stdlib fetch + JSON-RPC over stdio.
// Re-fetches Umans model list on each call so it never rots as models rotate.
// Vision model preference: Kimi family first, then anything with native vision.
"use strict";

const UMANS_BASE_URL =
  process.env.UMANS_BASE_URL || "https://api.code.umans.ai/v1";
// `umans claude` sets ANTHROPIC_AUTH_TOKEN; fall back to it so the plugin
// works with zero extra config when launched through `umans claude`.
const UMANS_API_KEY =
  process.env.UMANS_API_KEY ||
  process.env.UMANS_API_TOKEN ||
  process.env.ANTHROPIC_AUTH_TOKEN;
const MODELS_INFO_URL = "https://api.code.umans.ai/v1/models/info";

// Preferred families, in order. Kimi first per the brief.
const PREFERENCE = [/kimi/i, /coder/i, /flash/i, /qwen/i];

function rank(models) {
  const native = models.filter((m) => m.capabilities?.supports_vision === true);
  return native.sort((a, b) => {
    const ai = PREFERENCE.findIndex((re) => re.test(a.name));
    const bi = PREFERENCE.findIndex((re) => re.test(b.name));
    const av = ai === -1 ? PREFERENCE.length : ai;
    const bv = bi === -1 ? PREFERENCE.length : bi;
    return av - bv;
  });
}

async function fetchJson(url, init = {}) {
  const headers = { accept: "application/json", ...init.headers };
  if (UMANS_API_KEY) headers.authorization = `Bearer ${UMANS_API_KEY}`;
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function listVisionModels() {
  const data = await fetchJson(MODELS_INFO_URL);
  return rank(Object.values(data));
}

// Describe one image with one model. Returns { text } or throws.
async function describeWith(model, image, prompt) {
  const body = {
    model,
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt || "Describe this image concisely." },
          {
            type: "image_url",
            image_url: { url: image.url || `data:${image.mime};base64,${image.base64}` },
          },
        ],
      },
    ],
  };
  const data = await fetchJson(`${UMANS_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error(`empty response from ${model}`);
  return { model, text };
}

async function viewImage({ image, prompt }) {
  if (!image || (!image.url && !image.base64))
    throw new Error("image.url or image.base64 required");
  const models = await listVisionModels();
  if (!models.length) throw new Error("no native-vision models available on Umans");

  const errors = [];
  for (const m of models) {
    try {
      return await describeWith(m.name, image, prompt);
    } catch (e) {
      errors.push(`${m.name}: ${e.message}`);
    }
  }
  throw new Error(`all vision models failed\n${errors.join("\n")}`);
}

// --- MCP stdio server (tiny hand-rolled JSON-RPC) ---
const TOOLS = [
  {
    name: "view_image",
    description:
      "Describe an image using a native-vision Umans model (Kimi first, with fallbacks). Use when the main model cannot see images natively, e.g. GLM 5.2 which is text-only on the OpenAI route.",
    inputSchema: {
      type: "object",
      properties: {
        image: {
          type: "object",
          description: "The image to read. Provide either url or base64 (+ mime).",
          properties: {
            url: { type: "string", description: "Public image URL" },
            base64: { type: "string", description: "Base64 image data" },
            mime: { type: "string", description: "MIME type, e.g. image/png", default: "image/png" },
          },
        },
        prompt: {
          type: "string",
          description: "What to ask about the image. Defaults to a concise description.",
          default: "Describe this image concisely.",
        },
      },
      required: ["image"],
    },
  },
];

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) handle(line);
  }
});
process.stdin.on("end", () => process.exit(0));

async function handle(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // ignore garbage
  }
  const { id, method, params } = msg;
  try {
    let result;
    switch (method) {
      case "initialize":
        result = {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "umans-vision", version: "0.1.0" },
        };
        break;
      case "notifications/initialized":
        return; // no response to notifications
      case "tools/list":
        result = { tools: TOOLS };
        break;
      case "tools/call": {
        const { name, arguments: args } = params;
        if (name !== "view_image") throw new Error(`unknown tool: ${name}`);
        const out = await viewImage(args);
        result = {
          content: [
            { type: "text", text: `[Vision via ${out.model}]\n\n${out.text}` },
          ],
        };
        break;
      }
      default:
        throw new Error(`unsupported method: ${method}`);
    }
    send({ jsonrpc: "2.0", id, result });
  } catch (e) {
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: e.message },
    });
  }
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}
