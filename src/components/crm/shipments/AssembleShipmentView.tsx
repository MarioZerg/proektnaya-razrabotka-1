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

interface AssembleShipmentViewProps {
  activeShipment: ShipmentDetail;
  scanCode: string;
  setScanCode: (value: string) => void;
  scanning: boolean;
  scanInputRef: RefObject<HTMLInputElement>;
  onBack: () => void;
  onScan: () => void;
  onShip: () => void;
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
}: AssembleShipmentViewProps) => {
  // Запрошенная позиция — исходная строка заявки (создана при request_to_workshop), у нее
  // ещё нет rollId. requestedQuantity теперь необязателен (сотрудник может не указывать
  // количество), поэтому находим её по отсутствию rollId, а не по наличию requestedQuantity.
  const requestedItem = activeShipment.items.find((i) => i.rollId === null);
  const collectedItems = activeShipment.items.filter((i) => i.rollId !== null);

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack} className="mb-2 -ml-2">
          <Icon name="ChevronLeft" size={16} className="mr-1" />
          К списку
        </Button>
        <h1 className="text-xl font-bold">Сборка поставки #{activeShipment.id}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Запрошено: {requestedItem?.materialName}
          {requestedItem?.requestedQuantity ? ` ${requestedItem.requestedQuantity} ${requestedItem.unit || ''}` : ''}
          {' '}· Запросил: {activeShipment.requestedByName || '—'}
        </p>
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
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Icon name="ScanLine" size={18} />
            Отсканируйте штрихкод рулона
          </div>
          <div className="flex gap-2">
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
            <Button onClick={onScan} disabled={scanning || !scanCode.trim()}>
              {scanning ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Добавить'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {collectedItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">Нет отсканированных рулонов</p>
      ) : (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Рулон</TableHead>
                <TableHead>Материал</TableHead>
                <TableHead>Кол-во</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {collectedItems.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-mono-tech">{i.rollBarcode}</TableCell>
                  <TableCell>{i.materialName}</TableCell>
                  <TableCell>
                    {i.quantity} {i.unit}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Button onClick={onShip} disabled={collectedItems.length === 0}>
        <Icon name="Truck" size={16} className="mr-2" />
        Отправить в цех
      </Button>
    </div>
  );
};

export default AssembleShipmentView;