import { useEffect, useMemo, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { fetchPackagingGuide, type PackagingGuide as Guide } from '@/lib/materialsApi';

/**
 * Справочник упаковки для упаковщицы: какой пакет брать под какой товар.
 *
 * Показываем сеткой «ткань × ширина», потому что пакет зависит именно от этой пары.
 * Высоты в таблице нет намеренно: изделие складывается, и высота уходит в толщину
 * свёртка — на размер пакета она не влияет.
 */

/** Цвет плашки пакета. Разные размеры — разные цвета, чтобы искать глазами, а не читать. */
const bagStyles: Record<string, string> = {
  'Пакет 25х30': 'bg-emerald-100 text-emerald-900 ring-emerald-300',
  'Пакет 30х35': 'bg-amber-100 text-amber-900 ring-amber-300',
  'Пакет 35х40': 'bg-sky-100 text-sky-900 ring-sky-300',
};

const bagStyle = (bag: string) => bagStyles[bag] ?? 'bg-muted text-foreground ring-border';

/** «Пакет 30х35» → «30х35»: в ячейке слово «пакет» только занимает место. */
const shortBag = (bag: string) => bag.replace(/^Пакет\s*/i, '');

const PackagingGuidePage = () => {
  const [guide, setGuide] = useState<Guide | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchPackagingGuide()
      .then(setGuide)
      .finally(() => setLoading(false));
  }, []);

  // Быстрый доступ «ткань + ширина → пакет».
  const bagByKey = useMemo(() => {
    const map = new Map<string, string>();
    guide?.rows.forEach((r) => map.set(`${r.fabric}|${r.width}`, r.bag));
    return map;
  }, [guide]);

  const visibleFabrics = useMemo(() => {
    if (!guide) return [];
    const q = search.trim().toLowerCase();
    if (!q) return guide.fabrics;
    return guide.fabrics.filter((f) => f.toLowerCase().includes(q));
  }, [guide, search]);

  return (
    <CrmLayout>
      <div className="space-y-4 sm:space-y-6">
        <div>
          <h1 className="text-xl font-bold">Подбор пакетов</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Найдите ткань и ширину изделия — на пересечении нужный пакет
          </p>
        </div>

        {/* Главное предупреждение: упаковщицы часто ищут в таблице высоту и не находят. */}
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/50 p-3">
          <Icon name="Info" size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Высота изделия на выбор пакета не влияет — товар складывается. Смотрите только
            ткань и ширину.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Icon name="Loader2" size={28} className="animate-spin text-muted-foreground" />
          </div>
        ) : !guide || guide.rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Справочник пуст: у товаров пока не указана упаковка
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[200px] flex-1">
                <Icon
                  name="Search"
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  placeholder="Найти ткань"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>

              {/* Легенда: какой цвет какому пакету соответствует. */}
              <div className="flex flex-wrap items-center gap-2">
                {guide.bags.map((b) => (
                  <span
                    key={b}
                    className={`rounded-sm px-2 py-1 text-xs font-medium ring-1 ${bagStyle(b)}`}
                  >
                    {b}
                  </span>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/60">
                    <th className="sticky left-0 z-10 border-b border-r border-border bg-muted/60 px-4 py-3 text-left font-semibold">
                      Ткань
                    </th>
                    {guide.widths.map((w) => (
                      <th
                        key={w}
                        className="border-b border-border px-3 py-3 text-center font-semibold"
                      >
                        {w}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">см</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleFabrics.map((fabric) => (
                    <tr key={fabric} className="even:bg-muted/20">
                      <td className="sticky left-0 z-10 border-r border-border bg-background px-4 py-3 font-medium even:bg-muted/20">
                        {fabric}
                      </td>
                      {guide.widths.map((w) => {
                        const bag = bagByKey.get(`${fabric}|${w}`);
                        return (
                          <td key={w} className="px-3 py-2 text-center">
                            {bag ? (
                              <span
                                className={`inline-block min-w-[62px] rounded-sm px-2 py-1 text-xs font-semibold ring-1 ${bagStyle(bag)}`}
                              >
                                {shortBag(bag)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {visibleFabrics.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Ткань не найдена
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              Прочерк — для такой ширины эта ткань не выпускается.
            </p>
          </>
        )}
      </div>
    </CrmLayout>
  );
};

export default PackagingGuidePage;
