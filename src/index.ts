#!/usr/bin/env node

/**
 * MCP server for Filament component references
 * This server provides tools to:
 * - Get detailed information about Filament form fields
 * - Browse local Filament documentation files
 * - Search through Filament documentation
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { promisify } from "util";
import { fileURLToPath } from "url";

// Obter o equivalente a __dirname em ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Promisificar funções síncronas do fs
const readFileAsync = promisify(fs.readFile);
const readdirAsync = promisify(fs.readdir);
const statAsync = promisify(fs.stat);

// Configuração de log para um arquivo separado em vez de stdout/stderr
const LOG_ENABLED = true;
const LOG_FILE = path.join(os.tmpdir(), "filament-mcp-server.log");

// Caminho base para os arquivos de documentação local
const DOCS_BASE_PATH = path.join(
  path.dirname(path.dirname(__dirname)),
  "data",
  "filament-docs"
);

// Função de log que escreve em arquivo separado e não na saída padrão
function log(...args: any[]) {
  if (LOG_ENABLED) {
    const logMessage = args
      .map((arg) =>
        typeof arg === "object" ? JSON.stringify(arg) : String(arg)
      )
      .join(" ");

    try {
      fs.appendFileSync(
        LOG_FILE,
        `${new Date().toISOString()}: ${logMessage}\n`
      );
    } catch (e) {
      // Silêncio em caso de erro de escrita no log
    }
  }
}

/**
 * Interface for form field information
 */
interface FieldInfo {
  name: string;
  url: string;
  description: string;
  usage?: string;
  props?: FieldProp[];
  examples?: FieldExample[];
}

/**
 * Interface for field property information
 */
interface FieldProp {
  name: string;
  description: string;
  type?: string;
  default?: string;
  required?: boolean;
}

/**
 * Interface for field example
 */
interface FieldExample {
  title: string;
  code: string;
  description?: string;
}

/**
 * Interface for documentation file
 */
interface DocFile {
  name: string;
  path: string;
  isDirectory: boolean;
  title?: string;
}

/**
 * Interface for documentation package
 */
interface DocPackage {
  name: string;
  path: string;
  description?: string;
}

/**
 * Interface for documentation search result
 */
interface DocSearchResult {
  title: string;
  path: string;
  package: string;
  excerpt: string;
  relevance: number;
}

/**
 * FilamentServer class that handles the component reference functionality
 */
class FilamentServer {
  private server: Server;
  private axiosInstance;
  private fieldCache: Map<string, FieldInfo> = new Map();
  private readonly FILAMENT_DOCS_URL = "https://filamentphp.com/docs/3.x";

  // Cache para documentação local
  private docPackagesCache: DocPackage[] | null = null;
  private docContentCache: Map<string, string> = new Map();

