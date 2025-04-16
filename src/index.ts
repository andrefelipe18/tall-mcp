#!/usr/bin/env node

/**
 * MCP server para referências de componentes Filament
 * Este servidor fornece ferramentas para:
 * - Obter informações detalhadas sobre campos de formulário do Filament
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

/**
 * Interface para informações de campo de formulário
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
 * Interface para informações de propriedade de campo
 */
interface FieldProp {
  name: string;
  description: string;
  type?: string;
  default?: string;
  required?: boolean;
}

/**
 * Interface para exemplos de campo
 */
interface FieldExample {
  title: string;
  code: string;
  description?: string;
}

/**
 * Classe FilamentServer que manipula a funcionalidade de referência de componentes
 */
class FilamentServer {
  private server: Server;
  private axiosInstance;
  private fieldCache: Map<string, FieldInfo> = new Map();
  private readonly FILAMENT_DOCS_URL = "https://filamentphp.com/docs/3.x";

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

    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  /**
   * Configura os manipuladores de ferramentas para o servidor
   */
  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "get_filament_form_field",
          description:
            "Obter informações detalhadas sobre um campo de formulário específico do Filament",
          inputSchema: {
            type: "object",
            properties: {
              fieldName: {
                type: "string",
                description:
                  'Nome do campo de formulário do Filament (ex: "text-input", "select", "repeater")',
              },
            },
            required: ["fieldName"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case "get_filament_form_field":
          return await this.handleGetFormField(request.params.arguments);
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Ferramenta desconhecida: ${request.params.name}`
          );
      }
    });
  }

  /**
   * Valida o nome do campo nos argumentos
   */
  private validateFieldName(args: any): string {
    if (!args?.fieldName || typeof args.fieldName !== "string") {
      throw new McpError(
        ErrorCode.InvalidParams,
        "O nome do campo é obrigatório e deve ser uma string"
      );
    }
    return args.fieldName.toLowerCase();
  }

  /**
   * Trata erros do Axios de forma consistente
   */
  private handleAxiosError(error: unknown, context: string): never {
    if (axios.isAxiosError(error)) {
      console.error(
        `Erro do Axios durante "${context}": ${error.message}`,
        error.response?.status,
        error.config?.url
      );
      if (error.response?.status === 404) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `${context} - Recurso não encontrado (404)`
        );
      } else {
        const status = error.response?.status || "N/A";
        const message = error.message;
        throw new McpError(
          ErrorCode.InternalError,
          `Falha durante a operação "${context}". Status: ${status}. Erro: ${message}`
        );
      }
    }
    console.error(`Erro não-Axios durante "${context}":`, error);
    throw error instanceof McpError
      ? error
      : new McpError(
          ErrorCode.InternalError,
          `Ocorreu um erro inesperado durante "${context}".`
        );
  }

  /**
   * Cria uma resposta de sucesso padronizada
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
   * Manipula a solicitação da ferramenta get_filament_form_field
   */
  private async handleGetFormField(args: any) {
    const fieldName = this.validateFieldName(args);

    try {
      // Verifica o cache primeiro
      if (this.fieldCache.has(fieldName)) {
        const cachedData = this.fieldCache.get(fieldName);
        console.error(`Cache hit para ${fieldName}`);
        return this.createSuccessResponse(cachedData);
      }
      console.error(`Cache miss para ${fieldName}, buscando...`);

      // Busca detalhes do campo
      const fieldInfo = await this.fetchFieldDetails(fieldName);

      // Salva no cache
      this.fieldCache.set(fieldName, fieldInfo);
      console.error(`Detalhes em cache para ${fieldName}`);

      return this.createSuccessResponse(fieldInfo);
    } catch (error) {
      console.error(`Erro ao buscar detalhes para ${fieldName}:`, error);
      if (error instanceof McpError) {
        throw error;
      }
      this.handleAxiosError(
        error,
        `buscando detalhes para o campo "${fieldName}"`
      );
    }
  }

  /**
   * Busca detalhes do campo da documentação do Filament
   */
  private async fetchFieldDetails(fieldName: string): Promise<FieldInfo> {
    const fieldUrl = `${this.FILAMENT_DOCS_URL}/forms/fields/${fieldName}`;
    console.error(`Buscando URL: ${fieldUrl}`);
    const response = await this.axiosInstance.get(fieldUrl);
    const $ = cheerio.load(response.data);
    console.error(`HTML carregado com sucesso para ${fieldName}`);

    // Extrai informações do campo
    const title = $("h1").first().text().trim() || fieldName;
    const description = this.extractDescription($);
    const usage = this.extractUsage($);
    const examples = this.extractExamples($);
    const props = this.extractProps($);

    console.error(
      `Extraído para ${fieldName}: Título=${title}, Desc=${description.substring(
        0,
        50
      )}..., Props=${props.length}, Exemplos=${examples.length}`
    );

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
   * Extrai a descrição do campo da página
   */
  private extractDescription($: cheerio.CheerioAPI): string {
    // Encontra o primeiro parágrafo após o h1
    const descriptionElement = $("h1").first().nextAll("p").first();

    // Se não encontrar, tenta outro seletor que possa conter a descrição principal
    if (!descriptionElement.length) {
      const mainContent = $("main").first();
      const firstPara = mainContent.find("p").first();
      return firstPara.text().trim();
    }

    return descriptionElement.text().trim();
  }

  /**
   * Extrai o exemplo de uso básico do campo
   */
  private extractUsage($: cheerio.CheerioAPI): string {
    // Tenta encontrar a primeira seção de código após algum título como "Basic Usage" ou similar
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

    // Alternativa: apenas pega o primeiro bloco de código da página
    const firstCodeBlock = $("pre").first();
    return firstCodeBlock.length ? firstCodeBlock.text().trim() : "";
  }

  /**
   * Extrai exemplos de código da página
   */
  private extractExamples($: cheerio.CheerioAPI): FieldExample[] {
    const examples: FieldExample[] = [];

    // Encontra todos os blocos de código com seus títulos precedentes
    $("pre").each((_, element) => {
      const codeBlock = $(element);
      const code = codeBlock.text().trim();

      if (code) {
        let title = "Exemplo de Código";
        let description: string | undefined = undefined;

        // Tenta encontrar o título mais próximo anterior (h2, h3, h4)
        const prevHeading = codeBlock.prev("h2, h3, h4");
        if (prevHeading.length) {
          title = prevHeading.text().trim();

          // Tenta encontrar uma descrição (parágrafo entre o título e o código)
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
   * Extrai propriedades do campo da seção de referência da API
   */
  private extractProps($: cheerio.CheerioAPI): FieldProp[] {
    const props: FieldProp[] = [];

    // Encontra a seção de referência da API/Métodos/Propriedades
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
      console.error("Seção de API/Métodos não encontrada");
      return props;
    }

    // Para cada seção de API/Métodos encontrada
    apiSectionHeadings.each((_, heading) => {
      const headingElement = $(heading);

      // Procura por tabelas após o cabeçalho
      const tables = headingElement.nextUntil("h2, h3", "table");
      tables.each((_, table) => {
        const tableElement = $(table);

        // Extrai cabeçalhos da tabela
        const headers: string[] = [];
        tableElement.find("thead th").each((_, th) => {
          headers.push($(th).text().trim().toLowerCase());
        });

        // Determina índices das colunas importantes
        const methodIndex =
          headers.indexOf("method") !== -1
            ? headers.indexOf("method")
            : headers.indexOf("name");
        const descriptionIndex = headers.indexOf("description");
        const typeIndex = headers.indexOf("type");
        const defaultIndex = headers.indexOf("default");

        // Se não encontrar colunas essenciais, pula esta tabela
        if (methodIndex === -1 || descriptionIndex === -1) {
          return;
        }

        // Processa cada linha da tabela
        tableElement.find("tbody tr").each((_, tr) => {
          const cells = $(tr).find("td");
          const name = cells.eq(methodIndex).text().trim();
          const description = cells.eq(descriptionIndex).text().trim();

          if (name && description) {
            const prop: FieldProp = {
              name,
              description,
            };

            // Adiciona tipo se disponível
            if (typeIndex !== -1) {
              const type = cells.eq(typeIndex).text().trim();
              if (type) prop.type = type;
            }

            // Adiciona valor padrão se disponível
            if (defaultIndex !== -1) {
              const defaultValue = cells.eq(defaultIndex).text().trim();
              if (defaultValue) prop.default = defaultValue;
            }

            // Verifica se é obrigatório com base na descrição
            if (description.toLowerCase().includes("required")) {
              prop.required = true;
            }

            props.push(prop);
          }
        });
      });

      // Também procura por listas (dl, dt, dd) que podem conter propriedades
      const lists = headingElement.nextUntil("h2, h3", "dl");
      lists.each((_, list) => {
        const listElement = $(list);

        // Busca todos os termos (dt) e suas descrições (dd)
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

            // Verifica se é obrigatório com base na descrição
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
   * Executa o servidor
   */
  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Servidor MCP Filament rodando em stdio");
  }
}

// Cria e executa o servidor
const server = new FilamentServer();
server.run().catch((error) => {
  console.error("Falha ao executar o servidor:", error);
  process.exit(1);
});
