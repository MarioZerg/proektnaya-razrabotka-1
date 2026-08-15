import { useState } from 'react';
import { Button } from '@/components/ui/button';
import KioskNumPad from '@/components/crm/kiosk/KioskNumPad';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useGlobalScanner } from '@/hooks/useGlobalScanner';
import { playScanSound } from '@/lib/scanSound';
import { createDefect, scanDefectRoll, type ScannedDefectRoll } from '@/lib/kioskApi';
import { printDefectSticker } from '@/lib/printDefectSticker';
import { formatQuantity } from '@/lib/formatQuantity';

interface KioskDefectWriteoffPanelProps {
  /** Цех, в котором стоит терминал — брак оформляем только по его рулонам. */
  workshopId: number;
  /** Сотрудник работает в чужом цехе — сам оформить брак не может, нужен штатный работник. */
  isGuest: boolean;
  /** Должность: от неё зависит, с каким материалом человек работает. */
  role?: string;
  /** Сотрудник, вошедший на терминале: свой штрихкод повторно сканировать не нужно. */
  userId: number;
  userName?: string;
}

/**
 * Личный экран учёта брака на терминале.
 *
 * Работает как весы: сотрудник подносит сканер к стикеру рулона (или коробки с тесьмой),
 * рулон открывается сам — и дальше он указывает только метраж брака и причину.
 *
 * Почему так, а не списком: раньше на экране висели ВСЕ рулоны цеха, и человек искал
 * свой номер глазами среди десятков чужих. Ошибиться было легко, а списание тогда
 * уходило с чужого рулона, и остатки расходились с реальностью. Плюс приходилось
 * повторно сканировать свой штрихкод, хотя вход на терминал уже выполнен.
 *
 * Правило смены проверяет сервер: сканировать можно только рулоны СВОЕЙ смены. Если
 * человек вышел работать в чужую смену — ему доступны рулоны той смены, где он стоит,
 * а свои родные становятся недоступны: они лежат в другом помещении.
 *
 * После оформления печатается стикер брака 58×40: его клеят на бракованный кусок и
 * кладут в контейнер, а кладовщик сканирует его на складе в «Приём брака из цеха».
 */
