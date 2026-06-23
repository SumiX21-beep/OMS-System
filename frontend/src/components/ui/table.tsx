import type { ReactNode } from 'react';

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function THead({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr className="border-b border-border text-left text-xs uppercase text-slate-400">
        {cols.map((c) => (
          <th key={c} className="px-3 py-2 font-medium">
            {c}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export function TRow({ children }: { children: ReactNode }) {
  return <tr className="border-b border-border/60 hover:bg-muted/40">{children}</tr>;
}

export function TCell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 ${className ?? ''}`}>{children}</td>;
}
