import { useState } from 'react';
import type { KioskUser, KioskShift } from '@/lib/kioskApi';
import {
  openShift,
  closeShift,
  checkShiftDefects,
  switchShiftRole,
  type DefectCheck,
} from '@/lib/shiftSessionsApi';
import { playScanErrorSound, playShiftOpenSound, playShiftCloseSound } from '@/lib/scanSound';
import { type KioskScreen } from '@/components/crm/kiosk/KioskMenu';
import { fetchMySalary } from '@/lib/salaryApi';
import { moscowYmd } from '@/lib/dateUtils';
import { groupAccrualsByDay, type WorkedDay } from '@/components/crm/finance/workedDay';

type Toast = (opts: {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}) => void;

interface Params {
  user: KioskUser | null;
  shift?: KioskShift | null;
  workshopId: string | undefined;
  isPreview: boolean;
  setShift: (s: KioskShift | null) => void;
  setDefectCheck: (c: DefectCheck | null) => void;
  setCloseBlocked: (v: string) => void;
  setLateInfo: (v: { minutes: number; penalty: number; start: string | null } | null) => void;
  setEnteredMenu: (v: boolean) => void;
  setScreen: (s: KioskScreen) => void;
  toast: Toast;
  /** Плашка отработанного дня после закрытия смены. */
  onClosedDay?: (day: WorkedDay) => void;
}

/**
 * Открытие и закрытие смены прямо на терминале.
 *
 * Смена — не формальность: пока она не открыта, работать нельзя, иначе заказы и
 * брак попадут в систему без привязки к смене и по ним не начислится зарплата.
 * Поэтому здесь же живут опоздание, напоминание про брак и запрет закрыть смену
 * с незавершёнными заказами.
 */
