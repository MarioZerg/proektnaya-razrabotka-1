import { useEffect, useState } from 'react';
import { useGlobalScanner } from '@/hooks/useGlobalScanner';
import { playScanSound } from '@/lib/scanSound';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { fetchRolls, closeRoll, flagRollDefect, type Roll } from '@/lib/rollsApi';
import { Input } from '@/components/ui/input';
import KioskNumPad from '@/components/crm/kiosk/KioskNumPad';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { fetchMaterialsData, type Material, type MaterialType } from '@/lib/materialsApi';
import { formatQuantity } from '@/lib/formatQuantity';

interface KioskRollsScreenProps {
  workshopId: number;
  /** Смена сотрудника — показываем рулоны только его смены. */
  shiftNumber: number | null;
  /** Сотрудник терминала — по нему определяем движение материала в текущей смене. */
  userId: number;
  /** Имя закройщика — попадает в статистику недостач по рулонам. */
  userName?: string;
  /** Роль сотрудника — определяет, с рулонами какого типа он может работать. */
  role: string;
}

/** «1 рулон», «22 рулона», «5 рулонов» — иначе на экране висит «21 рулонов». */
const rollWord = (n: number) => {
  const last2 = n % 100;
  const last1 = n % 10;
  if (last2 >= 11 && last2 <= 14) return 'рулонов';
  if (last1 === 1) return 'рулон';
  if (last1 >= 2 && last1 <= 4) return 'рулона';
  return 'рулонов';
};

/** С какими типами материалов работает роль: закройщик — ткань (Тюль), швея — тесьма
 * (Аксессуары), упаковщица — пакеты и этикетки (Упаковка). */
const allowedTypesByRole: Record<string, string[]> = {
  cutter: ['Тюль'],
  sewer: ['Аксессуары'],
  packer: ['Упаковка'],
};

/** Экран работы с рулонами на терминале: закройщик закрывает рулоны, у которых закончился
 * метраж. Если ткань кончилась раньше — указывает недостачу цифровой клавиатурой. */
