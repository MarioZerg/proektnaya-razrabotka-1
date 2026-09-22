import Icon from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Шапка раздела и готовые к печати документы.
 *
 * Предупреждение о служебном характере стоит первым намеренно: раздел открывается
 * по прямой ссылке, и человек должен сразу видеть, что пересылать её нельзя.
 * Дальше — три документа, которые нужно распечатать и взять с собой на приём.
 */
const ProsecutorCaseHeader = () => (
  <>
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
            Готовый документ на 7 листах: хронология двух периодов, условия оплаты
            (2 000 ₽ за 100 единиц упаковки), уклонение от подписания договора
            17–21.08, переписка 24 и 28 августа, доказательства того, что от расчёта
            никто не уклонялся, причины невозможности перевода, расчёт налога НПД,
            порядок урегулирования и опись приложений. Распечатать и подписать.
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
            <Icon name="FileSignature" size={18} />
            Проект договора ГПХ (приложение № 8)
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Договор возмездного оказания услуг по упаковке с самозанятым + акт
            сдачи-приёмки. Стоимость услуг — <b>2 000 ₽ за объём упаковки 100 единиц
            изделий в день</b> (20 ₽ за единицу). Отдельным разделом закреплена
            обязанность исполнителя передавать чеки «Мой налог». Распечатать и взять
            с собой.
          </p>
        </div>
        <Button asChild variant="outline" className="shrink-0">
          <a href="/docs/prosecutor/proekt-dogovora-gph.pdf" target="_blank" rel="noreferrer">
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
            Все ставки по видам работ в обоих цехах: раскрой, пошив, оверлок,
            упаковка и стикеровка, перепаковка, оплата за смену, премия за выработку.
            Отдельной строкой — поштучная расценка 20 ₽ за единицу, то есть 2 000 ₽ за
            100 единиц упаковки. Подтверждает, что для Новиковой А.А. расценки те же,
            что и для остальных.
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
  </>
);

export default ProsecutorCaseHeader;
