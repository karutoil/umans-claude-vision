#!/usr/bin/env node
// ponytail: one file, zero deps. MCP stdio server + Anthropic Messages route.
// `umans claude` sets ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, and the
// sonnet/haiku tier vars. sonnet (umans-coder, Kimi-based) has native vision;
// haiku (umans-flash) is the fallback. We call /v1/messages — the same route
// Claude Code uses — not the OpenAI route (which 503s for vision).
"use strict";

const BASE = (process.env.ANTHROPIC_BASE_URL || "https://api.code.umans.ai/").replace(/\/+$/, "");
const TOKEN = process.env.ANTHROPIC_AUTH_TOKEN || process.env.UMANS_API_KEY;
// umans CLI sets these; sonnet=umans-coder (vision), haiku=umans-flash (vision).
const PRIMARY = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || "umans-coder";
const FALLBACK = process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || "umans-flash";

async function toBase64(image) {
  if (image.base64) return { media_type: image.mime || "image/png", data: image.base64 };
  if (!image.url) throw new Error("image.url or image.base64 required");
  const res = await fetch(image.url);
  if (!res.ok) throw new Error(`fetch image ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = image.mime || res.headers.get("content-type") || "image/png";
  return { media_type: mime, data: buf.toString("base64") };
}

async function describeWith(model, image, prompt) {
  const src = await toBase64(image);
  const body = {
    model,
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: prompt || "Describe this image concisely." },
        { type: "image", source: { type: "base64", ...src } },
      ],
    }],
  };
  const res = await fetch(`${BASE}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${model}: ${data.error?.message || res.status}`);
  // Messages route returns content blocks; pick the first text block (skip thinking).
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  if (!text) throw new Error(`${model}: empty response`);
  return { model, text };
}

async function viewImage({ image, prompt }) {
  if (!image || (!image.url && !image.base64))
    throw new Error("image.url or image.base64 required");
  // sonnet first (Kimi-based, native vision), haiku fallback.
  for (const m of [PRIMARY, FALLBACK]) {
    try { return await describeWith(m, image, prompt); }
    catch (e) { if (m === FALLBACK) throw e; }
  }
}

// --- MCP stdio server (hand-rolled JSON-RPC, zero deps) ---
const TOOLS = [{
  name: "view_image",
  description:
    "Describe an image using a native-vision Umans model (sonnet/umans-coder first, haiku/umans-flash fallback). Use when the active model cannot see images natively, e.g. GLM 5.2 (opus tier) which is text-only.",
  inputSchema: {
    type: "object",
    properties: {
      image: {
        type: "object",
        description: "The image to read. Provide either url or base64 (+ mime).",
        properties: {
          url: { type: "string" },
          base64: { type: "string" },
          mime: { type: "string", default: "image/png" },
        },
      },
      prompt: { type: "string", default: "Describe this image concisely." },
    },
    required: ["image"],
  },
}];

let buf = "";
let pending = 0;
let stdinClosed = false;
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) {
      pending++;
      handle(line).finally(() => {
        pending--;
        if (stdinClosed && pending === 0) process.exit(0);
      });
    }
  }
});
// Don't exit while an async tool call is in flight — wait for it to drain.
process.stdin.on("end", () => {
  stdinClosed = true;
  if (pending === 0) process.exit(0);
});

async function handle(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  try {
    let result;
    switch (method) {
      case "initialize":
        result = { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "umans-vision", version: "0.2.0" } };
        break;
      case "notifications/initialized": return;
      case "tools/list": result = { tools: TOOLS }; break;
      case "tools/call": {
        const { name, arguments: args } = params;
        if (name !== "view_image") throw new Error(`unknown tool: ${name}`);
        const out = await viewImage(args);
        result = { content: [{ type: "text", text: `[Vision via ${out.model}]\n\n${out.text}` }] };
        break;
      }
      default: throw new Error(`unsupported method: ${method}`);
    }
    send({ jsonrpc: "2.0", id, result });
  } catch (e) {
    send({ jsonrpc: "2.0", id, error: { code: -32603, message: e.message } });
  }
}

function send(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }
