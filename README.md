# mcp-dostuff

DoStuff network MCP.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `metros` | List the metros DoStuff covers (slug + name). Pass a slug to the events tool. |
| `events` | Curated things-to-do / events for a DoStuff metro. Defaults to today; pass `date` and/or `days` to cover a window (e.g. a weekend). Optionally filter by category (music, art, performing-arts, comedy, food-drink, other-fun-deals) and free-only. Sorted by start time. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "dostuff": {
      "url": "https://gateway.pipeworx.io/dostuff/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Dostuff data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
