import { useState } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { checkKontur, type KonturCheck } from '@/lib/etrnApi';

/**
 * Проверка связи с Контуром прямо из карточки накладной.
 *
 * Подключение ЭТрН идёт в несколько шагов на стороне Контура (ключ, доступ к
 * API, облачный сертификат), и понять, какой именно шаг не пройден, по общему
 * сообщению «не работает» невозможно. Кнопка называет шаг и что с ним делать.
 */
const KonturStatus = () => {
  const [result, setResult] = useState<KonturCheck | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      setResult(await checkKontur());
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : 'Ошибка' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={run} disabled={loading}>
          <Icon name={loading ? 'Loader2' : 'PlugZap'} size={15} className={loading ? 'animate-spin' : ''} />
          <span className="ml-1.5">Проверить связь с Контуром</span>
        </Button>
        {result?.ok && (
          <span className="text-sm text-green-600 dark:text-green-500">
            Связь есть
            {result.organizations?.length
              ? ` — ${result.organizations.map((o) => o.name).filter(Boolean).join(', ')}`
              : ''}
          </span>
        )}
      </div>

      {result && !result.ok && (
        <div className="mt-2 text-sm">
          <p className="text-destructive">{result.error}</p>
          {result.hint && <p className="mt-0.5 text-muted-foreground">{result.hint}</p>}
        </div>
      )}
    </div>
  );
};

export default KonturStatus;