  constructor() {
    this.server = new Server(
      {
        name: "filament-server",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.axiosInstance = axios.create({
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FilamentMcpServer/0.1.0)",
      },
    });

    this.setupToolHandlers();

    this.server.onerror = (error) => log("[MCP Error]", error);

    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  /**
   * Set up the tool handlers for the server
   */
  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "get_filament_form_field",
          description:
            "Get detailed information about a specific Filament form field",
          inputSchema: {
            type: "object",
            properties: {
              fieldName: {
                type: "string",
                description:
                  'Name of the Filament form field (e.g., "text-input", "select", "repeater")',
              },
            },
            required: ["fieldName"],
          },
        },
        {
          name: "list_filament_packages",
          description:
            "Lista os pacotes disponíveis na documentação local do Filament",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "list_filament_docs",
          description:
            "Lista os arquivos de documentação disponíveis em um pacote específico",
          inputSchema: {
            type: "object",
            properties: {
              package: {
                type: "string",
                description:
                  "Nome do pacote (ex: 'forms', 'tables', 'panels', etc.)",
              },
              path: {
                type: "string",
                description:
                  "Caminho opcional dentro do pacote (ex: 'fields', 'layout', etc.)",
              },
            },
            required: ["package"],
          },
        },
        {
          name: "get_filament_doc",
          description:
            "Obtém o conteúdo de um arquivo específico da documentação do Filament",
          inputSchema: {
            type: "object",
            properties: {
              package: {
                type: "string",
                description:
                  "Nome do pacote (ex: 'forms', 'tables', 'panels', etc.)",
              },
              path: {
                type: "string",
                description:
                  "Caminho do arquivo dentro do pacote (ex: 'fields/text-input', 'installation', etc.)",
              },
            },
            required: ["package", "path"],
          },
        },
        {
          name: "search_filament_docs",
          description:
            "Busca um termo em toda a documentação local do Filament",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description:
                  "Termo de busca (ex: 'input', 'validation', 'table', etc.)",
              },
              package: {
                type: "string",
                description:
                  "Pacote opcional para limitar a busca (ex: 'forms', 'tables', etc.)",
              },
            },
            required: ["query"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case "get_filament_form_field":
          return await this.handleGetFormField(request.params.arguments);
        case "list_filament_packages":
          return await this.handleListPackages();
        case "list_filament_docs":
          return await this.handleListDocs(request.params.arguments);
        case "get_filament_doc":
          return await this.handleGetDoc(request.params.arguments);
        case "search_filament_docs":
          return await this.handleSearchDocs(request.params.arguments);
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  /**
   * Validates field name from arguments
   */
  private validateFieldName(args: any): string {
    if (!args?.fieldName || typeof args.fieldName !== "string") {
      throw new McpError(
        ErrorCode.InvalidParams,
        "Field name is required and must be a string"
      );
    }
    return args.fieldName.toLowerCase();
  }

  /**
   * Handles Axios errors consistently
   */
  private handleAxiosError(error: unknown, context: string): never {
    if (axios.isAxiosError(error)) {
      log(
        `Axios error during "${context}": ${error.message}`,
        error.response?.status,
        error.config?.url
      );
      if (error.response?.status === 404) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `${context} - Resource not found (404)`
        );
      } else {
        const status = error.response?.status || "N/A";
        const message = error.message;
        throw new McpError(
          ErrorCode.InternalError,
          `Failed during "${context}" operation. Status: ${status}. Error: ${message}`
        );
      }
    }
    log(`Non-Axios error during "${context}":`, error);
    throw error instanceof McpError
      ? error
      : new McpError(
          ErrorCode.InternalError,
          `An unexpected error occurred during "${context}".`
        );
  }

  /**
   * Creates a standardized success response
   */
  private createSuccessResponse(data: any) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  /**
   * Handle the get_filament_form_field tool request
   */
  private async handleGetFormField(args: any) {
    const fieldName = this.validateFieldName(args);

    try {
      // Check cache first
      if (this.fieldCache.has(fieldName)) {
        const cachedData = this.fieldCache.get(fieldName);
        return this.createSuccessResponse(cachedData);
      }

      // Fetch field details
      const fieldInfo = await this.fetchFieldDetails(fieldName);

      // Save to cache
      this.fieldCache.set(fieldName, fieldInfo);

      return this.createSuccessResponse(fieldInfo);
    } catch (error) {
      log(`Error fetching details for ${fieldName}:`, error);
      if (error instanceof McpError) {
        throw error;
      }
      this.handleAxiosError(error, `fetching details for field "${fieldName}"`);
    }
  }

  /**
   * Fetches field details from the Filament documentation
   */
  private async fetchFieldDetails(fieldName: string): Promise<FieldInfo> {
    const fieldUrl = `${this.FILAMENT_DOCS_URL}/forms/fields/${fieldName}`;
    const response = await this.axiosInstance.get(fieldUrl);
    const $ = cheerio.load(response.data);

    // Extract field information
    const title = $("h1").first().text().trim() || fieldName;
    const description = this.extractDescription($);
    const usage = this.extractUsage($);
    const examples = this.extractExamples($);
    const props = this.extractProps($);

    return {
      name: title,
      url: fieldUrl,
      description,
      usage,
      props: props.length > 0 ? props : undefined,
      examples: examples.length > 0 ? examples : undefined,
    };
  }

  /**
   * Extracts field description from the page
   */
  private extractDescription($: cheerio.CheerioAPI): string {
    // Find the first paragraph after the h1
    const descriptionElement = $("h1").first().nextAll("p").first();

    // If not found, try another selector that might contain the main description
    if (!descriptionElement.length) {
      const mainContent = $("main").first();
      const firstPara = mainContent.find("p").first();
      return firstPara.text().trim();
    }

    return descriptionElement.text().trim();
  }

  /**
   * Extracts basic usage example of the field
   */
  private extractUsage($: cheerio.CheerioAPI): string {
    // Try to find the first code section after a title like "Basic Usage" or similar
    const basicUsageHeading = $("h2, h3")
      .filter((_, el) => {
        const text = $(el).text().toLowerCase();
        return (
          text.includes("basic usage") ||
          text.includes("usage") ||
          text === "basic"
        );
      })
      .first();

    if (basicUsageHeading.length) {
      const codeBlock = basicUsageHeading.nextAll("pre").first();
      if (codeBlock.length) {
        return codeBlock.text().trim();
      }
    }

    // Alternative: just take the first code block on the page
    const firstCodeBlock = $("pre").first();
    return firstCodeBlock.length ? firstCodeBlock.text().trim() : "";
  }

  /**
   * Extracts code examples from the page
   */
  private extractExamples($: cheerio.CheerioAPI): FieldExample[] {
    const examples: FieldExample[] = [];

    // Find all code blocks with their preceding titles
    $("pre").each((_, element) => {
      const codeBlock = $(element);
      const code = codeBlock.text().trim();

      if (code) {
        let title = "Code Example";
        let description: string | undefined = undefined;

        // Try to find the nearest preceding heading (h2, h3, h4)
        const prevHeading = codeBlock.prev("h2, h3, h4");
        if (prevHeading.length) {
          title = prevHeading.text().trim();

          // Try to find a description (paragraph between heading and code)
          const descPara = prevHeading.nextUntil(codeBlock, "p").first();
          if (descPara.length) {
            description = descPara.text().trim();
          }
        }

        examples.push({ title, code, description });
      }
    });

    return examples;
  }

  /**
   * Extracts field properties from the API reference section
   */
  private extractProps($: cheerio.CheerioAPI): FieldProp[] {
    const props: FieldProp[] = [];

    // Find the API reference/Methods/Properties section
    const apiSectionHeadings = $("h2, h3").filter((_, el) => {
      const text = $(el).text().toLowerCase();
      return (
        text.includes("api reference") ||
        text.includes("methods") ||
        text.includes("properties") ||
        text.includes("available methods") ||
        text.includes("configuration")
      );
    });

    if (!apiSectionHeadings.length) {
      return props;
    }

    // For each API/Methods section found
    apiSectionHeadings.each((_, heading) => {
      const headingElement = $(heading);

      // Look for tables after the heading
      const tables = headingElement.nextUntil("h2, h3", "table");
      tables.each((_, table) => {
        const tableElement = $(table);

        // Extract table headers
        const headers: string[] = [];
        tableElement.find("thead th").each((_, th) => {
          headers.push($(th).text().trim().toLowerCase());
        });

        // Determine indices of important columns
        const methodIndex =
          headers.indexOf("method") !== -1
            ? headers.indexOf("method")
            : headers.indexOf("name");
        const descriptionIndex = headers.indexOf("description");
        const typeIndex = headers.indexOf("type");
        const defaultIndex = headers.indexOf("default");

        // Skip this table if essential columns are not found
        if (methodIndex === -1 || descriptionIndex === -1) {
          return;
        }

        // Process each row in the table
        tableElement.find("tbody tr").each((_, tr) => {
          const cells = $(tr).find("td");
          const name = cells.eq(methodIndex).text().trim();
          const description = cells.eq(descriptionIndex).text().trim();

          if (name && description) {
            const prop: FieldProp = {
              name,
              description,
            };

            // Add type if available
            if (typeIndex !== -1) {
              const type = cells.eq(typeIndex).text().trim();
              if (type) prop.type = type;
            }

            // Add default value if available
            if (defaultIndex !== -1) {
              const defaultValue = cells.eq(defaultIndex).text().trim();
              if (defaultValue) prop.default = defaultValue;
            }

            // Check if required based on description
            if (description.toLowerCase().includes("required")) {
              prop.required = true;
            }

            props.push(prop);
          }
        });
      });

      // Also look for lists (dl, dt, dd) that may contain properties
      const lists = headingElement.nextUntil("h2, h3", "dl");
      lists.each((_, list) => {
        const listElement = $(list);

        // Find all terms (dt) and their descriptions (dd)
        listElement.find("dt").each((_, term) => {
          const termElement = $(term);
          const name = termElement.text().trim();
          const descElement = termElement.next("dd");
          const description = descElement.text().trim();

          if (name && description) {
            const prop: FieldProp = {
              name,
              description,
            };

            // Check if required based on description
            if (description.toLowerCase().includes("required")) {
              prop.required = true;
            }

            props.push(prop);
          }
        });
      });
    });

    return props;
  }

  /**
   * Utilitário para extrair título de um arquivo Markdown
   */
  private extractTitleFromMarkdown(content: string): string {
    // Procura por título de nível 1 (# Title)
    const titleMatch = content.match(/^#\s+(.+)$/m);
    if (titleMatch) {
      return titleMatch[1].trim();
    }

    // Se não encontrar título de nível 1, tenta obter o nome do arquivo sem extensão
    return "Sem título";
  }

  /**
   * Utilitário para obter um trecho do texto contendo a consulta
   */
  private getMarkdownExcerpt(
    content: string,
    query: string,
    length: number = 150
  ): string {
    // Converter para minúsculas para pesquisa não sensível a maiúsculas/minúsculas
    const lowerContent = content.toLowerCase();
    const lowerQuery = query.toLowerCase();

    // Encontrar índice da consulta
    const index = lowerContent.indexOf(lowerQuery);
    if (index === -1) {
      // Se não encontrou a consulta, retorna o início do documento
      return content.substring(0, Math.min(length, content.length)) + "...";
    }

    // Calcular início e fim do trecho para mostrar contexto
    const startPos = Math.max(0, index - 50);
    const endPos = Math.min(content.length, index + query.length + 100);

    // Adicionar reticências se o trecho não começar do início ou não terminar no fim
    const prefix = startPos > 0 ? "..." : "";
    const suffix = endPos < content.length ? "..." : "";

    return prefix + content.substring(startPos, endPos) + suffix;
  }

  /**
   * Limpa nome de arquivo/pasta removendo prefixo numérico (ex: "01-installation" -> "installation")
   */
  private cleanItemName(name: string): string {
    // Remove prefixos numéricos como "01-", "02-" etc.
    return name.replace(/^\d+-/, "").replace(".md", "");
  }

  /**
   * Converte caminho de arquivo para título legível
   */
  private pathToTitle(filePath: string): string {
    // Extrair nome do arquivo sem extensão
    const fileName = path.basename(filePath, ".md");

    // Limpar prefixo numérico
    const cleanName = this.cleanItemName(fileName);

    // Converter para título com primeira letra maiúscula e traços para espaços
    return cleanName
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  /**
   * Calcula a relevância de um resultado de pesquisa
   */
  private calculateRelevance(content: string, query: string): number {
    const lowerContent = content.toLowerCase();
    const lowerQuery = query.toLowerCase();

    // Número de ocorrências
    const occurrences = (lowerContent.match(new RegExp(lowerQuery, "g")) || [])
      .length;

    // Verificar se está em um título
    const titleMatch = lowerContent.match(
      new RegExp(`^#+\\s+.*${lowerQuery}.*$`, "m")
    );
    const titleBonus = titleMatch ? 10 : 0;

    // Posição da primeira ocorrência (mais relevante se aparecer no início)
    const position = lowerContent.indexOf(lowerQuery);
    const positionScore =
      position === -1 ? 0 : Math.max(0, 10 - Math.floor(position / 100));

    return occurrences + titleBonus + positionScore;
  }

  /**
   * Handle the list_filament_packages tool request
   */
  private async handleListPackages() {
    try {
      // Verificar cache primeiro
      if (this.docPackagesCache) {
        return this.createSuccessResponse(this.docPackagesCache);
      }

      // Ler os pacotes do diretório local
      const packagesPath = path.join(DOCS_BASE_PATH, "packages");
      const entries = await readdirAsync(packagesPath);

      // Filtrar apenas diretórios e montar objetos de pacote
      const packages: DocPackage[] = [];

      for (const entry of entries) {
        const entryPath = path.join(packagesPath, entry);
        const stats = await statAsync(entryPath);

        if (stats.isDirectory()) {
          // Verificar se tem arquivo de documentação
          const docsPath = path.join(entryPath, "docs");
          let hasDocumentation = false;

          try {
            const docsStats = await statAsync(docsPath);
            hasDocumentation = docsStats.isDirectory();
          } catch (e) {
            // Ignorar erro se o diretório docs não existir
          }

          if (hasDocumentation) {
            // Tentar extrair descrição de um arquivo README.md ou similar
            let description = `Documentação do pacote ${entry}`;

            try {
              // Procurar por arquivo de overview ou README
              const overviewPath = path.join(docsPath, "01-overview.md");
              const overviewStats = await statAsync(overviewPath);

              if (overviewStats.isFile()) {
                const content = await readFileAsync(overviewPath, "utf-8");
                const firstParagraph = content.match(/^#.*\n\n(.*?)(\n\n|$)/s);
                if (firstParagraph && firstParagraph[1]) {
                  description = firstParagraph[1].replace(/\n/g, " ").trim();
                }
              }
            } catch (e) {
              // Ignorar erro se não encontrar arquivo de overview
            }

            packages.push({
              name: entry,
              path: `packages/${entry}`,
              description,
            });
          }
        }
      }

      // Ordenar pacotes alfabeticamente
      packages.sort((a, b) => a.name.localeCompare(b.name));

      // Salvar em cache
      this.docPackagesCache = packages;

      return this.createSuccessResponse(packages);
    } catch (error) {
      log("Erro ao listar pacotes:", error);
      throw new McpError(
        ErrorCode.InternalError,
        `Erro ao listar os pacotes de documentação: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Handle the list_filament_docs tool request
   */
  private async handleListDocs(args: any) {
    try {
      if (!args.package || typeof args.package !== "string") {
        throw new McpError(
          ErrorCode.InvalidParams,
          "O parâmetro 'package' é obrigatório e deve ser uma string"
        );
      }

      const packageName = args.package.trim();
      const subPath = args.path ? args.path.trim() : "";

      // Construir o caminho completo para o diretório
      let dirPath = path.join(DOCS_BASE_PATH, "packages", packageName, "docs");

      if (subPath) {
        dirPath = path.join(dirPath, subPath);
      }

      // Verificar se o diretório existe
      try {
        const stats = await statAsync(dirPath);
        if (!stats.isDirectory()) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `O caminho '${packageName}${
              subPath ? "/" + subPath : ""
            }' não é um diretório válido`
          );
        }
      } catch (e) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `O pacote ou caminho especificado não existe: ${packageName}${
            subPath ? "/" + subPath : ""
          }`
        );
      }

      // Ler os arquivos e diretórios
      const entries = await readdirAsync(dirPath);
      const files: DocFile[] = [];

      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry);
        const stats = await statAsync(entryPath);
        const isDir = stats.isDirectory();

        // Ignorar arquivos ocultos
        if (entry.startsWith(".")) {
          continue;
        }

        // Montar objeto de arquivo
        const docFile: DocFile = {
          name: this.cleanItemName(entry),
          path: subPath ? `${subPath}/${entry}` : entry,
          isDirectory: isDir,
        };

        // Para arquivos .md, tenta extrair título
        if (!isDir && entry.endsWith(".md")) {
          try {
            const content = await readFileAsync(entryPath, "utf-8");
            docFile.title = this.extractTitleFromMarkdown(content);
          } catch (e) {
            // Se não conseguir ler, usa o nome do arquivo como título
            docFile.title = this.pathToTitle(entry);
          }
        } else if (isDir) {
          // Para diretórios, usa o nome limpo como título
          docFile.title = this.pathToTitle(entry);
        }

        files.push(docFile);
      }

      // Ordenar: primeiro diretórios, depois arquivos
      files.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.path.localeCompare(b.path);
      });

      return this.createSuccessResponse({
        package: packageName,
        path: subPath,
        files: files,
      });
    } catch (error) {
      log("Erro ao listar arquivos:", error);
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Erro ao listar os arquivos de documentação: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Handle the get_filament_doc tool request
   */
  private async handleGetDoc(args: any) {
    try {
      if (!args.package || typeof args.package !== "string") {
        throw new McpError(
          ErrorCode.InvalidParams,
          "O parâmetro 'package' é obrigatório e deve ser uma string"
        );
      }

      if (!args.path || typeof args.path !== "string") {
        throw new McpError(
          ErrorCode.InvalidParams,
          "O parâmetro 'path' é obrigatório e deve ser uma string"
        );
      }

      const packageName = args.package.trim();
      let docPath = args.path.trim();

      // Construir o caminho completo para o arquivo
      let filePath = path.join(
        DOCS_BASE_PATH,
        "packages",
        packageName,
        "docs",
        docPath
      );

      // Verificar extensão .md
      if (!filePath.endsWith(".md")) {
        filePath += ".md";
      }

      // Verificar se o arquivo existe
      try {
        const stats = await statAsync(filePath);
        if (!stats.isFile()) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `O caminho '${packageName}/${docPath}' não é um arquivo válido`
          );
        }
      } catch (e) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `O arquivo solicitado não existe: ${packageName}/${docPath}`
        );
      }

      // Verificar cache
      const cacheKey = `${packageName}/${docPath}`;
      if (this.docContentCache.has(cacheKey)) {
        const cachedContent = this.docContentCache.get(cacheKey)!;
        const title = this.extractTitleFromMarkdown(cachedContent);

        return this.createSuccessResponse({
          title,
          content: cachedContent,
          package: packageName,
          path: docPath,
        });
      }

      // Ler o conteúdo do arquivo
      const content = await readFileAsync(filePath, "utf-8");

      // Extrair título
      const title = this.extractTitleFromMarkdown(content);

      // Salvar em cache
      this.docContentCache.set(cacheKey, content);

      return this.createSuccessResponse({
        title,
        content,
        package: packageName,
        path: docPath,
      });
    } catch (error) {
      log("Erro ao obter conteúdo do arquivo:", error);
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Erro ao obter conteúdo da documentação: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Handle the search_filament_docs tool request
   */
  private async handleSearchDocs(args: any) {
    try {
      if (!args.query || typeof args.query !== "string") {
        throw new McpError(
          ErrorCode.InvalidParams,
          "O parâmetro 'query' é obrigatório e deve ser uma string"
        );
      }

      const query = args.query.trim().toLowerCase();
      const targetPackage = args.package ? args.package.trim() : null;

      if (query.length < 3) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "O termo de busca deve ter pelo menos 3 caracteres"
        );
      }

      // Carregar a lista de pacotes se ainda não estiver em cache
      if (!this.docPackagesCache) {
        await this.handleListPackages();
      }

      // Filtrar apenas o pacote alvo, se especificado
      let packagesToSearch = this.docPackagesCache || [];
      if (targetPackage) {
        packagesToSearch = packagesToSearch.filter(
          (pkg) => pkg.name === targetPackage
        );

        if (packagesToSearch.length === 0) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Pacote não encontrado: ${targetPackage}`
          );
        }
      }

      const results: DocSearchResult[] = [];

      // Buscar em todos os arquivos de cada pacote
      for (const pkg of packagesToSearch) {
        // Construir o caminho para a pasta docs do pacote
        const docsDir = path.join(DOCS_BASE_PATH, "packages", pkg.name, "docs");

        // Função recursiva para buscar em um diretório
        const searchInDirectory = async (
          dirPath: string,
          relativePath: string = ""
        ) => {
          const entries = await readdirAsync(dirPath);

          for (const entry of entries) {
            const entryPath = path.join(dirPath, entry);
            const stats = await statAsync(entryPath);

            if (stats.isDirectory()) {
              // Recursão para subdiretórios
              const newRelativePath = relativePath
                ? `${relativePath}/${entry}`
                : entry;
              await searchInDirectory(entryPath, newRelativePath);
            } else if (stats.isFile() && entry.endsWith(".md")) {
              // Processar arquivos Markdown
              let content: string;

              // Verificar cache
              const cacheKey = `${pkg.name}/${
                relativePath ? `${relativePath}/` : ""
              }${entry}`;
              if (this.docContentCache.has(cacheKey)) {
                content = this.docContentCache.get(cacheKey)!;
              } else {
                content = await readFileAsync(entryPath, "utf-8");
                this.docContentCache.set(cacheKey, content);
              }

              // Buscar o termo no conteúdo
              if (content.toLowerCase().includes(query)) {
                const title =
                  this.extractTitleFromMarkdown(content) ||
                  this.pathToTitle(entry);
                const excerpt = this.getMarkdownExcerpt(content, query);
                const relevance = this.calculateRelevance(content, query);

                results.push({
                  title,
                  path: `${
                    relativePath ? `${relativePath}/` : ""
                  }${entry}`.replace(/\.md$/, ""),
                  package: pkg.name,
                  excerpt,
                  relevance,
                });
              }
            }
          }
        };

        await searchInDirectory(docsDir);
      }

      // Ordenar resultados por relevância
      results.sort((a, b) => b.relevance - a.relevance);

      return this.createSuccessResponse({
        query,
        results,
        count: results.length,
        package: targetPackage || "all",
      });
    } catch (error) {
      log("Erro ao buscar na documentação:", error);
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Erro ao buscar na documentação`
      );
    }
  }

  /**
   * Run the server
   */
  async run() {
    try {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
    } catch (error) {
      log("Error setting up server:", error);
      throw error;
    }
  }
}

// Limpar o arquivo de log se ele ficar muito grande
try {
  const stats = fs.statSync(LOG_FILE);
  if (stats.size > 5 * 1024 * 1024) {
    // 5MB
    fs.writeFileSync(LOG_FILE, ""); // Limpar o arquivo
  }
} catch (e) {
  // Arquivo pode não existir ainda, ignorar
}

// Create and run the server
const server = new FilamentServer();
server.run().catch((error) => {
  log("Server failed to run:", error);
  process.exit(1);
});
