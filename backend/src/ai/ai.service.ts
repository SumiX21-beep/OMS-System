import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';
import { AtpService } from '../inventory/atp.service';
import { ReportingService } from '../admin/reporting.service';
import { DemandForecastService } from './demand-forecast.service';

export interface AskResult {
  answer: string;
  toolsUsed: string[];
  steps: number;
}

// --- Gemini REST types (the slice we use) ---
interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  thoughtSignature?: string;
}
interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}
interface GeminiCandidate {
  content?: GeminiContent;
  finishReason?: string;
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
  error?: { message?: string };
}

interface FunctionDeclaration {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

// Tools the model may call. Each maps to a tenant-scoped read on real OMS data.
const FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'get_availability',
    description:
      'Get available-to-promise stock for a SKU: network total plus a per-location breakdown. Call this when asked about stock levels or availability of a product.',
    parameters: {
      type: 'object',
      properties: {
        skuCode: { type: 'string', description: 'SKU code, e.g. "MUG-WHT"' },
      },
      required: ['skuCode'],
    },
  },
  {
    name: 'list_low_stock',
    description:
      'List SKU/location combinations at or below an availability threshold. Call this when asked what is low or running out.',
    parameters: {
      type: 'object',
      properties: {
        threshold: {
          type: 'integer',
          description: 'available <= this number (default 5)',
        },
      },
    },
  },
  {
    name: 'order_summary',
    description:
      'Order counts by status and by channel. Call this when asked about the order pipeline.',
  },
  {
    name: 'forecast_demand',
    description:
      'Forecast demand, days-of-cover, and a reorder suggestion for a SKU from recent shipment history. Call this when asked about demand, runway, or whether to reorder.',
    parameters: {
      type: 'object',
      properties: {
        skuCode: { type: 'string', description: 'SKU code, e.g. "MUG-WHT"' },
        horizonDays: { type: 'integer', description: 'forecast window (default 14)' },
      },
      required: ['skuCode'],
    },
  },
];

const SYSTEM = `You are the operations assistant for an Omnichannel Order Management System (OMS).
Answer questions about inventory, orders, fulfilment, and demand using the tools provided.
Products are identified by SKU codes like "MUG-WHT" or "TSHIRT-BLK-M".
Always ground answers in tool results and cite the concrete numbers. Be concise.
If the tools don't return what's needed, say so plainly rather than guessing.`;

@Injectable()
export class AiService {
  private readonly log = new Logger(AiService.name);
  private readonly apiKey: string | null;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly atp: AtpService,
    private readonly reporting: ReportingService,
    private readonly forecast: DemandForecastService,
  ) {
    this.apiKey = config.get<string>('GEMINI_API_KEY') || null;
    this.model = config.get<string>('GEMINI_MODEL', 'gemini-2.5-flash');
    this.baseUrl = config.get<string>(
      'GEMINI_BASE_URL',
      'https://generativelanguage.googleapis.com/v1beta',
    );
  }

  get enabled(): boolean {
    return this.apiKey !== null;
  }

  /** Run an agentic tool-use loop to answer a natural-language question. */
  async ask(tenantId: string, question: string): Promise<AskResult> {
    if (!this.apiKey) {
      throw new BadRequestException(
        'AI assistant is not configured — set GEMINI_API_KEY. (The /ai/forecast endpoint works without it.)',
      );
    }

    const contents: GeminiContent[] = [
      { role: 'user', parts: [{ text: question }] },
    ];
    const toolsUsed: string[] = [];
    const maxSteps = 6;

    for (let step = 1; step <= maxSteps; step++) {
      const candidate = await this.generate(contents);
      const parts = candidate.content?.parts ?? [];
      const calls = parts.filter((p) => p.functionCall);

      if (calls.length > 0) {
        // Echo the model's turn back verbatim (preserves thoughtSignature).
        contents.push({ role: 'model', parts });
        const responseParts: GeminiPart[] = [];
        for (const part of calls) {
          const call = part.functionCall!;
          toolsUsed.push(call.name);
          const output = await this.runTool(tenantId, call.name, call.args ?? {});
          responseParts.push({
            functionResponse: {
              name: call.name,
              response: this.asObject(output),
            },
          });
        }
        contents.push({ role: 'user', parts: responseParts });
        continue;
      }

      // Terminal turn — collect the text answer.
      const answer = parts
        .map((p) => p.text ?? '')
        .join('\n')
        .trim();
      return { answer, toolsUsed, steps: step };
    }

    return {
      answer: 'Stopped after too many tool calls without a final answer.',
      toolsUsed,
      steps: maxSteps,
    };
  }

  /** One Gemini generateContent round-trip; returns the first candidate.
   * Retries transient overload/rate-limit responses with exponential backoff. */
  private async generate(contents: GeminiContent[]): Promise<GeminiCandidate> {
    const url = `${this.baseUrl}/models/${this.model}:generateContent`;
    const payload = JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM }] },
      contents,
      tools: [{ function_declarations: FUNCTION_DECLARATIONS }],
      generationConfig: { temperature: 0, maxOutputTokens: 1024 },
    });

    const maxAttempts = 4;
    let lastMsg = 'unknown error';
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.apiKey!,
        },
        body: payload,
      });
      const body = (await res.json()) as GeminiResponse;

      if (res.ok && !body.error) {
        const candidate = body.candidates?.[0];
        if (candidate) return candidate;
        lastMsg = 'Gemini returned no candidates';
      } else {
        lastMsg = body.error?.message ?? `HTTP ${res.status}`;
      }

      // Retry transient overload (503) / rate limit (429); fail fast otherwise.
      const transient =
        res.status === 503 ||
        res.status === 429 ||
        /high demand|overloaded|temporar|try again/i.test(lastMsg);
      if (!transient || attempt === maxAttempts) break;

      const backoffMs = 500 * 2 ** (attempt - 1);
      this.log.warn(
        `Gemini transient error (attempt ${attempt}/${maxAttempts}): ${lastMsg} — retrying in ${backoffMs}ms`,
      );
      await new Promise((r) => setTimeout(r, backoffMs));
    }

    throw new BadRequestException(`Gemini request failed: ${lastMsg}`);
  }

  /** functionResponse.response must be a JSON object; wrap scalars/arrays. */
  private asObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return { result: value };
  }

  /** Execute a tool call against tenant-scoped OMS data. */
  private async runTool(
    tenantId: string,
    name: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      switch (name) {
        case 'get_availability': {
          const sku = await this.prisma.sku.findFirst({
            where: { tenantId, code: String(input.skuCode) },
            select: { id: true, code: true },
          });
          if (!sku) return { error: `Unknown SKU ${input.skuCode}` };
          const [network, breakdown] = await Promise.all([
            this.atp.network(tenantId, sku.id),
            this.atp.breakdown(tenantId, sku.id),
          ]);
          return { sku: sku.code, network, byLocation: breakdown };
        }
        case 'list_low_stock': {
          const threshold =
            input.threshold != null ? Number(input.threshold) : 5;
          return this.reporting.inventory(tenantId, threshold);
        }
        case 'order_summary':
          return this.reporting.orders(tenantId);
        case 'forecast_demand':
          return this.forecast.forecastBySkuCode(
            tenantId,
            String(input.skuCode),
            input.horizonDays != null ? Number(input.horizonDays) : 14,
          );
        default:
          return { error: `Unknown tool ${name}` };
      }
    } catch (err) {
      this.log.warn(`Tool ${name} failed: ${(err as Error).message}`);
      return { error: (err as Error).message };
    }
  }
}
