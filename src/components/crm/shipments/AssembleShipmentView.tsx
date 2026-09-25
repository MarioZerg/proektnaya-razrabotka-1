import { RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import type { ShipmentDetail } from '@/lib/shipmentsApi';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { formatQuantity } from '@/lib/formatQuantity';

interface AssembleShipmentViewProps {
  activeShipment: ShipmentDetail;
  scanCode: string;
  setScanCode: (value: string) => void;
  scanning: boolean;
  scanInputRef: RefObject<HTMLInputElement>;
  onBack: () => void;
  onScan: () => void;
  onShip: () => void;
  onRemoveRoll: (itemId: number) => void;
}

const AssembleShipmentView = ({
  activeShipment,
  scanCode,
  setScanCode,
  scanning,
  scanInputRef,
  onBack,
  onScan,
  onShip,
  onRemoveRoll,
}: AssembleShipmentViewProps) => {
  useScannerAutoSubmit(scanCode, onScan, !scanning);

  // Запрошенная позиция — исходная строка заявки (создана при request_to_workshop), у нее
  // ещё нет rollId. requestedQuantity теперь необязателен (сотрудник может не указывать
  // количество), поэтому находим её по отсутствию rollId, а не по наличию requestedQuantity.
  const requestedItem = activeShipment.items.find((i) => i.rollId === null);
  const collectedItems = activeShipment.items.filter((i) => i.rollId !== null);
  const collectedQty = collectedItems.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
  const collectedUnit = collectedItems[0]?.unit || requestedItem?.unit || '';

  return (
    <div className="min-w-0 space-y-6 overflow-x-hidden">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" className="mb-1 px-0" onClick={onBack}>
            <Icon name="ChevronLeft" size={16} className="mr-1" />
            К списку
          </Button>
          <h1 className="text-xl font-bold">Сборка заявки #{activeShipment.id}</h1>
          <p className="mt-1 break-words text-sm text-muted-foreground">
            {requestedItem?.materialName || 'Материал не указан'}
            {requestedItem?.requestedQuantity
              ? ` · запрошено ${requestedItem.requestedQuantity} ${requestedItem.unit || ''}`
              : ''}
            {activeShipment.workshopName ? ` · ${activeShipment.workshopName}` : ''}
            {` · запросил ${activeShipment.requestedByName || '—'}`}
            {/* Заявку оформил админ за цех — вопросы по составу к нему, не к смене. */}
            {activeShipment.requestedByAdmin ? ' (админ)' : ''}
          </p>
        </div>
        <Button
          className="w-full shrink-0 sm:w-auto"
          onClick={onShip}
          disabled={collectedItems.length === 0}
        >
          <Icon name="Truck" size={16} className="mr-2" />
          Отправить в цех
        </Button>
      </div>

      <Card className="border-primary/30 bg-primary/5 shadow-none">
        <CardContent
          className="space-y-2 pt-6"
          onClick={(e) => {
            if (!(e.target as HTMLElement).closest('input, button, a')) {
              scanInputRef.current?.focus();
            }
          }}
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <Icon name="ScanLine" size={18} />
            Отсканируйте штрихкод рулона
          </div>
          <p className="text-xs text-muted-foreground">
            Сканер сам подставит код. Рулон должен быть на складе и того же материала, что в заявке.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              ref={scanInputRef}
              autoFocus
              placeholder="Штрихкод рулона"
              value={scanCode}
              onChange={(e) => setScanCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onScan()}
              disabled={scanning}
              className="font-mono-tech"
            />
            <Button className="shrink-0" onClick={onScan} disabled={scanning || !scanCode.trim()}>
              {scanning ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Добавить'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {collectedItems.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-muted/20 px-4 py-10 text-center">
          <Icon name="ScanLine" size={28} className="mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm font-medium">Нет отсканированных рулонов</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Отсканируйте рулон — он появится в списке ниже
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">Собрано рулонов: {collectedItems.length}</span>
            <span className="text-muted-foreground">
              {formatQuantity(collectedQty)} {collectedUnit}
            </span>
          </div>
          <div className="min-w-0 overflow-hidden rounded-md border border-border">
            <Table className="min-w-0 table-fixed">
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="w-[32%] whitespace-normal text-primary-foreground">Рулон</TableHead>
                  <TableHead className="w-[38%] whitespace-normal text-primary-foreground">Материал</TableHead>
                  <TableHead className="w-[20%] whitespace-normal text-primary-foreground">Кол-во</TableHead>
                  <TableHead className="w-[10%] text-primary-foreground" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {collectedItems.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="whitespace-normal break-all font-mono-tech">{i.rollBarcode}</TableCell>
                    <TableCell className="whitespace-normal break-words">{i.materialName}</TableCell>
                    <TableCell className="whitespace-normal">
                      {formatQuantity(i.quantity)} {i.unit}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => onRemoveRoll(i.id)}>
                        <Icon name="Trash2" size={14} />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
};

export default AssembleShipmentView;