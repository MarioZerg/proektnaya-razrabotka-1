import { useEffect, useState } from 'react';
import { useGlobalScanner } from '@/hooks/useGlobalScanner';
import { playScanSound } from '@/lib/scanSound';
import { useToast } from '@/hooks/use-toast';
import { fetchRolls, closeRoll, flagRollDefect, acceptRoll, type Roll } from '@/lib/rollsApi';
import KioskRollCloseCard from '@/components/crm/kiosk/KioskRollCloseCard';
import KioskRollScanPrompt from '@/components/crm/kiosk/KioskRollScanPrompt';
import KioskRollsList from '@/components/crm/kiosk/KioskRollsList';
import { fetchMaterialsData, type Material, type MaterialType } from '@/lib/materialsApi';

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

  /**
   * Приёмка рулона сменой.
   *
   * Кладовщик отгрузил рулон в цех, но материал мог не доехать или приехать не тот.
   * Пока сотрудник не подтвердит, что рулон у него в руках, резать из него нельзя —
   * иначе цех расходует материал, которого физически нет, и расхождение всплывает
   * только на инвентаризации.
   */
  const handleAccept = async (roll: Roll) => {
    setSaving(true);
    try {
      await acceptRoll(roll.id, userId, userName);
      toast({ title: `Рулон #${roll.barcode} принят`, description: 'Можно работать' });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось принять рулон',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

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


  // Сколько метров МОГЛО не хватить: всё, что было в рулоне, минус то, что уже ушло
  // в сшитые вещи. Больше этого числа недостача физически невозможна — эти метры
  // система видела в заказах. Сервер проверяет то же самое, здесь — чтобы человек
  // увидел ошибку до нажатия кнопки, а не получил отказ после.
  const maxPossibleShortage =
    selected && selected.usedQuantity != null && selected.initialQuantity > 0
      ? Math.max(0, selected.initialQuantity - selected.usedQuantity)
      : null;

  // Заявленная недостача невозможна — кнопку закрытия гасим. Иначе человек жмёт её,
  // ждёт и получает отказ от сервера, не понимая, что исправлять.
  const shortageTooBig =
    !!selected &&
    (Number(shortage) > Number(selected.remainingQuantity || 0) ||
      (maxPossibleShortage != null && Number(shortage) > maxPossibleShortage));

  if (selected) {
    return (
      <KioskRollCloseCard
        selected={selected}
        shortage={shortage}
        setShortage={setShortage}
        saving={saving}
        maxPossibleShortage={maxPossibleShortage}
        shortageTooBig={shortageTooBig}
        onClose={handleClose}
        onCancel={() => {
          setSelected(null);
          setShortage('');
          setNotFound('');
        }}
        defectOpen={defectOpen}
        setDefectOpen={setDefectOpen}
        defectReason={defectReason}
        setDefectReason={setDefectReason}
        onFlagDefect={handleFlagDefect}
      />
    );
  }

  // Главный экран — приглашение отсканировать рулон. Список рулонов открывается
  // отдельной кнопкой: он нужен редко (порван стикер, сканер не читает), а когда он
  // был главным экраном, закройщик по привычке тыкал в номера и ошибался рулоном.
  if (!listOpen) {
    return (
      <KioskRollScanPrompt
        loading={loading}
        rollsCount={roleRolls.length}
        notFound={notFound}
        onOpenList={() => setListOpen(true)}
      />
    );
  }

  return (
    <KioskRollsList
      loading={loading}
      visibleTypes={visibleTypes}
      typeFilter={typeFilter}
      setTypeFilter={setTypeFilter}
      search={search}
      setSearch={setSearch}
      visibleRolls={visibleRolls}
      onSelect={setSelected}
      onAccept={handleAccept}
      onBackToScan={() => {
        setListOpen(false);
        setSearch('');
      }}
    />
  );
};

export default KioskRollsScreen;
