import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { fetchMaterialsData, type Material } from '@/lib/materialsApi';
import { printFlyerSticker } from '@/lib/printFlyerSticker';

/** Тип материала «Тюль» — только из него шьют изделия, состав которых идёт на листовку. */
const TULLE_TYPE_ID = 1;

/** Сколько наклеек в одной ленте: ровно столько уходит за смену на один материал. */
const STICKERS_IN_TAPE = 20;

interface KioskFlyerStickersScreenProps {
  onBack: () => void;
}

/**
 * Экран печати стикеров состава на рекламную листовку.
 *
 * В посылку с тюлью кладётся листовка, и на неё клеится наклейка с составом товара.
 * Раньше такие наклейки заказывали в типографии на каждый материал: ходовые
 * заканчивались в самый неподходящий момент, а редкие лежали мёртвым запасом.
 *
 * Здесь упаковщица нажимает нужную тюль — и принтер выдаёт ленту из 20 одинаковых
 * наклеек. Больше ничего вводить не нужно: тесьма 6 см, белый цвет и производитель
 * одинаковы для всей продукции, а лишние поля на сенсорном экране — только повод
 * для ошибки в конце смены.
 */
const KioskFlyerStickersScreen = ({ onBack }: KioskFlyerStickersScreenProps) => {
  const { toast } = useToast();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [printed, setPrinted] = useState<number | null>(null);

  useEffect(() => {
    fetchMaterialsData()
      .then((data) => setMaterials(data.materials))
      .catch(() =>
        toast({ title: 'Не удалось загрузить материалы', variant: 'destructive' }),
      )
      .finally(() => setLoading(false));
  }, [toast]);

  // Показываем только действующие виды тюли: архивные материалы больше не шьются,
  // и наклейка на них — это брак упаковки.
  const tulle = useMemo(
    () =>
      materials
        .filter((m) => m.typeId === TULLE_TYPE_ID && m.status === 'active')
        .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [materials],
  );

  const print = (m: Material) => {
    printFlyerSticker({ materialName: m.name, count: STICKERS_IN_TAPE });
    // Подсвечиваем нажатую плитку: на терминале печать уходит молча, и упаковщица
    // не понимала, сработало касание или нет, — жала кнопку повторно.
    setPrinted(m.id);
    toast({
      title: `Печать: Тюль ${m.name}`,
      description: `Лента из ${STICKERS_IN_TAPE} стикеров, 58×40 мм`,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="lg" onClick={onBack}>
          <Icon name="ChevronLeft" size={20} className="mr-1" />
          Назад
        </Button>
        <div>
          <h2 className="text-xl font-bold">Стикеры на листовку</h2>
          <p className="text-sm text-muted-foreground">
            Нажмите материал — выйдет лента из {STICKERS_IN_TAPE} наклеек 58×40 мм
          </p>
        </div>
      </div>

      {/* Что будет напечатано — показываем заранее, чтобы упаковщица не печатала
          ленту «на пробу» ради проверки текста. */}
      <div className="rounded-lg border bg-muted/40 p-4">
        <p className="text-sm font-medium">На каждой наклейке:</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Тюль <span className="font-semibold text-foreground">[материал]</span> · Тесьма 6см ·
          Цвет: Белый · Производитель МегаТюль
        </p>
      </div>

      {loading && <p className="text-muted-foreground">Загрузка материалов...</p>}

      {!loading && tulle.length === 0 && (
        <p className="text-muted-foreground">Виды тюли не найдены</p>
      )}

      {/* Плитки крупные: терминал сенсорный, и по нему работают в перчатках. */}
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        {tulle.map((m) => (
          <button
            key={m.id}
            onClick={() => print(m)}
            className={`flex min-h-[7rem] flex-col items-center justify-center gap-2 rounded-xl border-2 p-4 text-center transition active:scale-95 ${
              printed === m.id
                ? 'border-emerald-500 bg-emerald-50'
                : 'border-border bg-card hover:border-primary hover:bg-primary/5'
            }`}
          >
            <Icon
              name={printed === m.id ? 'CheckCircle2' : 'Printer'}
              size={32}
              className={printed === m.id ? 'text-emerald-600' : 'text-primary'}
            />
            <span className="text-lg font-bold leading-tight">Тюль {m.name}</span>
            <span className="text-xs text-muted-foreground">
              {printed === m.id ? 'Отправлено на печать' : `${STICKERS_IN_TAPE} шт.`}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default KioskFlyerStickersScreen;