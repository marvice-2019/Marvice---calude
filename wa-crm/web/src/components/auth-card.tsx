import { APP_NAME } from '@/lib/api';

export function AuthCard({ title, children, footer }: { title: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <main className="flex min-h-full items-center justify-center bg-gradient-to-br from-brand-soft via-canvas to-amber-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand text-lg font-bold text-white">{APP_NAME[0]}</span>
          <span className="text-lg font-semibold">{APP_NAME}</span>
        </div>
        <div className="card p-6 shadow-sm">
          <h1 className="mb-5 text-lg font-semibold">{title}</h1>
          {children}
        </div>
        <p className="mt-4 text-center text-sm text-muted">{footer}</p>
      </div>
    </main>
  );
}
