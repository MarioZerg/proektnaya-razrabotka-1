import { useState } from 'react';
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { SupplyDetail, SupplyGroup } from '@/lib/marketplaceSuppliesApi';
import type { Row } from './fbsChecklist/fbsChecklistShared';
import FbsChecklistHeader from './fbsChecklist/FbsChecklistHeader';
import FbsChecklistRow from './fbsChecklist/FbsChecklistRow';
import BundleBlock from './fbsChecklist/BundleBlock';

interface FbsSupplyChecklistProps {
  supply: SupplyDetail;
  canEditItems: boolean;
  canRemoveItems: boolean;
  onRemoveItem: (itemId: number) => void;
  onReload: () => void;
}

/**
 * Чек-лист сборки FBS-поставки: один список вместо счётчика и отдельной таблицы.
 *
 * Сверху — то, что уже отсканировано (зелёные строки), ниже — что ещё нужно принести.
 * Кладовщик пикает ярлык, строка зеленеет и уезжает вверх: видно, сколько осталось,
 * и не нужно держать разницу в уме.
 *
 * В списке только застикерованный товар — незастикерованный в поставку и не пустят.
 */
const FbsSupplyChecklist = ({
  supply,
  canEditItems,
  canRemoveItems,
  onRemoveItem,
  onReload,
}: FbsSupplyChecklistProps) => {
  // Хук объявлен до любых ранних выходов: ниже есть return для пустого списка, а
  // порядок хуков в React должен совпадать при каждом рендере.
  const [printing, setPrinting] = useState(false);

  const scannedRows: Row[] = supply.items.map((item) => ({
    key: `in-${item.id}`,
    scanned: true,
    orderNumber: item.orderNumber,
    material: item.material,
    width: item.width,
    height: item.height,
    labeledByName: item.labeledByName ?? null,
    item,
    groupKey: item.groupKey ?? null,
    bundleBarcode: item.bundleBarcode ?? null,
  }));

  const waitingRows: Row[] = (supply.awaitingItems || []).map((a) => ({
    key: `wait-${a.id}`,
    scanned: false,
    orderNumber: a.orderNumber,
    material: a.material,
    width: a.width,
    height: a.height,
    labeledByName: a.labeledByName,
    shelfName: a.shelfName,
    groupKey: a.groupKey ?? null,
    bundleBarcode: a.bundleBarcode ?? null,
  }));

  // Ненайденные — НАВЕРХ. Это и есть работа: собранное кладовщик уже держит в коробе
  // и перечитывать не будет. Раньше список шёл в обратном порядке, и три несобранные
  // вещи прятались в самом низу под полутора сотней зелёных строк — до них нужно было
  // домотать, и казалось, что их вообще нет.
  const flatRows = [...waitingRows, ...scannedRows];
  const total = flatRows.length;

  // Связки Яндекса собираем вместе: вещи одного заказа едут только целиком, и
  // кладовщик должен видеть их подряд под общей шапкой, а не искать по всему
  // списку одинаковые номера. Порядок сохраняем: связка встаёт туда, где стояла
  // её первая вещь — несобранное по-прежнему сверху.
  const groupOf = (r: Row) =>
    r.groupKey ? supply.groups?.find((g) => g.groupKey === r.groupKey) : undefined;

  type Block =
    | { kind: 'row'; row: Row }
    | { kind: 'bundle'; group: SupplyGroup; rows: Row[] };

  const blocks: Block[] = [];
  const seen = new Set<string>();
  for (const row of flatRows) {
    const group = groupOf(row);
    // Группа из одной вещи связкой не считается — это обычный заказ.
    if (!group || group.total <= 1) {
      blocks.push({ kind: 'row', row });
      continue;
    }
    if (seen.has(group.groupKey)) continue;
    seen.add(group.groupKey);
    blocks.push({
      kind: 'bundle',
      group,
      rows: flatRows.filter((r) => r.groupKey === group.groupKey),
    });
  }

  const awaiting = supply.awaitingItems || [];

  // Печать QR-бирки заказа — замена потерянному листку закройщика.
  //
  // Кладовщик собирает поставку и не может найти вещь: она в цехе, но листок с QR
  // потерян или затёрт, и упаковщица не может её застикеровать. Раньше это тупик —
  // приходилось идти к админу и включать ручной поиск. Теперь кладовщик печатает
  // бирку с тем же QR, несёт в цех, и вещь стикеруется обычным путём.
  const handlePrintQr = async (row: Row) => {
    if (!row.orderNumber) return;
    const { printOrderQrTag } = await import('@/lib/printOrderQrTag');
    await printOrderQrTag({
      orderNumber: row.orderNumber,
      material: row.material,
      width: row.width,
      height: row.height,
      marketplace: supply.marketplace,
      orderType: supply.type,
    });
  };

  /**
   * Печать стикера связки (YM-…).
   *
   * Связку собирают именно по нему: ярлык маркетплейса у заказа из нескольких
   * вещей один на всех, и отсканировать им четыре разные вещи невозможно.
   * Стикер на складе мнётся и отклеивается — тогда вещь не отсканировать вовсе,
   * поэтому даём напечатать его заново.
   */
  const handlePrintBundle = async (row: Row) => {
    if (!row.bundleBarcode) return;
    const { printStorageSticker } = await import('@/lib/printStorageSticker');
    const group = row.groupKey
      ? supply.groups?.find((g) => g.groupKey === row.groupKey)
      : undefined;
    printStorageSticker({
      storageBarcode: row.bundleBarcode,
      title: `${row.material || ''} ${row.width && row.height ? `${row.width}×${row.height}` : ''}`.trim(),
      orderNumber: row.orderNumber,
      groupLabel: group && group.total > 1 ? `Связка: вещь из ${group.total}` : null,
    });
  };

  // Печать листа недостачи: что не доехало до короба и с кого спрашивать.
  //
  // Кладовщик закрывает поставку, а несколько вещей так и не отсканированы — искать
  // их приходится по всему цеху. В листе по каждой позиции сразу есть заказ, размер,
  // полка и три фамилии: кто кроил, кто шил, кто упаковывал, и дата упаковки.
  const handlePrintMissing = async () => {
    if (awaiting.length === 0 || printing) return;
    setPrinting(true);
    try {
      const { printSupplyMissingSheet } = await import('@/lib/printSupplyMissingSheet');
      await printSupplyMissingSheet(
        awaiting,
        `Поставка №${supply.id} · ${supply.marketplace || ''} ${supply.type || ''}`.trim()
      );
    } finally {
      setPrinting(false);
    }
  };

  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Нет застикерованного товара. Найдите вещи на складе в разделе «Сборка товара
        с полок», наклейте ярлык маркетплейса — и они появятся здесь
      </p>
    );
  }

  // Одна строка списка. Вынесена в функцию, чтобы те же строки можно было
  // показать и внутри связки, не дублируя разметку.
  const renderRow = (row: Row) => (
    <FbsChecklistRow
      key={row.key}
      row={row}
      supply={supply}
      canEditItems={canEditItems}
      canRemoveItems={canRemoveItems}
      onRemoveItem={onRemoveItem}
      onReload={onReload}
      onPrintQr={handlePrintQr}
      onPrintBundle={handlePrintBundle}
    />
  );

  return (
    <div className="space-y-2">
      <FbsChecklistHeader
        supply={supply}
        scannedCount={scannedRows.length}
        total={total}
        awaitingCount={awaiting.length}
        printing={printing}
        onPrintMissing={handlePrintMissing}
      />
      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-primary hover:bg-primary">
              <TableHead className="w-10 text-primary-foreground"></TableHead>
              <TableHead className="text-primary-foreground">Заказ</TableHead>
              <TableHead className="text-primary-foreground">Материал</TableHead>
              <TableHead className="text-primary-foreground">Размер</TableHead>
              <TableHead className="text-primary-foreground">Кто стикеровал</TableHead>
              <TableHead className="text-primary-foreground">Статус</TableHead>
              {canEditItems && <TableHead className="text-primary-foreground"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Связки Яндекса идут под общей шапкой: вещи такого заказа едут
                только целиком, и кладовщик должен видеть их вместе, а не
                выискивать одинаковые номера по всему списку. */}
            {blocks.map((block) =>
              block.kind === 'bundle' ? (
                <BundleBlock
                  key={block.group.groupKey}
                  group={block.group}
                  rows={block.rows}
                  renderRow={renderRow}
                  colSpan={canEditItems ? 7 : 6}
                  supplyId={supply.id}
                  onLabelScanned={onReload}
                />
              ) : (
                renderRow(block.row)
              ),
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default FbsSupplyChecklist;
