import type { RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';

interface WbFbsScanPanelProps {
  wbCreated: boolean;
  creatingSupply: boolean;
  onCreateSupply: () => void;
  canScan: boolean;
  scanRef: RefObject<HTMLInputElement>;
  scanValue: string;
  setScanValue: (v: string) => void;
  scanning: boolean;
  onScan: () => void;
}

/** Создание поставки на стороне WB (если не создалась сама) и поле сканера стикеров. */
const WbFbsScanPanel = ({
  wbCreated,
  creatingSupply,
  onCreateSupply,
  canScan,
  scanRef,
  scanValue,
  setScanValue,
  scanning,
  onScan,
}: WbFbsScanPanelProps) => (
  <>
    {!wbCreated && (
      <Card className="border-primary/30 bg-primary/5 shadow-none">
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="text-sm leading-snug text-muted-foreground">
            {creatingSupply
              ? 'Создаём поставку на WB — сканер откроется сам'
              : 'Не удалось создать поставку на WB. Нажмите, чтобы повторить.'}
          </div>
          <Button className="w-full sm:w-auto" onClick={onCreateSupply} disabled={creatingSupply}>
            <Icon name={creatingSupply ? 'Loader2' : 'PackagePlus'} size={16} className={`mr-1.5 ${creatingSupply ? 'animate-spin' : ''}`} />
            Создать на WB
          </Button>
        </CardContent>
      </Card>
    )}

    {canScan && (
      <Card className="border-primary/30 bg-primary/5 shadow-none">
        <CardContent
          className="space-y-2 pt-6"
          onClick={(e) => {
            if (!(e.target as HTMLElement).closest('input, button, a')) scanRef.current?.focus();
          }}
        >
          <div className="flex items-start gap-2 text-sm font-medium leading-snug text-foreground">
            <Icon name="ScanLine" size={18} className="mt-0.5 shrink-0" />
            Сканируйте стикер заказа WB
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              ref={scanRef}
              autoFocus
              placeholder="Номер заказа WB"
              value={scanValue}
              onChange={(e) => setScanValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onScan()}
              disabled={scanning}
              className="min-w-0 font-mono-tech"
            />
            <Button className="w-full sm:w-auto" onClick={onScan} disabled={scanning || !scanValue.trim()}>
              {scanning ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Добавить'}
            </Button>
          </div>
        </CardContent>
      </Card>
    )}
  </>
);

export default WbFbsScanPanel;
