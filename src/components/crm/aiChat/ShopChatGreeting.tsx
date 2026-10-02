import type { Dispatch, SetStateAction } from 'react';
import Icon from '@/components/ui/icon';
import { AgentFace } from '@/components/crm/aiChat/ChatBubbles';

interface Props {
  agentName: string;
  youName: string;
  greetingOpen: boolean;
  setGreetingOpen: Dispatch<SetStateAction<boolean>>;
}

/** Приветствие МЕГАМАГа: кабинет маркетплейсов, только чтение. */
const ShopChatGreeting = ({ agentName, youName, greetingOpen, setGreetingOpen }: Props) => (
  <div className="flex w-full items-start justify-start gap-2">
    <div className="mt-4">
      <AgentFace kind="shop" size={32} />
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
        <p className={greetingOpen ? undefined : 'line-clamp-2'}>
          {youName ? `${youName}, это МЕГАМАГ.` : 'Это МЕГАМАГ.'} Смотрю кабинеты OZON, Wildberries и
          Яндекс Маркета только на чтение — карточки, SEO, рекламу и что проседает.
        </p>
        <span className="mt-2 flex items-center gap-1 text-[11px] text-amber-800">
          <Icon
            name="ChevronDown"
            size={14}
            className={`transition-transform duration-300 ${greetingOpen ? 'rotate-180' : ''}`}
          />
          {greetingOpen ? 'Свернуть' : 'Нажмите, чтобы прочитать'}
        </span>
        {greetingOpen ? (
          <div className="mt-2">
            <p className="font-medium">Что смотрю:</p>
            <ul className="mt-1.5 list-disc space-y-1.5 pl-4">
              <li>
                <strong>Кабинеты</strong> — ключи из «Интеграции маркетплейсов», магазины МЕГАТЮЛЬ и
                ДЮНА по отдельности. Секреты в чат не вывожу.
              </li>
              <li>
                <strong>Карточка</strong> — по артикулу или названию читаю кабинет: заголовок,
                описание, фото, характеристики, ошибки модерации, рейтинг контента, остаток, цену,
                рекламу и отзывы. Ответ развёрнутый: вердикт SEO и что поправить руками.
              </li>
              <li>
                <strong>Витрина и SEO</strong> — короткие названия, мало фото, нет штрихкода, дыры в
                артикулах. Сверяюсь со справкой площадки, не с блогами.
              </li>
              <li>
                <strong>Реклама</strong> — ДРР, кампании WB, расход из нашей сверки. Если продвижение
                жрёт бюджет без продаж — скажу.
              </li>
              <li>
                <strong>Внимание</strong> — остаток 0 при рекламе, отзывы 1–3★, карточки без контента.
              </li>
            </ul>
            <p className="mt-2 font-medium">Чего не делаю:</p>
            <p className="mt-1">
              Ничего не меняю в кабинете: ставки, цены, тексты карточек. Дам, что поправить руками.
              Бухгалтерия — это МЕГАБУХ, не я.
            </p>
            <p className="mt-2 font-medium">Что спрашивать:</p>
            <ul className="mt-1.5 list-disc space-y-1.5 pl-4">
              <li>Разбери карточку артикула … на OZON</li>
              <li>Какие карточки на WB с плохим SEO?</li>
              <li>Где реклама работает вхолостую?</li>
              <li>Что требует внимания на этой неделе?</li>
            </ul>
          </div>
        ) : null}
      </button>
    </div>
  </div>
);

export default ShopChatGreeting;
