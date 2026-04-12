import clsx from 'clsx';

export default function Spinner({ size = 'md', className }) {
  const sz = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-10 w-10' }[size] || 'h-6 w-6';
  return (
    <div className={clsx('animate-spin rounded-full border-2 border-gray-700 border-t-brand-400', sz, className)} />
  );
}

export function FullPageSpinner({ message }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-400">
      <Spinner size="lg" />
      {message && <p className="text-sm">{message}</p>}
    </div>
  );
}
