import { useEffect } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import Icon from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/context/AuthContext';

/**
 * Материалы по обращению Новиковой А.А. в прокуратуру Дзержинского района г. Ярославля
 * (требование от 17.09.2026 № 202-4260-2026/20780003/Исорг714-26).
 *
 * Раздел закрыт наглухо: только администратор и только по прямой ссылке. В меню его нет,
 * от поисковиков закрыт и в robots.txt, и мета-тегом noindex прямо на странице — здесь
 * персональные данные человека, суммы переводов и позиция ИП по проверке. Такое не должно
 * попасть ни в выдачу, ни на глаза сотрудникам.
 *
 * Страница — не «красивая витрина», а рабочий комплект к визиту в прокуратуру: готовые
 * пояснения одним PDF, платёжные квитанции и короткая хронология, чтобы перед приёмом
 * можно было освежить факты и даты.
 */

const PAYMENTS = [
  { n: 1, date: '24.06.2026 16:43', sum: '18 000 ₽', receipt: '1-119-358-786-090', file: '/docs/prosecutor/chek-2.pdf' },
  { n: 2, date: '10.07.2026 11:27', sum: '14 000 ₽', receipt: '1-129-205-217-320', file: '/docs/prosecutor/chek-3.pdf' },
  { n: 3, date: '25.07.2026 21:15', sum: '10 000 ₽', receipt: '1-130-219-126-443', file: '/docs/prosecutor/chek-4.pdf' },
  { n: 4, date: '29.07.2026 23:46', sum: '6 000 ₽', receipt: '1-103-416-088-378', file: '/docs/prosecutor/chek-5.pdf' },
];

/**
 * Хронология по двум периодам. Разделение принципиально: квитанции, которые ИП
 * представляет в прокуратуру, закрывают ПЕРВЫЙ период, а спор идёт про второй.
 */
const TIMELINE = [
  {
    date: 'Период I · июнь — 29.07.2026',
    text: 'Новикова А.А. фактически выполняет работу. Документы, удостоверяющие личность (паспорт, ИНН, СНИЛС), не представляет, договор не подписывает. Зарегистрироваться в системе учёта (вход через MAX) отказывается: «устанавливать MAX не буду».',
    tone: 'warn',
  },
  {
    date: '24.06 — 29.07.2026',
    text: 'Четыре перевода по СБП на общую сумму 48 000 ₽ за фактически выполненную работу. Последний платёж 29.07.2026 — 6 000 ₽. Все операции успешны, квитанции сохранены. Претензий по оплате не заявлялось.',
    tone: 'ok',
  },
  {
    date: 'После выплат',
    text: 'Чеки из приложения «Мой налог» за полученные деньги не сформированы и не переданы. Отчётных документов по НПД нет.',
    tone: 'warn',
  },
  {
    date: 'Перерыв · конец июля — середина августа',
    text: 'Сотрудничество прекращено. Инцидент с повреждением складских помещений: привлечение новых исполнителей приостановлено, договорные отношения с Новиковой А.А. не заключались.',
    tone: 'info',
  },
  {
    date: 'Период II · 17.08.2026, понедельник',
    text: 'Новикова А.А. сама обращается с вопросом о свободной вакансии и по приглашению выходит на работу. Условия согласованы заранее: 2 000 ₽ за смену при обязательном подписании договора ГПХ.',
    tone: 'info',
  },
  {
    date: '17.08 — 21.08.2026',
    text: 'В течение всей рабочей недели — неоднократные предложения подписать договор, включая договор стажировки. Внятного ответа нет.',
    tone: 'warn',
  },
  {
    date: 'Пятница, 21.08.2026',
    text: 'Ответ: «меня не устраивает данный договор». Конкретных возражений, замечаний, протокола разногласий и встречной редакции не представлено. На работу больше не выходит, о прекращении не уведомляет.',
    tone: 'warn',
  },
  {
    date: 'Понедельник, 24.08.2026',
    text: 'SMS: «Добрый вечер, когда ждать расчет?»',
    tone: 'warn',
  },
  {
    date: 'Четверг, 27.08.2026',
    text: 'Звонок по инициативе ИП: предложено оформить отношения и продолжить сотрудничество, как вариант — подписать договор и поработать ещё две недели на время подбора замены. Ответ — «подумаю».',
    tone: 'info',
  },
  {
    date: 'Пятница, 28.08.2026',
    text: 'Вместо ответа по существу: «Здравствуйте, я подготовила жалобу в трудовую инспекцию, прокуратуру и ФНС, если хотите ознакомиться с ней напишите почту».',
    tone: 'warn',
  },
  {
    date: '17.09.2026',
    text: 'Требование прокуратуры Дзержинского района г. Ярославля № 202-4260-2026/20780003/Исорг714-26 о явке и представлении документов.',
    tone: 'info',
  },
  {
    date: '23.09.2026, 15:00',
    text: 'Явка к старшему помощнику прокурора Смирновой И.А., г. Ярославль, ул. Батова, д. 8. При себе: паспорт и пакет документов из списка ниже.',
    tone: 'info',
  },
];

