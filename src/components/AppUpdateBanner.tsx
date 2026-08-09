import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { applyUpdate, watchForUpdates } from '@/lib/appUpdate';

/**
 * Сообщение «вышла новая версия» с кнопкой обновления.
 *
 * Не перезагружаем страницу сами: сотрудник может в этот момент заполнять приёмку
 * или собирать отгрузку — введённое пропало бы. Поэтому решает человек.
 *
 * Плашку можно отложить, но она вернётся через 10 минут: работать в устаревшей версии
 * долго нельзя, там могут быть неверные расценки или старые правила.
 */
const SNOOZE_MS = 10 * 60 * 1000;

const AppUpdateBanner = () => {
  const [available, setAvailable] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    watchForUpdates(setAvailable);
  }, []);

  useEffect(() => {
    if (!hidden) return;
    const timer = window.setTimeout(() => setHidden(false), SNOOZE_MS);
    return () => window.clearTimeout(timer);
  }, [hidden]);

  if (!available || hidden) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 px-3 pb-3 sm:left-auto sm:right-4 sm:w-96 sm:px-0">
      <div className="rounded-lg border border-border bg-background p-4 shadow-lg">
        <div className="flex items-start gap-3">
          <Icon
            name="ArrowDownCircle"
            size={22}
            className="mt-0.5 shrink-0 text-primary"
          />
          <div className="min-w-0 flex-1">
            <p className="font-bold">Вышла новая версия системы</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Обновите страницу, когда закончите текущее действие. Введённые данные,
              которые вы ещё не сохранили, пропадут
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={applying}
                onClick={() => {
                  setApplying(true);
                  applyUpdate();
                }}
              >
                {applying ? (
                  <Icon name="Loader2" size={14} className="mr-1.5 animate-spin" />
                ) : (
                  <Icon name="RefreshCw" size={14} className="mr-1.5" />
                )}
                Обновить сейчас
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={applying}
                onClick={() => setHidden(true)}
              >
                Позже
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AppUpdateBanner;
