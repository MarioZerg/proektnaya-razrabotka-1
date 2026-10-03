import type { Dispatch, SetStateAction } from 'react';
import Icon from '@/components/ui/icon';
import { AgentFace } from '@/components/crm/aiChat/ChatBubbles';

interface Props {
  agentName: string;
  youName: string;
  greetingOpen: boolean;
  setGreetingOpen: Dispatch<SetStateAction<boolean>>;
}

/** Короткое приветствие МЕГАМАГа: что умеет без портянки. */
const ShopChatGreeting = ({ agentName, youName, greetingOpen, setGreetingOpen }: Props) => (
  <div className="flex w-full items-start justify-start gap-2">
    <div className="mt-4">
      <AgentFace isAccountant={false} kind="shop" size={32} />
    </div>
    <div className="flex min-w-0 max-w-[92%] flex-col gap-0.5 sm:max-w-[86%]">
      <div className="flex items-baseline gap-1.5 px-0.5">
        <span className="text-[11px] font-medium text-muted-foreground">{agentName}</span>
      </div>
      <button
        type="button"
        onClick={() => setGreetingOpen((v) => !v)}
        aria-expanded={greetingOpen}
        title={greetingOpen ? 'Свернуть' : 'Нажмите, чтобы прочитать'}
        className={`rounded-2xl rounded-bl-md border border-border bg-background px-3 py-2.5 text-left text-[13px] leading-relaxed shadow-sm transition-shadow hover:shadow-md ${
          greetingOpen ? '' : 'animate-megabuh-bob'
        }`}
      >
        <p>
          {youName ? `${youName}, это МЕГАМАГ.` : 'Это МЕГАМАГ.'}{' '}
          Карточки, SEO и аналитика OZON / WB / Яндекс Маркет.
        </p>
        <span className="mt-2 flex items-center gap-1 text-[11px] text-amber-800">
          <Icon
            name="ChevronDown"
            size={14}
            className={`transition-transform duration-300 ${greetingOpen ? 'rotate-180' : ''}`}
          />
          {greetingOpen ? 'Свернуть' : 'Что умею'}
        </span>
        {greetingOpen ? (
          <ul className="mt-2 list-disc space-y-1 pl-4 text-[13px]">
            <li>Заголовки, описания, характеристики, фото</li>
            <li>Сравнение с конкурентами и УТП</li>
            <li>Разбор выгрузок: выкуп, остатки, маржа</li>
            <li>Кабинеты: модерация, SEO, реклама, отзывы</li>
            <li>Шторы/тюль: размеры, крепление, плотность</li>
          </ul>
        ) : null}
      </button>
    </div>
  </div>
);

export default ShopChatGreeting;