const KioskDefectWriteoffPanel = ({
  isGuest,
  role,
  userId,
  userName,
}: KioskDefectWriteoffPanelProps) => {
  const { toast } = useToast();
  const [roll, setRoll] = useState<ScannedDefectRoll | null>(null);
  const [reasonCode, setReasonCode] = useState('');
  const [quantity, setQuantity] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  // Отсканировали рулон, который брать нельзя — показываем причину крупно.
  const [scanError, setScanError] = useState('');

  const isPacker = role === 'packer';
  const isSewer = role === 'sewer';

  const reset = () => {
    setRoll(null);
    setReasonCode('');
    setQuantity('');
    setComment('');
    setScanError('');
  };

  // Скан рулона — единственный путь выбрать материал. Сервер сам проверит цех, смену
  // и роль, поэтому чужой рулон сюда не попадёт даже случайным сканом.
  const handleScan = async (raw: string) => {
    const code = raw.trim();
    if (!code || scanning || saving) return;
    setScanning(true);
    try {
      const found = await scanDefectRoll(code, userId);
      playScanSound();
      setScanError('');
      setRoll(found);
      setReasonCode('');
      setQuantity('');
      setComment('');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Рулон не найден';
      setScanError(msg);
      toast({ title: 'Рулон не подходит', description: msg, variant: 'destructive' });
    } finally {
      setScanning(false);
    }
  };

  // Ловим сканер на уровне всей страницы: поля с фокусом здесь нет, а на планшете
  // фокус легко теряется от случайного касания.
  useGlobalScanner((v) => void handleScan(v), !roll && !saving && !isGuest);

  const quantityNumber = Number(quantity.replace(',', '.'));
  const tooMuch = !!roll && quantityNumber > roll.remaining;

  const handleSubmit = async () => {
    if (!roll || !quantity || !reasonCode || tooMuch) return;
    setSaving(true);
    try {
      const res = await createDefect({
        userId,
        rollId: roll.id,
        quantity: quantityNumber,
        reasonCode,
        comment: comment.trim() || undefined,
      });

      // Стикер печатаем сразу: без него кладовщик не сможет принять брак на склад.
      printDefectSticker({
        barcode: res.defectBarcode,
        materialName: roll.materialName,
        quantity: quantityNumber,
        unit: res.unit || roll.unit,
        reasonLabel: res.reasonLabel,
        userId: res.actorId,
      });

      toast({
        title: `Брак оформлен: ${res.defectBarcode}`,
        description: 'Наклейте стикер и положите брак в контейнер — кладовщик заберёт его на склад',
      });
      reset();
    } catch (e) {
      toast({
        title: 'Не удалось оформить брак',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  // Гость в чужом цехе оформляет брак через штатного сотрудника — сканер ему не даём.
  if (isGuest) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <Icon name="PackageX" size={24} className="mt-0.5 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold">Брак из рулона</p>
            <p className="mt-1 text-base text-muted-foreground">
              Вы работаете в чужом цехе — позовите штатного сотрудника этого цеха, он
              оформит брак за вас.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Рулон ещё не отсканирован — приглашение поднести сканер.
  if (!roll) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border-2 border-dashed border-destructive/40 bg-card p-6">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="rounded-full bg-destructive/10 p-6">
              <Icon
                name={scanning ? 'Loader2' : 'ScanLine'}
                size={56}
                className={`text-destructive ${scanning ? 'animate-spin' : ''}`}
              />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {scanning ? 'Ищем рулон…' : isPacker ? 'Отсканируйте пачку' : 'Отсканируйте рулон'}
              </p>
              <p className="mt-1 text-lg text-muted-foreground">
                {isPacker
                  ? 'Поднесите сканер к стикеру на пачке с пакетами или этикетками'
                  : isSewer
                    ? 'Поднесите сканер к стикеру на коробке с тесьмой'
                    : 'Поднесите сканер к стикеру на рулоне'}
              </p>
            </div>
            <p className="text-base text-muted-foreground">
              Сканировать можно только материал своей смены
            </p>
          </div>
        </div>

        {/* Промах сканера показываем крупно: причину видно с расстояния вытянутой руки. */}
        {scanError && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive bg-destructive/5 p-4">
            <Icon name="TriangleAlert" size={24} className="mt-0.5 shrink-0 text-destructive" />
            <div>
              <p className="font-bold text-destructive">Так нельзя</p>
              <p className="text-base text-muted-foreground">{scanError}</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Подпись у материала: ткань / тесьма / упаковка.
  const materialLabel =
    roll.materialType === 'Тюль' ? 'ткань' : roll.materialType === 'Упаковка' ? 'упаковка' : 'тесьма';

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="text-center">
        <p className="text-lg text-muted-foreground">
          {isPacker ? 'Пачка' : 'Рулон'} · {userName || 'Вы'}
        </p>
        <p className="font-mono-tech text-2xl font-bold">#{roll.barcode}</p>
        <p className="mt-1 text-lg">{roll.materialName}</p>
      </div>

      {/* Остаток крупно и рядом с вводом: человек указывает брак, глядя на то,
          сколько по системе числится на рулоне. */}
      <div className="rounded-md border-2 border-border bg-muted/40 p-3 text-center">
        <p className="text-sm text-muted-foreground">По системе осталось</p>
        <p className="font-mono-tech text-3xl font-bold">
          {formatQuantity(roll.remaining)} {roll.unit}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm">
          Причина брака
          <Badge variant="secondary" className="ml-2">
            {materialLabel}
          </Badge>
        </Label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {roll.reasons.map((r) => (
            <Button
              key={r.code}
              type="button"
              variant={reasonCode === r.code ? 'default' : 'outline'}
              className="h-14 text-base"
              onClick={() => setReasonCode(r.code)}
            >
              {reasonCode === r.code && <Icon name="Check" size={18} className="mr-1.5" />}
              {r.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm">
          {isPacker ? 'Количество брака' : 'Метраж брака'}
          {roll.unit ? `, ${roll.unit}` : ''}
        </Label>
        {/* Крупное табло + кнопки: в цехе набирают пальцем, клавиатуры нет. */}
        <div className="rounded-md border-2 border-border bg-muted/40 p-3 text-center">
          <p className="font-mono-tech text-3xl font-bold">{quantity || '0'}</p>
          {/* Больше остатка списать нельзя — предупреждаем до нажатия кнопки. */}
          {tooMuch && (
            <p className="mt-1 text-sm font-semibold text-destructive">
              Больше, чем осталось на рулоне — проверьте цифру
            </p>
          )}
        </div>
        <KioskNumPad value={quantity} onChange={setQuantity} />
      </div>

      <div className="space-y-1.5">
        <Label className="text-sm">Где брак (необязательно)</Label>
        {/* Свободный текст в киоске не набрать — даём готовые варианты кнопками.
            Повторное нажатие снимает выбор: уточнение необязательное. */}
        <div className="grid grid-cols-2 gap-2">
          {(isPacker
            ? ['Вся пачка', 'Часть пачки', 'Края', 'Отдельные штуки']
            : ['По всей длине', 'По кромке', 'В начале рулона', 'В середине', 'В конце', 'Местами']
          ).map((label) => (
            <Button
              key={label}
              type="button"
              variant={comment === label ? 'default' : 'outline'}
              className="h-14 text-base"
              onClick={() => setComment((c) => (c === label ? '' : label))}
            >
              {comment === label && <Icon name="Check" size={18} className="mr-1.5" />}
              {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" className="h-14 flex-1 text-lg" onClick={reset}>
          Отмена
        </Button>
        <Button
          variant="destructive"
          className="h-14 flex-1 text-lg"
          disabled={saving || !quantity || !reasonCode || tooMuch}
          onClick={handleSubmit}
        >
          {saving ? <Icon name="Loader2" size={20} className="mr-2 animate-spin" /> : null}
          Оформить и печать
        </Button>
      </div>
    </div>
  );
};

export default KioskDefectWriteoffPanel;
