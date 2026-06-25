# umans-vision-handoff

A Claude Code plugin that adds a `view_image` MCP tool for providers whose main
model can't read images natively — e.g. **GLM 5.2**, which is text-only on the
OpenAI-compatible route (`supports_vision: "via-handoff"`).

When `view_image` is called, the plugin hands the image to a **native-vision**
Umans model, preferring **Kimi** first, then falling back through
`umans-coder` → `umans-flash` → `umans-qwen3.6-35b-a3b`. The model list is
fetched live from `https://api.code.umans.ai/v1/models/info` on every call, so
it never rots as Umans rotates models.

## Install

```bash
claude plugin add /home/karutoil/umans-claude-vision
```

Set your key:

```bash
export UMANS_API_KEY=sk-...
```

## Use

Claude Code will offer the `view_image` tool when it needs to read an image and
the active model can't. You can also force it in a prompt:

> Use view_image on this screenshot and tell me what's in the URL bar.

## Files

- `mcp/server.js` — zero-dependency MCP server (Node stdlib only)
- `test/rank-check.js` — offline rank-order self-check
- `test/live-rank-check.js` — live API ranking check
