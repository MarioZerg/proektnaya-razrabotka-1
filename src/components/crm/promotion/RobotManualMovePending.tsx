import Icon from '@/components/ui/icon';

/**
 * Плашка «предыдущий подъём ещё отправляется».
 * Вынесена из RobotManualMove без изменений разметки.
 */
interface Props {
  pendingLeft: number;
  busy: boolean;
}

const RobotManualMovePending = ({ pendingLeft, busy }: Props) => (
  <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
    <Icon
      name="Loader2"
      size={16}
      className={`mt-0.5 shrink-0 text-amber-700 ${busy ? 'animate-spin' : ''}`}
    />
    <div>
      <p className="font-medium text-amber-900">
        Предыдущий подъём ещё отправляется: осталось {pendingLeft}
      </p>
      <p className="text-amber-800">
        Новый выбор начнётся, когда дойдут все карточки. Нажмите
        кнопку — досыл продолжится.
      </p>
    </div>
  </div>
);

export default RobotManualMovePending;
