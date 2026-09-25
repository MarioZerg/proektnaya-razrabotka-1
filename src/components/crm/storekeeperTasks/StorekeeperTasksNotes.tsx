import type { StorekeeperTask } from '@/lib/shiftSessionsApi';

interface StorekeeperTasksNotesProps {
  shown: StorekeeperTask[];
  isDemo: boolean;
  blockingCount: number;
}

/** Пояснения под списком: демо-режим, отсечка 15:00, чужие задания и блокировка смены. */
const StorekeeperTasksNotes = ({
  shown,
  isDemo,
  blockingCount,
}: StorekeeperTasksNotesProps) => (
  <>
    {isDemo && (
      <p className="px-1 pt-1 text-[11px] leading-snug text-muted-foreground">
        Демо-просмотр: цифры настоящие, галочки нажимаются для примера и
        никуда не сохраняются. У кладовщика на смене сами закрываются все
        задания, кроме отгрузки ткани и напоминания про рулоны.
      </p>
    )}
    {/* Общее пояснение внизу — чтобы правило было понятно даже тому,
        кто впервые видит список. */}
    {shown.some((t) => t.cutoff) && (
      <p className="px-1 pt-1 text-[11px] leading-snug text-muted-foreground">
        {shown.some((t) => t.cutoffPassed)
          ? 'После 15:00 новая работа в задания смены не попадает — она уйдёт в список на завтра. Этот список можно закрыть полностью.'
          : 'Отмеченные задания копятся до 15:00. Всё, что придёт позже, попадёт в задания следующего дня — искать это перед закрытием смены не нужно.'}
      </p>
    )}
    {shown.some((t) => t.claimedByOther) && (
      <p className="px-1 pt-1 text-[11px] leading-snug text-slate-600">
        Серые задания взял другой кладовщик — они на нём и вашу смену не
        держат. Нажмите «Беру» на своих делах, чтобы он не пошёл за теми же
        вещами.
      </p>
    )}
    {blockingCount > 0 && !isDemo && (
      <p className="px-1 pt-1 text-[11px] leading-snug text-amber-700">
        Смену нельзя закрыть, пока не сделано: {blockingCount} задание
        {blockingCount > 1 ? 'й' : ''}. Задания с галочкой вручную и взятые
        другим кладовщиком смену не держат.
      </p>
    )}
  </>
);

export default StorekeeperTasksNotes;
