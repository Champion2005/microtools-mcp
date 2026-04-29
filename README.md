# Microtools MCP Server

This is an MCP (Model Context Protocol) server that exposes all of the utilities from the [Microtools](https://github.com/Champion2005/microtools) web application to any compatible AI agent.

The tools are processed entirely locally via standard Node.js libraries (such as `sharp` for image resizing and `jsondiffpatch` for JSON comparison). Data is never sent to external APIs.

## Available Tools
- `json_diff` - Compare two JSON payloads
- `text_cleanup` - Clean noisy text (spacing, punctuation, casing)
- `image_resizer` - Resize and scale image dimensions
- `qr_generator` - Create QR codes (SVG/PNG)
- `pdf_merge` - Combine multiple PDF files
- `csv_to_json` - Convert CSV strings to formatted JSON
- `markdown_preview` - Render markdown to sanitized HTML
- `cron_translator` - Convert cron expressions to English and calculate next runs
- `type_generator` - Convert raw JSON into strict types (TypeScript, Go, Rust, Python)
- `svg_optimizer` - Clean, minify, and strip metadata from bloated SVG files
- `mock_data_generator` - Generate realistic mock data objects based on a schema
- `hash_generator` - Compute secure hashes (MD5, SHA, Bcrypt) and tokens

## Requirements
- Node.js 18+

## How to use with Claude Desktop
To make this server usable by Claude Desktop, add it to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "microtools": {
      "command": "node",
      "args": [
        "/path/to/your/clone/of/microtools-mcp/index.js"
      ]
    }
  }
}
```

Since the server uses `stdio` as its transport layer, it does **not** need to be hosted on a cloud provider like Coolify. It runs locally as a background process initiated by your AI client.

## Installation
1. Clone this repository
2. Run `npm install` to install dependencies
3. Add the server configuration to your MCP client