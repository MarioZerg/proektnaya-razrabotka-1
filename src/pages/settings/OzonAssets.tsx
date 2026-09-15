import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Icon from '@/components/ui/icon';

/**
 * ГОТОВЫЕ ФАЙЛЫ ДЛЯ МАРКЕТПЛЕЙСА.
 *
 * Картинки и таблицы лежат в папке проекта, и раньше добраться до них можно
 * было только по прямой ссылке — её приходилось искать в переписке. Здесь всё
 * собрано в одном месте: видно, что это за файл, куда он идёт в кабинете OZON,
 * и кнопка скачивания рядом.
 */

interface AssetFile {
  /** Путь в папке public — он же адрес для скачивания. */
  path: string;
  title: string;
  /** Куда именно вставлять файл в кабинете маркетплейса. */
  where: string;
  size: string;
  /** Показывать ли картинку предпросмотра. */
  preview?: boolean;
}

interface AssetGroup {
  title: string;
  hint: string;
  icon: string;
  files: AssetFile[];
}

const GROUPS: AssetGroup[] = [
  {
    title: 'Логотип магазина',
    hint: 'Квадрат 200×200 — формат, который принимает витрина OZON',
    icon: 'Store',
    files: [
      { path: '/ozon/logo-200x200.png', title: 'Логотип PNG', where: 'Основной вариант, белый фон', size: '200×200 · 32 КБ', preview: true },
      { path: '/ozon/logo-200x200.jpg', title: 'Логотип JPG', where: 'Если форма требует JPG', size: '200×200 · 16 КБ', preview: true },
      { path: '/ozon/logo-200x200-transparent.png', title: 'Логотип с прозрачным фоном', where: 'Для тёмных подложек', size: '200×200 · 40 КБ', preview: true },
      { path: '/ozon/logo-512x512.png', title: 'Логотип 512×512', where: 'Запас под другие разделы кабинета', size: '512×512 · 128 КБ', preview: true },
    ],
  },
  {
    title: 'Баннеры витрины',
    hint: 'Оформление магазина в стиле шапки ДЮНА',
    icon: 'Image',
    files: [
      { path: '/ozon/banner-1500x600.jpg', title: 'Главный баннер', where: 'Витрина магазина, десктоп', size: '1500×600 · 152 КБ', preview: true },
      { path: '/ozon/banner-mobile-1200x900.jpg', title: 'Мобильный баннер', where: 'Витрина магазина, телефон', size: '1200×900 · 180 КБ', preview: true },
    ],
  },
  {
    title: 'Плитки категорий',
    hint: 'Разбивка по ширине — главный вопрос покупателя «подойдёт ли на моё окно»',
    icon: 'LayoutGrid',
    files: [
      { path: '/ozon/tile-1-uzkie.jpg', title: '200–300 см', where: 'Кухня, балкон, спальня', size: '720×720 · 112 КБ', preview: true },
      { path: '/ozon/tile-2-shirokie.jpg', title: '400–500 см', where: 'Гостиная и зал', size: '720×720 · 112 КБ', preview: true },
      { path: '/ozon/tile-3-maxi.jpg', title: '600–800 см', where: 'Панорамные окна', size: '720×720 · 116 КБ', preview: true },
      { path: '/ozon/tile-4-vysokie.jpg', title: 'До 295 см', where: 'Высокие потолки', size: '720×720 · 104 КБ', preview: true },
    ],
  },
  {
    title: 'Таблицы товаров',
    hint: 'Заполненный шаблон OZON: названия, аннотации, хештеги, rich-контент',
    icon: 'FileSpreadsheet',
    files: [
      {
        // Имя латиницей: кириллица в адресе файла ломается в части браузеров
        // и почтовых клиентов — ссылка приходит битой.
        path: '/download/ozon-duna-tul-vual-100-tovarov.xlsx',
        title: 'Шаблон OZON — 100 товаров',
        where: 'Загрузить в кабинет: Товары → Загрузить через XLS',
        size: 'XLSX · 290 КБ',
      },
      {
        path: '/download/ozon-tul-vual-molochnaya-annotacii.xlsx',
        title: 'Аннотации и семантика',
        where: 'Справочно: тексты, ключевые запросы, рекомендации',
        size: 'XLSX · 53 КБ',
      },
    ],
  },
  {
    title: 'Листовки-вкладыши',
    hint: 'Для печати в zip-пакет, с новыми реквизитами изготовителя',
    icon: 'FileText',
    files: [
      { path: '/download/listovka-DUNA-1.pdf', title: 'Листовка 253×303 мм', where: 'Печать, малый формат', size: 'PDF' },
      { path: '/download/listovka-DUNA-2.pdf', title: 'Листовка 303×353 мм', where: 'Печать, средний формат', size: 'PDF' },
      { path: '/download/listovka-DUNA-3.pdf', title: 'Листовка 353×403 мм', where: 'Печать, большой формат', size: 'PDF' },
    ],
  },
];

/** Имя файла из пути — его же подставляем в атрибут download. */
const fileName = (path: string) => path.split('/').pop() || 'file';

const OzonAssets = () => {
  const total = GROUPS.reduce((n, g) => n + g.files.length, 0);

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Материалы для OZON</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Готовые файлы для оформления магазина и загрузки товаров — {total} шт.
            Нажмите «Скачать», файл сохранится на компьютер.
          </p>
        </div>

        {GROUPS.map((group) => (
          <Card key={group.title} className="border-border shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <Icon name={group.icon} size={18} className="text-muted-foreground" />
                {group.title}
                <Badge variant="secondary" className="font-normal">
                  {group.files.length}
                </Badge>
              </CardTitle>
              <p className="text-sm text-muted-foreground">{group.hint}</p>
            </CardHeader>

            <CardContent className="grid gap-3 sm:grid-cols-2">
              {group.files.map((f) => (
                <div
                  key={f.path}
                  className="flex items-center gap-3 rounded-md border border-border p-3"
                >
                  {/* Картинку показываем сразу: так видно, что скачиваешь,
                      и не нужно открывать файл ради проверки. */}
                  {f.preview ? (
                    <img
                      src={f.path}
                      alt={f.title}
                      loading="lazy"
                      className="h-14 w-14 shrink-0 rounded border border-border bg-muted object-cover"
                    />
                  ) : (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded border border-border bg-muted">
                      <Icon name={group.icon} size={22} className="text-muted-foreground" />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{f.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{f.where}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{f.size}</p>
                  </div>

                  {/* download заставляет браузер сохранить файл, а не открывать
                      его во вкладке — иначе картинки и PDF просто показываются. */}
                  <Button asChild size="sm" variant="secondary" className="shrink-0">
                    <a href={f.path} download={fileName(f.path)}>
                      <Icon name="Download" size={15} className="mr-1.5" />
                      Скачать
                    </a>
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}

        <p className="text-sm text-muted-foreground">
          Файлы открываются и с телефона — ссылку можно переслать в мессенджере.
        </p>
      </div>
    </CrmLayout>
  );
};

export default OzonAssets;