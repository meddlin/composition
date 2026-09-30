export function LoadFailed({ what, message }: { what: string; message: string }) {
  return (
    <div role="alert" className="flex h-screen flex-col items-center justify-center gap-2 p-6">
      <p className="text-error">Couldn&apos;t load {what}.</p>
      <p className="max-w-xl text-center font-mono text-xs text-foreground/60">{message}</p>
    </div>
  );
}
