import { useEffect, useRef, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  SpareItemError,
  fetchKioskOrder,
  fetchTerminalSettings,
  type KioskOrder,
} from '@/lib/kioskApi';
import { playScanSound, playScanErrorSound } from '@/lib/scanSound';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { useGlobalScanner } from '@/hooks/useGlobalScanner';
import KioskScanPrompt from '@/components/crm/kiosk/KioskScanPrompt';
import KioskSpareItemCard from '@/components/crm/kiosk/KioskSpareItemCard';
import KioskOrderCard from '@/components/crm/kiosk/KioskOrderCard';
import KioskScannerInput from '@/components/crm/kiosk/KioskScannerInput';
import { useKioskOrderActions } from '@/components/crm/kiosk/useKioskOrderActions';

interface KioskOrdersScreenProps {
  packerId: number;
  packerName: string;
  workshopId?: number | null;
  role?: string | null;
}

/** Экран печати заказов: сотрудник сканирует QR с листка закройщика, видит данные товара,
 * печатает стикер и закрывает заказ. Сканируются только заказы на стикеровке — это
 * проверяет сервер. */
const KioskOrdersScreen = ({ packerId, packerName, workshopId, role }: KioskOrdersScreenProps) => {
  const { toast } = useToast();
  const [code, setCode] = useState('');
  const [searching, setSearching] = useState(false);
  const [order, setOrder] = useState<KioskOrder | null>(null);
  const [printed, setPrinted] = useState(false);
  // Внутренний стикер с номером нашего заказа кладётся ВНУТРЬ пакета. По нему при возврате
  // видно, кто шил именно эту штуку — на FBO маркетплейс такой информации не даёт.
  const [tracePrinted, setTracePrinted] = useState(false);
  const [closing, setClosing] = useState(false);
  // Маркетплейс ТОЧНО отказал в ярлыке (а не просто «отправление помечено уехавшим»).
  // Только после реальной попытки печати вещь уходит на хранение: раньше терминал решал
  // это заранее по статусу, и вещи многовещевых посылок нельзя было доложить в свою же
  // посылку, хотя ярлык на неё ещё выдавался.
  const [labelRefused, setLabelRefused] = useState(false);
  // Вещь по УЖЕ ЗАКРЫТОМУ заказу, оставшаяся на руках у упаковщицы: заказ закрыли вещью
  // с полки, а швея дошила свою. Покупателю она не поедет, но это готовый товар —
  // предлагаем сдать его на склад как свободный остаток, а не бросать в цехе.
  const [spare, setSpare] = useState<SpareItemError['order'] | null>(null);
  const [storingSpare, setStoringSpare] = useState(false);
  // Ручной поиск заказа — обход сканера, поэтому показываем его только если цех
  // это разрешил в настройках. По умолчанию скрыт: стикеруем строго по QR-коду.
  const [manualSearchAllowed, setManualSearchAllowed] = useState(false);
  // Попытка отсканировать новый заказ, не закрыв текущий: показываем крупное
  // предупреждение прямо на экране, а не только всплывашкой — её легко не заметить.
  const [blockedWarning, setBlockedWarning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [order]);

  const refocus = () => setTimeout(() => inputRef.current?.focus(), 0);

  // Экран после закрытия заказа: снимаем заказ и возвращаем фокус сканеру.
  const resetAfterClose = () => {
    setOrder(null);
    setPrinted(false);
    setTracePrinted(false);
    setBlockedWarning(false);
    refocus();
  };

  // Админу и старшему кладовщику ручной поиск доступен всегда, независимо от настройки
  // цеха: они подходят к терминалу именно тогда, когда обычный путь не сработал —
  // сканер не берёт стикер или вещь «зависла», и разобраться надо на месте.
  const privilegedSearch = role === 'admin' || role === 'senior_storekeeper';

  useEffect(() => {
    if (privilegedSearch) {
      setManualSearchAllowed(true);
      return;
    }
    fetchTerminalSettings(workshopId)
      .then((s) => setManualSearchAllowed(s.manualStickering))
      .catch(() => setManualSearchAllowed(false));
  }, [workshopId, privilegedSearch]);

  const handleSearch = async () => {
    const value = (inputRef.current?.value || code).trim();
    if (!value) return;
    setCode('');
    if (inputRef.current) inputRef.current.value = '';
    setSearching(true);
    setOrder(null);
    setPrinted(false);
    setTracePrinted(false);
    setLabelRefused(false);
    setSpare(null);
    setBlockedWarning(false);
    try {
      const found = await fetchKioskOrder(value);
      playScanSound();
      setOrder(found);
    } catch (e) {
      playScanErrorSound();
      // Заказ закрыт, но вещь у упаковщицы в руках — показываем, как её сдать на склад.
      if (e instanceof SpareItemError) {
        setSpare(e.order);
        toast({ title: 'Заказ уже закрыт', description: e.message });
        return;
      }
      toast({
        title: 'Заказ не найден',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSearching(false);
      refocus();
    }
  };

  useScannerAutoSubmit(code, handleSearch, !searching && !order, 400);

  // Подстраховка на случай, если скрытое поле потеряло фокус (всплывающее окно, касание
  // экрана, возврат планшета из сна). Тогда сканер печатает «мимо» поля, и терминал
  // молчит на скан. Здесь ловим ввод сканера на уровне страницы и ищем заказ так же,
  // как при обычном сканировании.
  useGlobalScanner(
    (scanned) => {
      if (inputRef.current) inputRef.current.value = scanned;
      handleSearch();
    },
    !searching && !order,
  );

  // Стикер напечатан, но заказ НЕ закрыт — работа не доделана.
  //
  // Упаковщица наклеила ярлык, положила вещь в пакет и потянулась за следующей: скан
  // нового кода при этом просто не срабатывал, терминал молчал. Она сканировала ещё
  // раз, ещё — и в итоге уходила, бросив незакрытый заказ. Такой заказ навсегда висит
  // в стикеровке: зарплата за него не начислена, вещь числится несобранной, а на
  // складе её уже нет.
  //
  // Теперь на скан отвечаем громко: звук ошибки и большое предупреждение. Новый заказ
  // не ищем, пока текущий не закрыт.
  const unfinished = !!order && printed && !closing;

  useGlobalScanner(() => {
    playScanErrorSound();
    setBlockedWarning(true);
    toast({
      title: 'Сначала закройте текущий заказ',
      description: 'Стикер напечатан, но заказ не завершён — нажмите «Закрыть заказ»',
      variant: 'destructive',
    });
  }, unfinished);

  const { handlePrint, handleClose, handleStoreSpare } = useKioskOrderActions({
    order,
    setOrder,
    printed,
    setPrinted,
    labelRefused,
    setLabelRefused,
    setClosing,
    spare,
    setSpare,
    setStoringSpare,
    packerId,
    packerName,
    toast,
    resetAfterClose,
    refocus,
  });

  return (
    <div className="space-y-6">
      {spare && !order && (
        <KioskSpareItemCard
          spare={spare}
          storingSpare={storingSpare}
          onStore={handleStoreSpare}
          onCancel={() => {
            setSpare(null);
            refocus();
          }}
        />
      )}

      {!order ? (
        <KioskScanPrompt
          searching={searching}
          manualSearchAllowed={manualSearchAllowed}
          workshopId={workshopId}
          role={role}
          onSelect={(found) => {
            setOrder(found);
            setPrinted(false);
          }}
        />
      ) : (
        <KioskOrderCard
          order={order}
          printed={printed}
          labelRefused={labelRefused}
          tracePrinted={tracePrinted}
          setTracePrinted={setTracePrinted}
          closing={closing}
          blockedWarning={blockedWarning}
          unfinished={unfinished}
          onPrint={handlePrint}
          onClose={handleClose}
          onCancel={() => {
            if (unfinished) {
              playScanErrorSound();
              setBlockedWarning(true);
              return;
            }
            resetAfterClose();
          }}
        />
      )}

      {/* Скрытое поле — сканер печатает в него незаметно для сотрудника. */}
      <KioskScannerInput
        ref={inputRef}
        code={code}
        setCode={setCode}
        unfinished={unfinished}
        onSearch={handleSearch}
        onBlocked={() => {
          setCode('');
          if (inputRef.current) inputRef.current.value = '';
          playScanErrorSound();
          setBlockedWarning(true);
        }}
        refocus={() => inputRef.current?.focus()}
      />
    </div>
  );
};

export default KioskOrdersScreen;