const KioskRollsScreen = ({ workshopId, shiftNumber, userId, userName, role }: KioskRollsScreenProps) => {
  const { toast } = useToast();
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [types, setTypes] = useState<MaterialType[]>([]);
  const [typeFilter, setTypeFilter] = useState<number | 'all'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Roll | null>(null);
  // Отсканировали рулон, которого нет в смене — показываем номер прямо на экране,
  // чтобы закройщик мог продиктовать его кладовщику, не переспрашивая.
  const [notFound, setNotFound] = useState('');
  // Список рулонов — запасной путь, когда стикер порван или сканер не берёт.
  const [listOpen, setListOpen] = useState(false);
  const [shortage, setShortage] = useState('');
  const [saving, setSaving] = useState(false);
  // Окно «отставить рулон»: брак в начале полотна, резать дальше нельзя.
  const [defectOpen, setDefectOpen] = useState(false);
  const [defectReason, setDefectReason] = useState('');

  const load = () => {
    setLoading(true);
    // Справочник материалов грузим отдельно: в цехе связь моргает, и раньше из-за одного
    // недошедшего запроса планшет показывал пустой экран вместо рулонов.
    fetchMaterialsData()
      .then((matData) => {
        setMaterials(matData.materials);
        setTypes(matData.types);
      })
      .catch(() => {});
    // Кружок загрузки снимаем по главному запросу экрана.
    // forUserId — сервер сам отдаёт рулоны ТОЛЬКО цеха и смены этого сотрудника.
    // Раньше запрашивался общий список и отсеивался уже в планшете: список
    // обрезался по общему лимиту, и часть своих рулонов до закройщика не доезжала,
    // зато мелькали чужие.
    fetchRolls({ status: 'in_workshop', usedSinceUserId: userId, forUserId: userId })
      .then(setRolls)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workshopId, shiftNumber, userId]);

  const typeIdByMaterial = new Map(materials.map((m) => [m.id, m.typeId]));
  // Роль работает только со «своими» типами материалов (закройщик — ткань, швея — тесьма,
  // упаковщица — упаковка). Остальным ролям показываем всё.
  const allowedNames = allowedTypesByRole[role];
  const visibleTypes = allowedNames ? types.filter((t) => allowedNames.includes(t.name)) : types;
  const allowedTypeIds = new Set(visibleTypes.map((t) => t.id));

  const roleRolls = allowedNames
    ? rolls.filter((r) => {
        const tid = typeIdByMaterial.get(r.materialId);
        return tid != null && allowedTypeIds.has(tid);
      })
    : rolls;

  const byType =
    typeFilter === 'all'
      ? roleRolls
      : roleRolls.filter((r) => typeIdByMaterial.get(r.materialId) === typeFilter);

  // Поиск по номеру и названию материала: в смене бывает несколько десятков рулонов,
  // и пролистывать их на планшете долго.
  const query = search.trim().toLowerCase();
  const visibleRolls = query
    ? byType.filter(
        (r) =>
          r.barcode.toLowerCase().includes(query) ||
          (r.materialName || '').toLowerCase().includes(query)
      )
    : byType;

  // Скан рулона — основной путь на терминале. Закройщик подносит сканер к стикеру на
  // рулоне, и нужный рулон открывается сразу. Раньше он искал его глазами в списке из
  // семи десятков рулонов смены: долго и легко ткнуть в соседний номер, а списание
  // тогда уходит не с того рулона.
  //
  // Ищем среди рулонов СВОЕЙ смены: сервер уже отдал только их, поэтому чужой рулон
  // сюда не попадёт даже случайным сканом.
  const handleScan = (raw: string) => {
    // Сканер может отдать код с префиксом из ссылки или лишними пробелами.
    const code = raw.trim().replace(/^.*[=/]/, '');
    if (!code) return;
    const found =
      roleRolls.find((r) => r.barcode.toLowerCase() === code.toLowerCase()) ||
      roleRolls.find((r) => r.barcode.toLowerCase().endsWith(code.toLowerCase()));

    if (!found) {
      // Не молчим: рулон могли не отгрузить в цех или он из чужой смены.
      setNotFound(code);
      toast({
        title: `Рулон #${code} не найден`,
        description: 'Его нет в вашей смене. Проверьте стикер или спросите кладовщика',
        variant: 'destructive',
      });
      return;
    }
    if (found.defectFlaggedAt) {
      toast({
        title: `Рулон #${found.barcode} отставлен как бракованный`,
        description: 'Резать его нельзя — он ждёт кладовщика',
        variant: 'destructive',
      });
      return;
    }
    if (found.pendingAcceptance) {
      toast({
        title: `Рулон #${found.barcode} ещё не принят`,
        description: 'Подтвердите поставку в цех, потом работайте с рулоном',
        variant: 'destructive',
      });
      return;
    }
    playScanSound();
    setNotFound('');
    setSelected(found);
  };

  // Ловим сканер на уровне всей страницы: поля с фокусом на этом экране нет, а на
  // планшете фокус легко теряется от случайного касания.
  useGlobalScanner(handleScan, !loading && !selected && !saving);

  const handleClose = async (withShortage: boolean) => {
    if (!selected) return;
    setSaving(true);
    try {
      await closeRoll(selected.id, withShortage ? Number(shortage) || 0 : 0, userId, userName);
      toast({
        title: 'Рулон закрыт',
        description: withShortage && Number(shortage) > 0 ? `Недостача: ${shortage} ${selected.unit}` : undefined,
      });
      setSelected(null);
      setShortage('');
      // Возвращаем на экран сканирования: следующий рулон закройщик тоже сканирует.
      setListOpen(false);
      load();
    } catch (e) {
      toast({
        title: 'Не удалось закрыть рулон',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  // Брак в начале рулона (больше 10 пог.м): резать дальше нельзя. Рулон отставляем —
  // он остаётся в цехе, но в раскрой не идёт, а кладовщик заберёт его на склад.
  const handleFlagDefect = async () => {
    if (!selected || !defectReason.trim()) return;
    setSaving(true);
    try {
      await flagRollDefect(selected.id, defectReason.trim(), userId, userName);
      toast({
        title: `Рулон #${selected.barcode} отставлен`,
        description: 'Резать его нельзя. Кладовщик заберёт рулон на склад — сообщите руководителю',
      });
      setDefectOpen(false);
      setDefectReason('');
      setSelected(null);
      setListOpen(false);
      load();
    } catch (e) {
      toast({
        title: 'Не удалось отметить рулон',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };


  if (selected) {
    return (
      <Card className="border-border shadow-none">
        <CardContent className="space-y-4 pt-6">
          <div className="text-center">
            <p className="text-lg text-muted-foreground">Рулон</p>
            <p className="font-mono-tech text-2xl font-bold">#{selected.barcode}</p>
            <p className="mt-1 text-lg">
              {selected.materialName} · остаток {formatQuantity(selected.remainingQuantity)}{' '}
              {selected.unit}
            </p>
          </div>

          {/* Остаток крупно и рядом с полем ввода: закройщик указывает недостачу,
              глядя на то, сколько метров числится на рулоне. Раньше остаток был
              мелкой строкой в шапке, и в поле улетали цифры вроде 90 м при остатке 5. */}
          <div className="rounded-md border-2 border-border bg-muted/40 p-3 text-center">
            <p className="text-sm text-muted-foreground">По системе на рулоне осталось</p>
            <p className="font-mono-tech text-3xl font-bold">
              {formatQuantity(selected.remainingQuantity)} {selected.unit}
            </p>
          </div>

          <div className="rounded-md border border-border p-3 text-center">
            <p className="text-sm text-muted-foreground">Недостача (если ткань закончилась раньше)</p>
            <p className="font-mono-tech text-3xl font-bold">{shortage || '0'}</p>
            {/* Больше остатка списать нельзя — предупреждаем сразу, до нажатия кнопки. */}
            {Number(shortage) > Number(selected.remainingQuantity || 0) && (
              <p className="mt-1 text-sm font-semibold text-destructive">
                Больше, чем осталось на рулоне — проверьте цифру
              </p>
            )}
          </div>

          <KioskNumPad value={shortage} onChange={setShortage} />

          <Button
            size="lg"
            className="h-16 w-full bg-emerald-600 text-lg text-white hover:bg-emerald-700"
            onClick={() => handleClose(true)}
            disabled={saving}
          >
            <Icon
              name={saving ? 'Loader2' : 'Check'}
              size={24}
              className={`mr-2 ${saving ? 'animate-spin' : ''}`}
            />
            Закрыть рулон
          </Button>
          {/* Брак в начале полотна: рулон отставляем целиком, а не режем дальше. */}
          <Button
            variant="outline"
            size="lg"
            className="h-14 w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setDefectOpen(true)}
            disabled={saving}
          >
            <Icon name="PackageX" size={22} className="mr-2" />
            Бракованный рулон
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="h-14 w-full"
            onClick={() => {
              setSelected(null);
              setShortage('');
              setNotFound('');
            }}
          >
            Отмена
          </Button>

          <Dialog open={defectOpen} onOpenChange={setDefectOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Отставить рулон #{selected.barcode}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className="text-base text-muted-foreground">
                  Рулон перестанет идти в раскрой и будет ждать, пока кладовщик заберёт его
                  на склад. Обязательно сообщите руководителю
                </p>
                {/* Причина — кнопками: закройщик стоит у станка и работает пальцами,
                    клавиатуры в цехе нет. Можно отметить несколько дефектов сразу. */}
                <div className="grid grid-cols-2 gap-2">
                  {['Дырки', 'Затяжки', 'Полосы', 'Пятна', 'Кривая кромка', 'Разнотон', 'Рвётся', 'Не тот метраж'].map(
                    (label) => {
                      const chosen = defectReason.split(', ').filter(Boolean);
                      const active = chosen.includes(label);
                      return (
                        <Button
                          key={label}
                          type="button"
                          variant={active ? 'default' : 'outline'}
                          className="h-14 text-base"
                          onClick={() =>
                            setDefectReason(
                              (active
                                ? chosen.filter((c) => c !== label)
                                : [...chosen, label]
                              ).join(', ')
                            )
                          }
                        >
                          {active && <Icon name="Check" size={18} className="mr-1.5" />}
                          {label}
                        </Button>
                      );
                    }
                  )}
                </div>
                <Button
                  size="lg"
                  className="h-14 w-full"
                  onClick={handleFlagDefect}
                  disabled={saving || !defectReason.trim()}
                >
                  {saving ? (
                    <Icon name="Loader2" size={22} className="animate-spin" />
                  ) : (
                    'Отставить рулон'
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    );
  }

  // Главный экран — приглашение отсканировать рулон. Список рулонов открывается
  // отдельной кнопкой: он нужен редко (порван стикер, сканер не читает), а когда он
  // был главным экраном, закройщик по привычке тыкал в номера и ошибался рулоном.
  if (!listOpen) {
    return (
      <div className="space-y-4">
        <Card className="border-2 border-dashed border-primary/40 shadow-none">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="rounded-full bg-primary/10 p-6">
              <Icon name="ScanLine" size={64} className="text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">Отсканируйте рулон</p>
              <p className="mt-1 text-lg text-muted-foreground">
                Поднесите сканер к стикеру на рулоне
              </p>
            </div>
            {loading && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Icon name="Loader2" size={20} className="animate-spin" />
                Загружаю рулоны смены…
              </div>
            )}
            {!loading && (
              <p className="text-base text-muted-foreground">
                В вашей смене {roleRolls.length} {rollWord(roleRolls.length)}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Промах сканера показываем крупно: номер видно с расстояния вытянутой руки. */}
        {notFound && (
          <Card className="border-destructive bg-destructive/5 shadow-none">
            <CardContent className="flex items-start gap-3 py-4">
              <Icon name="TriangleAlert" size={24} className="mt-0.5 shrink-0 text-destructive" />
              <div>
                <p className="font-bold text-destructive">Рулон #{notFound} не найден</p>
                <p className="text-base text-muted-foreground">
                  Его нет в вашей смене. Проверьте стикер или назовите номер кладовщику
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <Button
          variant="outline"
          size="lg"
          className="h-14 w-full text-base"
          onClick={() => setListOpen(true)}
        >
          <Icon name="List" size={22} className="mr-2" />
          Стикер не читается — выбрать из списка
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Возврат к сканированию: основной режим работы. */}
      <Button
        variant="outline"
        size="lg"
        className="h-12 w-full text-base"
        onClick={() => {
          setListOpen(false);
          setSearch('');
        }}
      >
        <Icon name="ScanLine" size={20} className="mr-2" />
        Вернуться к сканированию
      </Button>

      {/* Фильтр по типу материала: Ткань (Тюль), Аксессуары, Упаковка */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={typeFilter === 'all' ? 'default' : 'outline'}
          className="h-12 text-base"
          onClick={() => setTypeFilter('all')}
        >
          Все
        </Button>
        {visibleTypes.map((t) => (
          <Button
            key={t.id}
            variant={typeFilter === t.id ? 'default' : 'outline'}
            className="h-12 text-base"
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
        className="h-12 text-base"
      />

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
          <Icon name="Loader2" size={24} className="animate-spin" />
          Загрузка…
        </div>
      ) : visibleRolls.length === 0 ? (
        <p className="py-10 text-center text-lg text-muted-foreground">
          {search.trim()
            ? 'Рулон не найден — проверьте номер'
            : 'В вашей смене нет открытых рулонов'}
        </p>
      ) : (
        visibleRolls.map((r) => {
          // Рулон закрывается вручную: закройщик сам выбирает его из списка своей смены,
          // сканер не нужен. Раньше рулон открывался только после движения материала в
          // смене — но закончившийся рулон, по которому в эту смену ещё не резали,
          // из-за этого закрыть было нельзя.
          //
          // Остаются два запрета: непринятый материал (мог не доехать) и отставленный
          // из-за брака рулон (он ждёт кладовщика).
          const active = !r.pendingAcceptance && !r.defectFlaggedAt;
          return (
            <button
              key={r.id}
              onClick={() => active && setSelected(r)}
              disabled={!active}
              className={`flex w-full items-center justify-between gap-3 rounded-lg border border-border p-4 text-left ${
                active ? 'hover:bg-accent' : 'cursor-not-allowed opacity-40 grayscale'
              }`}
            >
              <div className="min-w-0">
                <div className="font-mono-tech text-lg font-bold">#{r.barcode}</div>
                <div className="text-muted-foreground">{r.materialName}</div>
                {r.foreignShift && (
                  <div className="text-xs font-medium text-amber-600">
                    Материал чужой смены
                  </div>
                )}
                {r.defectFlaggedAt ? (
                  <div className="text-xs font-medium text-destructive">
                    Отставлен как бракованный — ждёт кладовщика
                  </div>
                ) : r.pendingAcceptance ? (
                  <div className="text-xs font-medium text-amber-600">
                    Не принят — подтвердите поставку
                  </div>
                ) : (
                  r.usedInShift && (
                    <div className="text-xs text-emerald-600">Резали в эту смену</div>
                  )
                )}
              </div>
              <Badge variant="secondary" className="shrink-0 text-base">
                {formatQuantity(r.remainingQuantity)} {r.unit}
              </Badge>
            </button>
          );
        })
      )}
    </div>
  );
};

export default KioskRollsScreen;