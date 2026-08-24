import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';

/**
 * Ручной сдвиг цен — вне расписания робота.
 *
 * Бывает, что двинуть цены нужно прямо сейчас: площадка режет выдачу,
 * конкурент уронил цену, началась распродажа. Ждать ночного запуска в такой
 * момент неправильно.
 *
 * Сдвиг попадает в тот же журнал и в тот же счётчик пути к цели, поэтому
 * робот о нём знает и не станет двигать цены поверх свежей ручной правки.
 */
interface Props {
  onMove: (step: number, note: string) => void;
  busy: boolean;
  dryRun: boolean;
}

const RobotManualMove = ({ onMove, busy, dryRun }: Props) => {
  const [step, setStep] = useState('1');
  const [note, setNote] = useState('');

  const value = Number(step) || 0;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <h3 className="font-semibold">Сдвинуть цены вручную</h3>
          <p className="text-xs text-muted-foreground">
            Разово, не дожидаясь ночного запуска. Робот учтёт этот шаг
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label>На сколько, %</Label>
            <Input
              type="number"
              step="0.5"
              value={step}
              onChange={(e) => setStep(e.target.value)}
              className="w-[110px]"
            />
          </div>
          <div className="min-w-[200px] flex-1 space-y-1.5">
            <Label>Причина (в журнал)</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Например: конкурент уронил цену"
            />
          </div>
          {/* Две кнопки вместо знака в поле: перепутать «плюс» и «минус» в
              числе легко, а промахнуться мимо нужной кнопки — трудно. */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onMove(Math.abs(value), note)}
              disabled={busy || !value}
            >
              <Icon name="TrendingUp" size={15} className="mr-1.5" />
              Поднять на {Math.abs(value)}%
            </Button>
            <Button
              variant="outline"
              onClick={() => onMove(-Math.abs(value), note)}
              disabled={busy || !value}
            >
              <Icon name="Undo2" size={15} className="mr-1.5" />
              Опустить на {Math.abs(value)}%
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          {dryRun
            ? 'Режим наблюдения: цены на витрине не изменятся, шаг только запишется в журнал'
            : 'Цены изменятся на витрине сразу по всему ассортименту'}
        </p>
      </CardContent>
    </Card>
  );
};

export default RobotManualMove;
