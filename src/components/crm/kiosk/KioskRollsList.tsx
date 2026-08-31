import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import type { Roll } from '@/lib/rollsApi';
import type { MaterialType } from '@/lib/materialsApi';
import { formatQuantity } from '@/lib/formatQuantity';

interface KioskRollsListProps {
  loading: boolean;
  /** Типы материалов, доступные роли: закройщик — ткань, швея — тесьма, упаковщица — упаковка. */
  visibleTypes: MaterialType[];
  typeFilter: number | 'all';
  setTypeFilter: (value: number | 'all') => void;
  search: string;
  setSearch: (value: string) => void;
  /** Рулоны после фильтра по типу и поиска. */
  visibleRolls: Roll[];
  onSelect: (roll: Roll) => void;
  /** Приёмка рулона сменой: подтверждение, что материал реально доехал в цех. */
  onAccept: (roll: Roll) => void;
  onBackToScan: () => void;
}

/** Запасной путь выбора рулона: стикер порван или сканер не читает. Фильтр по типу
 * материала, поиск по номеру и названию, список рулонов смены. */
const KioskRollsList = ({
  loading,
  visibleTypes,
  typeFilter,
  setTypeFilter,
  search,
  setSearch,
  visibleRolls,
  onSelect,
  onAccept,
  onBackToScan,
}: KioskRollsListProps) => (
  <div className="space-y-3">
    {/* Возврат к сканированию: основной режим работы. */}
    <Button
      variant="outline"
      size="lg"
      className="h-16 w-full text-xl"
      onClick={onBackToScan}
    >
      <Icon name="ScanLine" size={26} className="mr-2" />
      Вернуться к сканированию
    </Button>

    {/* Фильтр по типу материала: Ткань (Тюль), Аксессуары, Упаковка */}
    <div className="flex flex-wrap gap-2">
      <Button
        variant={typeFilter === 'all' ? 'default' : 'outline'}
        className="h-16 px-6 text-xl"
        onClick={() => setTypeFilter('all')}
      >
        Все
      </Button>
      {visibleTypes.map((t) => (
        <Button
          key={t.id}
          variant={typeFilter === t.id ? 'default' : 'outline'}
          className="h-16 px-6 text-xl"
          onClick={() => setTypeFilter(t.id)}
        >
          {t.name}
        </Button>
      ))}
    </div>

    <Input
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      placeholder="Поиск по номеру рулона или материалу"
      className="h-16 text-xl"
    />

    {loading ? (
      <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
        <Icon name="Loader2" size={24} className="animate-spin" />
        Загрузка…
      </div>
    ) : visibleRolls.length === 0 ? (
      <p className="py-10 text-center text-2xl text-muted-foreground">
        {search.trim()
          ? 'Рулон не найден — проверьте номер'
          : 'В вашей смене нет открытых рулонов'}
      </p>
    ) : (
      // Две колонки на широком экране: рулонов в смене бывает по два десятка,
      // одной лентой их пришлось бы долго листать пальцем.
      <div className="grid gap-3 md:grid-cols-2">
      {visibleRolls.map((r) => {
        // Рулон закрывается вручную: закройщик сам выбирает его из списка своей смены,
        // сканер не нужен. Раньше рулон открывался только после движения материала в
        // смене — но закончившийся рулон, по которому в эту смену ещё не резали,
        // из-за этого закрыть было нельзя.
        //
        // Остаются два запрета: непринятый материал (мог не доехать) и отставленный
        // из-за брака рулон (он ждёт кладовщика).
        const active = !r.pendingAcceptance && !r.defectFlaggedAt;
        // Непринятый рулон — не тупик: сотрудник видит его и может подтвердить
        // приёмку прямо здесь. Без этой кнопки рулон, отгруженный со склада,
        // навсегда оставался бы серым и нерабочим.
        if (r.pendingAcceptance && !r.defectFlaggedAt) {
          return (
            <div
              key={r.id}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-amber-500/60 bg-amber-50 p-5 text-left"
            >
              <div className="min-w-0">
                <div className="font-mono-tech text-2xl font-bold">#{r.barcode}</div>
                <div className="text-xl text-muted-foreground">{r.materialName}</div>
                <div className="text-base font-medium text-amber-700">
                  Привезён со склада — подтвердите приёмку
                </div>
              </div>
              <Button
                size="lg"
                className="h-16 shrink-0 px-6 text-xl"
                onClick={() => onAccept(r)}
              >
                <Icon name="PackageCheck" size={26} className="mr-2" />
                Принять
              </Button>
            </div>
          );
        }

        return (
          <button
            key={r.id}
            onClick={() => active && onSelect(r)}
            disabled={!active}
            className={`flex w-full items-center justify-between gap-3 rounded-lg border border-border p-5 text-left ${
              active ? 'hover:bg-accent' : 'cursor-not-allowed opacity-40 grayscale'
            }`}
          >
            <div className="min-w-0">
              <div className="font-mono-tech text-2xl font-bold">#{r.barcode}</div>
              <div className="text-xl text-muted-foreground">{r.materialName}</div>
              {r.foreignShift && (
                <div className="text-base font-medium text-amber-600">
                  Материал чужой смены
                </div>
              )}
              {r.defectFlaggedAt ? (
                <div className="text-base font-medium text-destructive">
                  Отставлен как бракованный — ждёт кладовщика
                </div>
              ) : r.pendingAcceptance ? (
                <div className="text-base font-medium text-amber-600">
                  Не принят — подтвердите поставку
                </div>
              ) : (
                r.usedInShift && (
                  <div className="text-base text-emerald-600">Резали в эту смену</div>
                )
              )}
            </div>
            <Badge variant="secondary" className="shrink-0 px-3 py-1.5 text-xl">
              {formatQuantity(r.remainingQuantity)} {r.unit}
            </Badge>
          </button>
        );
      })}
      </div>
    )}
  </div>
);

export default KioskRollsList;
