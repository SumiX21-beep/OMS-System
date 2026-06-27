import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { Badge, Button, Card, Input, Spinner } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import type { AskResult } from '@/lib/types';

interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
  tools?: string[];
}

const SUGGESTIONS = [
  'What is low on stock right now?',
  "What's the availability of MUG-WHT across locations?",
  'Forecast demand for MUG-WHT and tell me if I should reorder.',
  'Summarize my orders by status.',
];

export function AssistantPage() {
  const status = useQuery({
    queryKey: ['ai-status'],
    queryFn: () => api.get<{ assistant: boolean }>('/ai/status'),
  });
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMsg[]>([]);

  const ask = useMutation({
    mutationFn: (question: string) =>
      api.post<AskResult>('/ai/ask', { question }),
    onSuccess: (res) =>
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: res.answer, tools: res.toolsUsed },
      ]),
    onError: (e) =>
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          text: e instanceof ApiError ? e.message : 'Request failed',
        },
      ]),
  });

  const send = (q: string) => {
    const question = q.trim();
    if (!question || ask.isPending) return;
    setMessages((m) => [...m, { role: 'user', text: question }]);
    setInput('');
    ask.mutate(question);
  };

  const disabled = status.data && !status.data.assistant;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles className="text-accent" size={22} />
        <h1 className="text-2xl font-bold">Inventory Assistant</h1>
      </div>

      {disabled && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          The LLM assistant is not configured. Set <code>GEMINI_API_KEY</code> on
          the API to enable it. (The demand forecast on the Inventory page works
          without it.)
        </div>
      )}

      <Card className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="space-y-3 text-sm text-slate-500">
            <p>Ask about stock, orders, fulfilment, or demand. Try:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-border bg-card px-3 py-1 text-xs hover:bg-muted"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((m, i) => (
              <div
                key={i}
                className={m.role === 'user' ? 'text-right' : 'text-left'}
              >
                <div
                  className={
                    m.role === 'user'
                      ? 'inline-block rounded-lg bg-accent px-3 py-2 text-sm text-white'
                      : 'inline-block whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm'
                  }
                >
                  {m.text}
                </div>
                {m.tools && m.tools.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {[...new Set(m.tools)].map((t) => (
                      <Badge key={t} className="bg-slate-500/15 text-slate-500">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {ask.isPending && (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Spinner /> thinking…
              </div>
            )}
          </div>
        )}
      </Card>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <Input
          placeholder={disabled ? 'Assistant disabled' : 'Ask your inventory…'}
          value={input}
          disabled={disabled || ask.isPending}
          onChange={(e) => setInput(e.target.value)}
        />
        <Button type="submit" disabled={disabled || ask.isPending || !input.trim()}>
          <Send size={15} /> Ask
        </Button>
      </form>
    </div>
  );
}