export const useKioskShift = ({
  user,
  shift,
  workshopId,
  isPreview,
  setShift,
  setDefectCheck,
  setCloseBlocked,
  setLateInfo,
  setEnteredMenu,
  setScreen,
  toast,
  onClosedDay,
}: Params) => {
  const [shiftSaving, setShiftSaving] = useState(false);

  // Открытие/закрытие смены прямо на терминале. Цех и смену сотрудник выбирает на экране
  // входа: производственные роли работают гибко и могут выйти в чужой цех как гости.
  // По умолчанию подставлен цех этого терминала, поэтому в обычный день выбирать нечего.
  const handleOpenShift = async (
    chosenWorkshopId: number | null,
    chosenShiftNumber: number | null,
    // Должность на эту смену. Многие в цехе совмещают: числится закройщиком, а
    // сегодня шьёт. От должности зависит, какой материал покажет терминал — ткань
    // или тесьму, — поэтому она фиксируется в смене, а не берётся из карточки.
    chosenRole?: string | null
  ) => {
    if (!user) return;
    // В режиме проверки смену не открываем: админ смотрит терминал, а не работает за него.
    if (isPreview) {
      toast({ title: 'Режим проверки', description: 'Смена не открывается — это только просмотр' });
      return;
    }
    setShiftSaving(true);
    try {
      const res = await openShift(
        user.id,
        // Number('') даёт NaN, а не null: без явной проверки в смену уходил бы
        // битый номер цеха, и смена открывалась бы «в никуда».
        chosenWorkshopId ?? (Number.isFinite(Number(workshopId)) ? Number(workshopId) : null),
        chosenShiftNumber ?? user.shiftFromCode ?? null,
        false,
        chosenRole ?? null
      );
      playShiftOpenSound();
      setShift({
        isOpen: true,
        openedAt: res.openedAt,
        workshopId: res.workshopId,
        shiftNumber: res.shiftNumber,
        // Время закрытия приходит сразу при открытии — сотрудник видит его на экране.
        canCloseAt: res.canCloseAt ?? null,
        // Должность ЭТОЙ смены. По ней экраны рулонов и брака подбирают материал:
        // закройщику ткань, швее тесьму. Без неё терминал до перезахода работал бы
        // по должности из карточки, и швея снова не увидела бы тесьму.
        role: chosenRole ?? user.role,
      });
      if (res.isLate && (res.lateMinutes ?? 0) > 0) {
        setLateInfo({
          minutes: res.lateMinutes ?? 0,
          penalty: res.penaltyAmount ?? 0,
          start: res.shiftStart ?? null,
        });
      } else {
        toast({
          title: 'Смена открыта',
          description: `Смена №${res.shiftNumber ?? '—'}`,
        });
      }
    } catch (e) {
      playScanErrorSound();
      toast({
        title: 'Не удалось открыть смену',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setShiftSaving(false);
    }
  };

  const handleCloseShift = async () => {
    if (!user) return;
    setDefectCheck(null);
    if (isPreview) {
      toast({ title: 'Режим проверки', description: 'Смена не закрывается — это только просмотр' });
      return;
    }
    setShiftSaving(true);
    try {
      await closeShift(user.id);
      playShiftCloseSound();
      setShift({ isOpen: false, openedAt: null, workshopId: null, shiftNumber: null, canCloseAt: null });
      // Смена закрыта — возвращаем сотрудника на стартовый экран терминала.
      setEnteredMenu(false);
      setScreen('menu');

      // Плашка дня: заказы строками, метраж, вычеты и надбавки — одна карточка,
      // а не тост «смена закрыта» без цифр. Берём сегодня и вчера: смена,
      // закрытая после полуночи, относится к вчерашнему календарному дню.
      try {
        const data = await fetchMySalary(user.id, {
          dateFrom: moscowYmd(-1),
          dateTo: moscowYmd(0),
        });
        const days = groupAccrualsByDay(data.accruals);
        const today = moscowYmd(0);
        const day = days.find((d) => d.date === today) || days[0];
        if (day) {
          onClosedDay?.(day);
        } else {
          toast({ title: 'Смена закрыта' });
        }
      } catch {
        toast({ title: 'Смена закрыта' });
      }
    } catch (e) {
      playScanErrorSound();
      const message = e instanceof Error ? e.message : 'Попробуйте ещё раз';
      if (message.includes('заказ')) {
        setCloseBlocked(message);
      } else {
        toast({ title: 'Не удалось закрыть смену', description: message, variant: 'destructive' });
      }
    } finally {
      setShiftSaving(false);
    }
  };

  // Переключение должности посреди дня (швея ↔ закройщик и т.п.). Работа в прежней
  // должности закрывается на сервере, и сразу открывается смена в новой — терминал
  // перестраивает плитки и материалы под новую роль без повторного скана бейджа.
  const handleSwitchRole = async (role: string) => {
    if (!user || !shift?.isOpen) return;
    const current = shift.role || user.role;
    if (role === current) return;
    if (isPreview) {
      setShift({ ...shift, role });
      setScreen('menu');
      return;
    }
    setShiftSaving(true);
    try {
      const res = await switchShiftRole(user.id, role);
      setShift({
        isOpen: true,
        openedAt: res.openedAt,
        workshopId: res.workshopId,
        shiftNumber: res.shiftNumber,
        canCloseAt: res.canCloseAt ?? null,
        role: res.role,
      });
      setScreen('menu');
      playShiftOpenSound();
      toast({ title: 'Должность переключена', description: 'Работа в прежней должности закрыта' });
    } catch (e) {
      playScanErrorSound();
      const message = e instanceof Error ? e.message : 'Попробуйте ещё раз';
      if (message.includes('заказ')) {
        setCloseBlocked(message);
      } else {
        toast({ title: 'Не удалось переключить должность', description: message, variant: 'destructive' });
      }
    } finally {
      setShiftSaving(false);
    }
  };

  // Перед закрытием смены напоминаем про брак: если сотрудник за смену не оформил ни одной
  // записи, скорее всего он про это забыл. Спрашиваем один раз — закрыть смену не мешаем.
  const handleCloseShiftClick = async () => {
    if (!user || isPreview) {
      handleCloseShift();
      return;
    }
    const check = await checkShiftDefects(user.id).catch(() => null);
    if (check) {
      setDefectCheck(check);
      return;
    }
    handleCloseShift();
  };

  return { shiftSaving, handleOpenShift, handleCloseShift, handleCloseShiftClick, handleSwitchRole };
};
