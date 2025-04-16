# Filament MCP Server

MCP server for Filament documentation references

This is a TypeScript-based MCP server that provides reference information for Filament components and documentation. It implements a Model Context Protocol (MCP) server that helps AI assistants access Filament documentation locally without requiring online scraping.

## Features

### Tools

- `list_filament_packages` - Lists all available packages in the local Filament documentation
- `list_filament_docs` - Lists the documentation files available in a specific package
- `get_filament_doc` - Gets the content of a specific file from the Filament documentation
- `search_filament_docs` - Searches for a term across the local Filament documentation
- `get_filament_form_field` - Gets detailed information about a specific Filament form field

### Functionality

This server:

- Reads documentation from local Markdown files in the `/data/filament-docs` directory
- Provides structured navigation through the documentation
- Allows full-text search across all documentation files
- Can still scrape information from the official Filament documentation site when needed

It provides structured data including:

- Package listings
- Documentation content
- Field descriptions
- Usage examples
- Properties and methods

## Development

Install dependencies:

```bash
npm install
```

Build the server:

```bash
npm run build
```

For development with auto-rebuild:

```bash
npm run watch
```

## Installation

### Global Installation

You can install this package globally:

```bash
npm install -g filament-mcp-server
```

### Claude Desktop Configuration

To use with Claude Desktop, add the server config:

On Windows: `%APPDATA%\Claude\claude_desktop_config.json`
On MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

#### Option 1: Using global install

```json
{
  "mcpServers": {
    "filament-server": {
      "command": "filament-server"
    }
  }
}
```

#### Option 2: Using npx command

```json
{
  "mcpServers": {
    "filament-server": {
      "command": "npx",
      "args": ["-y", "filament-mcp-server"]
    }
  }
}
```

### Windsurf Configuration

Add this to your `./codeium/windsurf/model_config.json`:

```json
{
  "mcpServers": {
    "filament-server": {
      "command": "npx",
      "args": ["-y", "filament-mcp-server"]
    }
  }
}
```

### Cursor Configuration

Add this to your `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "filament-server": {
      "command": "npx",
      "args": ["-y", "filament-mcp-server"]
    }
  }
}
```

### Debugging

Since MCP servers communicate over stdio, debugging can be challenging. We recommend using the [MCP Inspector](https://github.com/modelcontextprotocol/inspector), which is available as a package script:

```bash
npm run inspector
```

The Inspector will provide a URL to access debugging tools in your browser.

## Usage Examples

Once the server is configured, you can ask Claude or another AI assistant questions about Filament, for example:

```
Can you explain how Filament's form validation works?
```

```
Show me examples of Filament table actions.
```

The AI will use the MCP server to fetch information directly from your local Filament documentation.
