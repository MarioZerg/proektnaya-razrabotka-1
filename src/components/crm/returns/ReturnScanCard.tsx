import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { printBarcodes } from '@/lib/printBarcodes';
import {
  scanMarketplaceReturn,
  processMarketplaceReturn,
  type MarketplaceReturn,
} from '@/lib/marketplaceReturnsApi';

interface ReturnScanCardProps {
  onProcessed: () => void;
}

/** Приёмка приехавших возвратов: кладовщик сканирует стикер возврата с коробки, осматривает
 * вещь и решает её судьбу — утилизировать, отправить на перепаковку или положить на полку. */
const ReturnScanCard = ({ onProcessed }: ReturnScanCardProps) => {
  const { toast } = useToast();
  const { user } = useAuth();

  const [code, setCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<MarketplaceReturn | null>(null);
  const [damageNote, setDamageNote] = useState('');
  const [processing, setProcessing] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleScan = async () => {
    const value = code.trim();
    if (!value) return;
    setCode('');
    setScanning(true);
    setFound(null);
    setDamageNote('');
    try {
      const res = await scanMarketplaceReturn(value);
      setFound(res.return);
    } catch (e) {
      toast({
        title: 'Возврат не найден',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setScanning(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const handleProcess = async (outcome: 'utilized' | 'repack' | 'stored') => {
    if (!found) return;
    if (outcome === 'utilized' && !damageNote.trim()) {
      toast({
        title: 'Опишите повреждение',
        description: 'Администратор должен видеть, за что списан товар',
        variant: 'destructive',
      });
      return;
    }
    setProcessing(outcome);
    try {
      const res = await processMarketplaceReturn({
        id: found.id,
        outcome,
        damageNote: damageNote.trim() || undefined,
        actorId: user?.id,
        actorName: user?.name,
      });

      if (outcome === 'stored' && res.storageBarcode) {
        // Вещь едет на полку — сразу печатаем стикер хранения, по нему её и разместят.
        printBarcodes(
          [{ code: res.storageBarcode, label: found.productName || 'Возврат' }],
          `Стикер хранения ${res.storageBarcode}`
        );
      }

      const messages = {
        utilized: 'Товар утилизирован — попадёт в отчёт администратору',
        repack: 'Отправлено в цех на перепаковку — упаковщик увидит на терминале',
        stored: 'Наклейте стикер хранения и отсканируйте вещь на полку',
      };
      toast({ title: 'Возврат обработан', description: messages[outcome] });
      setFound(null);
      setDamageNote('');
      onProcessed();
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch (e) {
      toast({
        title: 'Ошибка',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setProcessing(null);
    }
  };

  return (
    <Card className="border-primary/30 bg-primary/5 shadow-none">
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Icon name="ScanLine" size={18} />
          Отсканируйте стикер возврата с коробки
        </div>
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            autoFocus
            placeholder="Штрихкод возврата или номер отправления"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleScan()}
            disabled={scanning}
            className="font-mono-tech"
          />
          <Button onClick={handleScan} disabled={scanning || !code.trim()}>
            {scanning ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Найти'}
          </Button>
        </div>

        {found && (
          <div className="space-y-4 rounded-md border border-border bg-background p-4">
            <div className="space-y-1">
              <p className="font-medium">
                {found.material && found.width
                  ? `${found.material} ${found.width}×${found.height}`
                  : found.productName || 'Товар'}
              </p>
              <p className="break-all font-mono-tech text-xs text-muted-foreground">
                {found.marketplace} · {found.postingNumber || found.externalId}
              </p>
              {found.returnReason && (
                <p className="text-sm text-muted-foreground">
                  Причина покупателя: {found.returnReason}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Textarea
                placeholder="Что с товаром: дырки, пятна, потёртости (обязательно при утилизации)"
                value={damageNote}
                onChange={(e) => setDamageNote(e.target.value)}
                rows={2}
              />
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Button
                onClick={() => handleProcess('stored')}
                disabled={processing !== null}
                className="h-14"
              >
                <Icon name="PackageCheck" size={18} className="mr-2" />
                На полку
              </Button>
              <Button
                variant="outline"
                onClick={() => handleProcess('repack')}
                disabled={processing !== null}
                className="h-14"
              >
                <Icon name="PackageOpen" size={18} className="mr-2" />
                На перепаковку
              </Button>
              <Button
                variant="outline"
                onClick={() => handleProcess('utilized')}
                disabled={processing !== null}
                className="h-14 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Icon name="Trash2" size={18} className="mr-2" />
                Утилизировать
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ReturnScanCard;
