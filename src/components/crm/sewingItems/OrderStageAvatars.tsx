import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Order } from '@/lib/ordersApi';
import {
  isOnOverlock,
  orderCutterName,
  orderCutterUserId,
  shortFio,
} from '@/components/crm/sewingItems/sewingItemsShared';
import { initials } from '@/components/crm/users/usersShared';

export interface StagePerson {
  key: string;
  label: string;
  name: string;
  userId: number | null;
  avatarUrl: string | null;
  current: boolean;
}

/** Кто уже взял или закрыл этап: кроивший, швея, упаковщица. Без пустых ролей. */
export const orderStagePeople = (order: Order): StagePerson[] => {
  const cuttingNow = order.sewingStatus === 'На раскрое';
  const sewingNow = order.sewingStatus === 'В работе' || isOnOverlock(order);
  const packingNow = order.sewingStatus === 'Стикеровка';
  const cutterDone = orderCutterName(order);
  const sewerDone = order.sewerUserName;
  const packerDone = order.packerUserName;

  const people: StagePerson[] = [];
  const push = (person: StagePerson) => {
    if (!person.name) return;
    if (person.userId != null && people.some((p) => p.userId === person.userId)) return;
    people.push(person);
  };

  push({
    key: 'cutter',
    label: 'Кроил',
    name: cutterDone || (cuttingNow ? order.assignedUserName : null) || '',
    userId: orderCutterUserId(order) || (cuttingNow ? order.assignedUserId : null),
    avatarUrl:
      order.cutterAvatarUrl || (cuttingNow ? order.assignedAvatarUrl : null) || null,
    current: cuttingNow && !cutterDone,
  });
  push({
    key: 'sewer',
    label: sewingNow && isOnOverlock(order) ? 'Оверлок' : 'Сшил',
    name:
      sewerDone ||
      (sewingNow ? order.assignedUserName || order.overlockUserName || null : null) ||
      '',
    userId:
      order.sewerUserId ||
      (sewingNow ? order.assignedUserId || order.overlockUserId || null : null),
    avatarUrl:
      order.sewerAvatarUrl ||
      (sewingNow ? order.assignedAvatarUrl || order.overlockAvatarUrl : null) ||
      null,
    current: sewingNow && !sewerDone,
  });
  push({
    key: 'packer',
    label: 'Упаковал',
    name: packerDone || (packingNow ? order.assignedUserName : null) || '',
    userId: order.packerUserId || (packingNow ? order.assignedUserId : null),
    avatarUrl:
      order.packerAvatarUrl || (packingNow ? order.assignedAvatarUrl : null) || null,
    current: packingNow && !packerDone,
  });

  return people;
};

/** Стопка кружков: каждый следующий этап слегка наезжает на предыдущий. */
const OrderStageAvatars = ({ order }: { order: Order }) => {
  const people = orderStagePeople(order);
  if (people.length === 0) return null;

  return (
    <div className="flex items-center">
      {people.map((person, i) => (
        <Tooltip key={person.key}>
          <TooltipTrigger asChild>
            <span
              className={`relative inline-flex ${i > 0 ? '-ml-2' : ''}`}
              style={{ zIndex: i + 1 }}
            >
              <Avatar
                className={`h-7 w-7 ring-2 ring-white sm:h-8 sm:w-8 ${
                  person.current ? 'ring-sky-400' : ''
                }`}
              >
                {person.avatarUrl && (
                  <AvatarImage src={person.avatarUrl} alt={person.name} />
                )}
                <AvatarFallback className="bg-slate-200 text-[9px] font-bold text-slate-700 sm:text-[10px]">
                  {initials(person.name)}
                </AvatarFallback>
              </Avatar>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {person.label}: {shortFio(person.name)}
            {person.current ? ' · сейчас' : ''}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
};

export default OrderStageAvatars;
