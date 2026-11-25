'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Alert, Empty, PageHeader, StatusBadge, useApi } from '@/components/ui';
import { when } from '@/lib/api';

interface Flow { id: string; name: string; status: string; trigger: { type: string; keywords?: string[] }; node_count: number; runs: number; failed_runs: number; updated_at: string }

const triggerText = (t: Flow['trigger']) =>
  t.type === 'keyword' ? `Keyword: ${t.keywords?.join(', ')}` : t.type === 'new_conversation' ? 'First message from a new chat' : 'Any message';

export default function FlowsPage() {
  const flows = useApi<{ data: Flow[] }>('/flows');
  return (
    <div className="p-6">
      <PageHeader title="Automation" subtitle="Chatbots that reply on keywords, greet new chats and collect details. They pause when a person takes over a chat."
        actions={<Link href="/flows/new" className="btn btn-primary"><Plus size={16} /> New flow</Link>} />
      {flows.error && <Alert>{flows.error}</Alert>}
      {flows.data?.data.length === 0 ? <Empty title="No flows yet">Start with a keyword reply, for example "price" → send your price list.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead><tr><th className="th">Flow</th><th className="th">Trigger</th><th className="th">Status</th><th className="th">Steps</th><th className="th">Runs</th><th className="th">Updated</th></tr></thead>
            <tbody>
              {(flows.data?.data ?? []).map((f) => (
                <tr key={f.id}>
                  <td className="td"><Link href={`/flows/${f.id}`} className="font-medium text-brand hover:underline">{f.name}</Link></td>
                  <td className="td text-muted">{triggerText(f.trigger)}</td>
                  <td className="td"><StatusBadge status={f.status} /></td>
                  <td className="td">{f.node_count}</td>
                  <td className="td">{f.runs}{f.failed_runs ? <span className="text-danger"> ({f.failed_runs} failed)</span> : null}</td>
                  <td className="td text-muted">{when(f.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
