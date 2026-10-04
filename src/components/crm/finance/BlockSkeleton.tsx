import { Skeleton } from '@/components/ui/skeleton';

/** Скелетон блока: держит высоту, чтобы при подстановке данных вёрстка не прыгала. */
const BlockSkeleton = ({ rows = 3 }: { rows?: number }) => (
  <div className="space-y-3" aria-busy="true" aria-label="Загрузка">
    <Skeleton className="h-7 w-32" />
    {Array.from({ length: rows }).map((_, i) => (
      <Skeleton key={i} className="h-4 w-full" />
    ))}
  </div>
);

export default BlockSkeleton;