const REQUESTED = [
  'Штатное расписание, сведения о штатной численности, правила внутреннего трудового распорядка, положение об оплате труда',
  'Трудовые договоры со всеми работниками, в том числе с уже уволенными, за период с июня 2026 года; все приказы о приёме и увольнении',
  'Графики работы, табель учёта рабочего времени всех работников за тот же период, расчётные листы и документы, подтверждающие выплаты',
  'Справка о наличии (отсутствии) задолженности по заработной плате перед работниками',
  'Отдельный расчёт задолженности по Новиковой А.А.: период работы, должность, размер оплаты, отработанные дни, начисления и выплаты, в том числе за неиспользованный отпуск',
  'Сведения о проведении специальной оценки условий труда на рабочих местах',
];

const ProsecutorCase = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // Мета-тег ставим прямо здесь: index.html один на все страницы, а закрыть нужно
  // только эту. Убираем за собой при уходе, иначе noindex останется висеть на
  // остальных разделах — SPA страницу не перезагружает.
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow, noarchive, nosnippet';
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  if (!isAdmin) {
    return (
      <CrmLayout>
        <p className="text-sm text-muted-foreground">Раздел доступен только администратору.</p>
      </CrmLayout>
    );
  }

  return (
    <CrmLayout>
      <div className="mx-auto max-w-4xl space-y-6 pb-12">
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <Icon name="Lock" size={16} className="mt-0.5 shrink-0" />
            <p>
              Служебный раздел. Виден только администратору, скрыт из меню и закрыт от
              поисковых систем. Содержит персональные данные и материалы проверки —
              не пересылайте ссылку сотрудникам.
            </p>
          </div>
        </div>

        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Icon name="Scale" size={24} />
            Обращение в прокуратуру: Новикова А.А.
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Требование прокуратуры Дзержинского района г. Ярославля от 17.09.2026
            № 202-4260-2026/20780003/Исорг714-26. Явка 23.09.2026 в 15:00.
          </p>
        </div>

        <Card className="border-primary/30">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 font-semibold">
                <Icon name="FileText" size={18} />
                Письменные пояснения ИП Левкина А.С.
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Готовый документ на 7 листах: хронология двух периодов работы, уклонение от
                подписания договора 17–21.08, переписка 24 и 28 августа, доказательства
                того, что от расчёта никто не уклонялся, причины невозможности перевода,
                расчёт налога НПД, порядок урегулирования и опись приложений.
                Распечатать и подписать.
              </p>
            </div>
            <Button asChild className="shrink-0">
              <a href="/docs/prosecutor/poyasneniya-prokuratura.pdf" target="_blank" rel="noreferrer">
                <Icon name="Download" size={16} className="mr-2" />
                Скачать PDF
              </a>
            </Button>
          </CardContent>
        </Card>

        <Card className="border-primary/30">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 font-semibold">
                <Icon name="Table2" size={18} />
                Прейскурант расценок (приложение № 7)
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Все ставки по всем видам работ и должностям в обоих цехах: раскрой, пошив,
                оверлок, стикеровка, перепаковка, оклады за смену, премии. Подтверждает,
                что для Новиковой А.А. расценки те же, что и для остальных.
              </p>
            </div>
            <Button asChild variant="outline" className="shrink-0">
              <a href="/docs/prosecutor/prays-kurant.pdf" target="_blank" rel="noreferrer">
                <Icon name="Download" size={16} className="mr-2" />
                Скачать PDF
              </a>
            </Button>
          </CardContent>
        </Card>

        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Icon name="ListChecks" size={18} />
            Позиция по существу
          </h2>
          <Card>
            <CardContent className="space-y-3 p-5 text-sm leading-relaxed">
              <p>
                <b>Два разных периода, а не один.</b> Платёжные квитанции, представляемые
                в прокуратуру, закрывают первый период (июнь — 29.07.2026): по нему выплачено
                48 000 ₽, претензий не было. Спор касается второго периода —
                17–21.08.2026, когда Новикова А.А. сама попросилась обратно и вышла по
                приглашению.
              </p>
              <p>
                <b>Условия второго периода согласованы до выхода на работу.</b> 2 000 ₽ за
                смену при обязательном подписании договора ГПХ. Это условие озвучено
                заранее, а не выдвинуто задним числом.
              </p>
              <p>
                <b>Трудовые отношения не оформлялись по вине самой Новиковой А.А.</b> Она не
                представила документы, удостоверяющие личность, не подписала ни одного
                договора и отказалась регистрироваться в системе учёта, через которую
                ведётся фиксация объёма работ и начисление вознаграждения. Авторизация
                выполняется через мессенджер MAX — на просьбы установить приложение получен
                прямой отказ.
              </p>
              <p>
                <b>Уклонение от подписания всю неделю.</b> С 17 по 21 августа договор
                предлагался неоднократно — внятного ответа не было. 21.08 получен ответ
                «меня не устраивает данный договор» без единого конкретного возражения,
                замечания или встречной редакции. После этого выходы на работу прекращены
                без уведомления.
              </p>
              <p>
                <b>Задолженности по первому периоду нет.</b> Перечислено 48 000 ₽ четырьмя
                переводами по СБП, последний 29.07.2026. Все квитанции АО «ТБанк» сохранены
                и приложены.
              </p>
              <p>
                <b>Чеки «Мой налог» не представлены.</b> Расчёты с исполнителями ведутся в
                режиме НПД: после оплаты исполнитель формирует чек в приложении. Чеки за
                полученные деньги Новикова А.А. не сформировала.
              </p>
              <p>
                <b>От расчёта никто не скрывался.</b> Деньги за первый период переводились
                добровольно ещё в ходе работы, до каких-либо претензий. Именно ИП пригласил
                Новикову А.А. обратно в августе и сам инициировал переговоры 27.08.2026.
                Телефон, адрес производства и банковские реквизиты не менялись, сведения об
                ИП открыты в ЕГРИП, явка в прокуратуру обеспечена добровольно.
              </p>
              <p>
                <b>В выплате за август не отказываем.</b> Вознаграждение за смены
                17–21.08.2026 по ставке 2 000 ₽ готово к перечислению. Порядок: паспорт,
                ИНН и СНИЛС → регистрация в «Мой налог» → подписание договора ГПХ и акта →
                выплата → чек от исполнителя. Проект договора готов, замечания по условиям
                готовы обсуждать.
              </p>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Icon name="Ban" size={18} />
            Почему перевод сейчас невозможен
          </h2>
          <Card>
            <CardContent className="space-y-3 p-5 text-sm leading-relaxed">
              <p>
                <b>Нет договорных отношений.</b> Ни трудового, ни ГПХ. Паспорт, ИНН и СНИЛС
                не представлены — у платежа нет ни правового основания, ни
                идентифицированного получателя. Перевод по номеру телефона на карту
                «Анастасии Н.» не подтверждает, кому и за что перечислены деньги.
              </p>
              <p>
                <b>Нет чеков «Мой налог».</b> По ч. 1 ст. 14 Федерального закона от
                27.11.2018 № 422-ФЗ формирование чека — обязанность исполнителя, заказчик
                исполнить её за него не может. По всем четырём переводам отсутствуют
                документы об основании платежа: на запрос банка или ФНС представить, кроме
                квитанций, нечего.
              </p>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Icon name="Percent" size={18} />
            Налог с 48 000 ₽ платит сама исполнительница
          </h2>
          <Card>
            <CardContent className="space-y-3 p-5 text-sm leading-relaxed">
              <p>
                Ставка НПД при доходе от ИП — <b>6 %</b> (ч. 2 ст. 10 Федерального закона
                от 27.11.2018 № 422-ФЗ). С полученных 48 000 ₽ налог составляет{' '}
                <b>2 880 ₽</b>, а с учётом налогового вычета 10 000 ₽ (ставка снижается до
                4 %) — <b>1 920 ₽</b>. Страховые взносы плательщик НПД не уплачивает.
              </p>
              <p className="text-muted-foreground">
                Налог исполнитель считает и платит <b>сам</b>: заказчик при работе с
                самозанятым налоговым агентом не является (ч. 8 ст. 2 закона № 422-ФЗ), а
                страховые взносы с таких выплат не начисляются при наличии чека
                (ч. 1 ст. 15). Всё, что требовалось от Новиковой А.А., — встать на учёт в
                «Мой налог», сформировать чеки и уплатить не более 2 880 ₽.
              </p>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Icon name="ShieldAlert" size={18} />
            Риск по 115-ФЗ
          </h2>
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="p-5 text-sm leading-relaxed">
              <p>
                Участились случаи ограничения операций и блокировки счетов предпринимателей в
                порядке Федерального закона от 07.08.2001 № 115-ФЗ именно из-за регулярных
                переводов физическим лицам без отчётных документов об уплате налога на
                профессиональный доход. Банк вправе запросить экономическое обоснование
                операций и при отсутствии документов приостановить дистанционное обслуживание.
              </p>
              <p className="mt-3">
                Непредставление чеков «Мой налог» лишает возможности корректно подтвердить
                расходы и ставит под угрозу работу расчётного счёта — а значит и
                своевременность расчётов с остальными работниками.
              </p>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Icon name="Banknote" size={18} />
            Выплаты: 48 000 ₽
          </h2>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60 text-left">
                    <tr>
                      <th className="px-4 py-2 font-medium">Дата</th>
                      <th className="px-4 py-2 font-medium">Сумма</th>
                      <th className="px-4 py-2 font-medium">Квитанция</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {PAYMENTS.map((p) => (
                      <tr key={p.n} className="border-t">
                        <td className="whitespace-nowrap px-4 py-2">{p.date}</td>
                        <td className="whitespace-nowrap px-4 py-2 font-semibold">{p.sum}</td>
                        <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                          № {p.receipt}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Button asChild variant="ghost" size="sm">
                            <a href={p.file} target="_blank" rel="noreferrer">
                              <Icon name="FileDown" size={14} className="mr-1" />
                              Чек
                            </a>
                          </Button>
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t bg-muted/40">
                      <td className="px-4 py-2 font-semibold">Итого</td>
                      <td className="px-4 py-2 font-semibold">48 000 ₽</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground" colSpan={2}>
                        СБП, комиссия 0 ₽, получатель Анастасия Н. (Сбербанк), +7 (980) 662-22-04
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Icon name="CalendarClock" size={18} />
            Хронология
          </h2>
          <ol className="space-y-3">
            {TIMELINE.map((t, i) => (
              <li key={i} className="flex gap-3">
                <div
                  className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                    t.tone === 'ok'
                      ? 'bg-emerald-500'
                      : t.tone === 'warn'
                        ? 'bg-amber-500'
                        : 'bg-sky-500'
                  }`}
                />
                <div className="text-sm">
                  <div className="font-medium">{t.date}</div>
                  <p className="text-muted-foreground">{t.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Icon name="ClipboardList" size={18} />
            Что требует прокуратура взять с собой
          </h2>
          <Card>
            <CardContent className="p-5">
              <p className="mb-3 text-sm text-muted-foreground">
                Паспорт — обязательно. Далее по списку из требования:
              </p>
              <ul className="space-y-2 text-sm">
                {REQUESTED.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <Icon name="Square" size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Icon name="Paperclip" size={18} />
            Материалы дела
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Card>
              <CardContent className="p-4">
                <a
                  href="/docs/prosecutor/prokuratura-trebovanie.pdf"
                  target="_blank"
                  rel="noreferrer"
                  className="block"
                >
                  <img
                    src="/docs/prosecutor/prokuratura-preview.jpg"
                    alt="Требование прокуратуры от 17.09.2026"
                    className="mb-3 w-full rounded border"
                    loading="lazy"
                  />
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Icon name="FileText" size={16} />
                    Требование прокуратуры от 17.09.2026
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    № 202-4260-2026/20780003/Исорг714-26, зам. прокурора Д.А. Рябиков
                  </p>
                </a>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Icon name="Receipt" size={16} />
                  Квитанции АО «ТБанк»
                </div>
                <div className="grid gap-2">
                  {PAYMENTS.map((p) => (
                    <a
                      key={p.n}
                      href={p.file}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between rounded border px-3 py-2 text-sm hover:bg-muted/50"
                    >
                      <span>{p.date.split(' ')[0]}</span>
                      <span className="font-semibold">{p.sum}</span>
                    </a>
                  ))}
                </div>
                <a
                  href="/docs/prosecutor/prays-kurant.pdf"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded border px-3 py-2 text-sm hover:bg-muted/50"
                >
                  <span className="flex items-center gap-2">
                    <Icon name="Table2" size={14} />
                    Прейскурант (прил. № 7)
                  </span>
                  <span className="text-xs text-muted-foreground">3 л.</span>
                </a>
                <div className="rounded border border-dashed px-3 py-2 text-xs text-muted-foreground">
                  Скриншот SMS-переписки от 27.08.2026 в материалы ещё не загружен —
                  приложите файл, он указан шестым пунктом в описи пояснений.
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </CrmLayout>
  );
};

export default ProsecutorCase;