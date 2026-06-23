import Anthropic from '@anthropic-ai/sdk';
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

// Tools the model may call. Each maps to a tenant-scoped read on real OMS data.
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_availability',
    description:
      'Get available-to-promise stock for a SKU: network total plus a per-location breakdown. Call this when asked about stock levels or availability of a product.',
    input_schema: {
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
    input_schema: {
      type: 'object',
      properties: {
        threshold: {
          type: 'integer',
          description: 'available <= this number (default 5)',
        },
      },
      required: [],
    },
  },
  {
    name: 'order_summary',
    description:
      'Order counts by status and by channel. Call this when asked about the order pipeline.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'forecast_demand',
    description:
      'Forecast demand, days-of-cover, and a reorder suggestion for a SKU from recent shipment history. Call this when asked about demand, runway, or whether to reorder.',
    input_schema: {
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
  private readonly client: Anthropic | null;
  private readonly model: string;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly atp: AtpService,
    private readonly reporting: ReportingService,
    private readonly forecast: DemandForecastService,
  ) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY');
    this.model = config.get<string>('ANTHROPIC_MODEL', 'claude-opus-4-8');
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  /** Run an agentic tool-use loop to answer a natural-language question. */
  async ask(tenantId: string, question: string): Promise<AskResult> {
    if (!this.client) {
      throw new BadRequestException(
        'AI assistant is not configured — set ANTHROPIC_API_KEY. (The /ai/forecast endpoint works without it.)',
      );
    }

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: question },
    ];
    const toolsUsed: string[] = [];
    const maxSteps = 6;

    for (let step = 1; step <= maxSteps; step++) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: SYSTEM,
        tools: TOOLS,
        messages,
      });

      if (response.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: response.content });
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          toolsUsed.push(block.name);
          const output = await this.runTool(
            tenantId,
            block.name,
            block.input as Record<string, unknown>,
          );
          results.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(output),
          });
        }
        messages.push({ role: 'user', content: results });
        continue;
      }

      // Terminal turn — collect the text answer.
      const answer = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
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
