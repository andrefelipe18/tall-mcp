# Tall MCP Server

MCP server for Laravel ecosystem documentation references

This is a TypeScript-based MCP server that provides reference information for Filament, Laravel, and Livewire documentation. It implements a Model Context Protocol (MCP) server that helps AI assistants access documentation locally without requiring online scraping.

## Features

### Tools

#### Filament Documentation

- `list_filament_packages` - Lists all available packages in the local Filament documentation
- `list_filament_docs` - Lists the documentation files available in a specific package
- `get_filament_doc` - Gets the content of a specific file from the Filament documentation
- `search_filament_docs` - Searches for a term across the local Filament documentation

#### Laravel Documentation

- `list_laravel_docs` - Lists all available documentation files in the Laravel documentation
- `get_laravel_doc` - Gets the content of a specific file from the Laravel documentation
- `search_laravel_docs` - Searches for a term across the local Laravel documentation

#### Livewire Documentation

- `list_livewire_docs` - Lists all available documentation files in the Livewire documentation
- `get_livewire_doc` - Gets the content of a specific file from the Livewire documentation
- `search_livewire_docs` - Searches for a term across the local Livewire documentation

### Functionality

This server:

- Reads documentation from local Markdown files in the following directories:
  - `/data/filament-docs` - Filament documentation
  - `/data/laravel-docs` - Laravel documentation
  - `/data/livewire-docs` - Livewire documentation
- Provides structured navigation through the documentation
- Allows full-text search across all documentation files
- Can still scrape information from official documentation sites when needed

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

You must install this package globally with npm:

```bash
# In the root of the project
npm install -g .
```

### Claude Desktop Configuration

To use with Claude Desktop, add the server config:

On Windows: `%APPDATA%\Claude\claude_desktop_config.json`
On MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

For this, you must have install globally the 


```json
{
  "mcpServers": {
    "tall-server": {
      "command": "npx",
      "args": [
        "tall-server"
      ]
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
      "args": ["tall-server"]
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
      "args": ["tall-server"]
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

Once the server is configured, you can ask Claude or another AI assistant questions about Filament, Laravel, or Livewire, for example:

```
Can you explain how Filament's form validation works?
```

```
Show me examples of Laravel middleware usage.
```

```
How do Livewire components handle state management?
```

The AI will use the MCP server to fetch information directly from your local documentation.
