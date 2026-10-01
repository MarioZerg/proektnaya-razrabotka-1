import type { Dispatch, SetStateAction } from 'react';
import Icon from '@/components/ui/icon';
import { AgentFace } from '@/components/crm/aiChat/ChatBubbles';

interface ChatGreetingProps {
  agentName: string;
  youName: string;
  greetingOpen: boolean;
  setGreetingOpen: Dispatch<SetStateAction<boolean>>;
}

/** Приветствие МЕГАБУХа в пустом чате: сворачиваемая подсказка, что он умеет. */
const ChatGreeting = ({ agentName, youName, greetingOpen, setGreetingOpen }: ChatGreetingProps) => (
  <div className="flex w-full items-start justify-start gap-2">
    <div className="mt-4">
      <AgentFace isAccountant size={32} />
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
          {youName ? `${youName}, это МЕГАБУХ.` : 'Это МЕГАБУХ.'} Пишите обычным языком — сверюсь
          с НК РФ, 402-ФЗ, ПБУ/ФСБУ, приказами Минфина и разъяснениями ФНС.
        </p>
        <span className="mt-2 flex items-center gap-1 text-[11px] text-teal-800">
          <Icon
            name="ChevronDown"
            size={14}
            className={`transition-transform duration-300 ${greetingOpen ? 'rotate-180' : ''}`}
          />
          {greetingOpen ? 'Свернуть' : 'Нажмите, чтобы прочитать'}
        </span>
        {greetingOpen ? (
          <div className="mt-2">
            <p className="font-medium">Что могу найти:</p>
            <ul className="mt-1.5 list-disc space-y-1.5 pl-4">
              <li>
                <strong>Бухучёт</strong> — УСН, НДС, взносы, НДФЛ, касса, первичная, ЭДО, договоры.
              </li>
              <li>
                <strong>Кадры для бухгалтерии</strong> — приём, отпуск, больничный, трудовой / ГПХ /
                самозанятый, ЕФС-1, РСВ, 6-НДФЛ.
              </li>
              <li>
                <strong>1С:Бухгалтерия 8.3</strong> (ред. 3.0, ПРОФ / КОРП / Фреш) и ЗУП — какой раздел
                открыть, как заполнить и отправить отчёт.
              </li>
              <li>
                <strong>СБИС, Диадок, Экстерн</strong> — УПД, подпись, роуминг, требование ФНС.
              </li>
              <li>
                <strong>Банк Точка</strong> — выписка в 1С, ДиректБанк, доступ бухгалтеру, тарифы, эквайринг,
                зарплатный проект.
              </li>
              <li>
                <strong>Маркетплейсы</strong> — закрывающие OZON, WB, Яндекс Маркет, комиссии, налог с
                продаж.
              </li>
            </ul>
            <p className="mt-2 font-medium">Как отвечаю:</p>
            <p className="mt-1">
              Суть → норма (статья / ПБУ) → проводки Дт/Кт → расчёт → первичка → сроки. Если закон
              изменился после даты сверки, в основном ответе беру только нормы до этой даты, а
              новшества пишу отдельно предупреждением.
            </p>
            <p className="mt-2 font-medium">Что спрашивать:</p>
            <ul className="mt-1.5 list-disc space-y-1.5 pl-4">
              <li>
                <strong>Разнести выписку</strong> — приложите файл: по каждой строке вид, контрагент,
                основание, категория, проводка Дт/Кт, первичка.
              </li>
              <li>
                <strong>Посчитать НДС</strong> — реализация, авансы, покупки, возвраты: формула, статьи
                НК, итог к уплате.
              </li>
              <li>
                <strong>Сверить отчётность</strong> — декларация НДС и ОСВ по 19, 60, 62, 90: расхождения
                и что запросить.
              </li>
            </ul>
            <p className="mt-2">
              Справочник контрагентов, номенклатуру и учётную политику тоже можно вложить — иначе
              счета не выдумываю. Спорное (взаимозачёт, цессия, курсовые, ошибки прошлых лет) не
              закрываю сам: «требуется согласование с главным бухгалтером/аудитором».
            </p>
            <p className="mt-2 font-medium">Документы:</p>
            <p className="mt-1">
              Скрепка или перетащите PDF, Word, Excel, CSV, фото. Два файла: «сопоставь оплаты из
              файла 1 с УПД из файла 2».
            </p>
          </div>
        ) : null}
      </button>
    </div>
  </div>
);

export default ChatGreeting;
