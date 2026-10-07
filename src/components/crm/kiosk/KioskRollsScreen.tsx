import { useEffect, useState } from 'react';
import { useGlobalScanner } from '@/hooks/useGlobalScanner';
import { useSubmitGuard } from '@/hooks/useSubmitGuard';
import { playScanSound } from '@/lib/scanSound';
import { useToast } from '@/hooks/use-toast';
import {
  fetchRolls,
  closeRoll,
  flagRollDefect,
  acceptRoll,
  PackerPiecesError,
  type Roll,
  type PackerPiece,
} from '@/lib/rollsApi';
import KioskPackerPiecesCard from '@/components/crm/kiosk/KioskPackerPiecesCard';
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
  packer_returns: ['Упаковка'],
};

/** Экран работы с рулонами на терминале: закройщик закрывает рулон, когда ткань
 * по факту закончилась, или отмечает бракованный рулон. Недостачу руками не вводит. */
const KioskRollsScreen = ({ workshopId, shiftNumber, userId, userName, role }: KioskRollsScreenProps) => {
  const { toast } = useToast();
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [types, setTypes] = useState<MaterialType[]>([]);
  const [typeFilter, setTypeFilter] = useState<number | 'all'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Roll | null>(null);
  // Отсканировали рулон, которого нет в смене — показываем номер прямо на экране,
  // чтобы закройщик мог продиктовать его кладовщику, не переспрашивая.
  const [notFound, setNotFound] = useState('');
  // Список рулонов — запасной путь, когда стикер порван или сканер не берёт.
  const [listOpen, setListOpen] = useState(false);
  const { busy: saving, run } = useSubmitGuard();
  /** Невыкроенные куски от упаковщицы: пока они есть, рулон закрыть нельзя. */
  const [packerBlock, setPackerBlock] = useState<{
    total: number;
    pieces: PackerPiece[];
    unit: string;
  } | null>(null);
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
      .catch(() => {
        // FRONTEND-ONLY: справочник типов не критичен для списка рулонов смены.
      });
    // Кружок загрузки снимаем по главному запросу экрана.
    // forUserId — сервер сам отдаёт рулоны ТОЛЬКО цеха и смены этого сотрудника.
    // Раньше запрашивался общий список и отсеивался уже в планшете: список
    // обрезался по общему лимиту, и часть своих рулонов до закройщика не доезжала,
    // зато мелькали чужие.
    fetchRolls({ status: 'in_workshop', usedSinceUserId: userId, forUserId: userId })
      .then((list) => {
        setListError(null);
        setRolls(list);
      })
      .catch((e) => {
        setListError(e instanceof Error ? e.message : 'Не удалось загрузить рулоны');
      })
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
  useGlobalScanner(handleScan, !loading && !selected && !saving && !listError);

  /**
   * Приёмка рулона сменой.
   *
   * Кладовщик отгрузил рулон в цех, но материал мог не доехать или приехать не тот.
   * Пока сотрудник не подтвердит, что рулон у него в руках, резать из него нельзя —
   * иначе цех расходует материал, которого физически нет, и расхождение всплывает
   * только на инвентаризации.
   */
  const handleAccept = (roll: Roll) => {
    void run(async () => {
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
      }
    });
  };

  const handleClose = () => {
    if (!selected) return;
    void run(async () => {
      try {
        // Недостачу не спрашиваем: рулон закрывают, когда он по факту кончился.
        // Сколько метров числилось в системе, сервер запишет сам.
        await closeRoll(selected.id, 0, userId, userName);
        toast({ title: 'Рулон закрыт' });
        setSelected(null);
        // Возвращаем на экран сканирования: следующий рулон закройщик тоже сканирует.
        setListOpen(false);
        load();
      } catch (e) {
        // В цехе лежит невыкроенный материал от упаковщицы — это не обычная ошибка,
        // а задача закройщице. Показываем крупной карточкой со списком кусков:
        // мелкую строку внизу экрана от станка не разглядеть.
        if (e instanceof PackerPiecesError) {
          setPackerBlock({ total: e.total, pieces: e.pieces, unit: e.unit });
          return;
        }
        toast({
          title: 'Не удалось закрыть рулон',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        });
      }
    });
  };

  // Брак в начале рулона (больше 10 пог.м): резать дальше нельзя. Рулон отставляем —
  // он остаётся в цехе, но в раскрой не идёт, а кладовщик заберёт его на склад.
  const handleFlagDefect = () => {
    if (!selected || !defectReason.trim()) return;
    void run(async () => {
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
      }
    });
  };


  // Куски от упаковщицы перекрывают любой экран: пока ткань не перекроена, рулон
  // закрыть нельзя, и закройщице надо увидеть список, что искать в цехе.
  const packerCard = packerBlock ? (
    <KioskPackerPiecesCard
      total={packerBlock.total}
      pieces={packerBlock.pieces}
      unit={packerBlock.unit}
      rollBarcode={selected?.barcode}
      materialName={selected?.materialName}
      onClose={() => setPackerBlock(null)}
    />
  ) : null;

  if (selected) {
    return (
      <>
        {packerCard}
        <KioskRollCloseCard
        selected={selected}
        saving={saving}
        onClose={handleClose}
        onCancel={() => {
          setSelected(null);
          setNotFound('');
        }}
        defectOpen={defectOpen}
        setDefectOpen={setDefectOpen}
        defectReason={defectReason}
        setDefectReason={setDefectReason}
          onFlagDefect={handleFlagDefect}
        />
      </>
    );
  }

  // Главный экран — приглашение отсканировать рулон. Список рулонов открывается
  // отдельной кнопкой: он нужен редко (порван стикер, сканер не читает), а когда он
  // был главным экраном, закройщик по привычке тыкал в номера и ошибался рулоном.
  if (!listOpen) {
    return (
      <KioskRollScanPrompt
        loading={loading}
        error={listError}
        onRetry={load}
        rollsCount={roleRolls.length}
        notFound={notFound}
        onOpenList={() => setListOpen(true)}
      />
    );
  }

  return (
    <KioskRollsList
      loading={loading}
      error={listError}
      onRetry={load}
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
