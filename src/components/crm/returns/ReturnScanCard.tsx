import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { printStorageSticker } from '@/lib/printStorageSticker';
import {
  scanMarketplaceReturn,
  processMarketplaceReturn,
  type MarketplaceReturn,
} from '@/lib/marketplaceReturnsApi';
import { fetchShelves, type Shelf } from '@/lib/shelvesApi';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface ReturnScanCardProps {
  onProcessed: () => void;
}

/** Приёмка приехавших возвратов: кладовщик сканирует пакет с товаром, осматривает
 * вещь и решает её судьбу — утилизировать, отправить на перепаковку или положить на полку. */
const ReturnScanCard = ({ onProcessed }: ReturnScanCardProps) => {
  const { toast } = useToast();
  const { user } = useAuth();

  const [code, setCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<MarketplaceReturn | null>(null);
  const [damageNote, setDamageNote] = useState('');
  const [processing, setProcessing] = useState<string | null>(null);
  // Полка выбирается прямо здесь: если вещь целая (клиент отказался при вручении,
  // упаковку даже не вскрывали), кладовщик кладёт её сразу и не гоняет через
  // отдельный шаг «разложить по полкам».
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [shelfId, setShelfId] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchShelves()
      .then(setShelves)
      .catch(() => setShelves([]));
  }, []);

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
        shelfId: outcome === 'stored' && shelfId ? Number(shelfId) : undefined,
      });

      if (outcome === 'stored' && res.storageBarcode) {
        // Стикер хранения нужен в любом случае: по нему вещь потом находят на полке.
        printStorageSticker({
          storageBarcode: res.storageBarcode,
          title: found.material && found.width
            ? `${found.material} ${found.width}×${found.height}`
            : found.productName,
          orderNumber: found.postingNumber || found.externalId,
        });
      }

      const messages = {
        utilized: 'Товар утилизирован — попадёт в отчёт администратору',
        repack: 'Отправлено в цех на перепаковку — упаковщик увидит на терминале',
        stored: res.placedOnShelf
          ? `Лежит на полке ${res.shelfName} — наклейте стикер хранения`
          : 'Наклейте стикер хранения и отсканируйте вещь на полку',
      };
      toast({ title: 'Возврат обработан', description: messages[outcome] });
      setFound(null);
      setDamageNote('');
      setShelfId('');
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
          Сканируйте пакет с товаром: наклейку возврата или наш стикер внутри
        </div>
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            autoFocus
            placeholder="Стикер возврата или стикер из пакета"
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
              {/* Отсканирован внутренний стикер из пакета — видно, кто делал именно эту
                  вещь. По маркетплейсному стикеру такой информации нет. */}
              {(found.sewerName || found.cutterName) && (
                <div className="rounded-md border border-blue-200 bg-blue-50 p-2 text-sm text-blue-900">
                  <p className="font-medium">Кто делал эту вещь:</p>
                  <p>
                    {found.sewerName && `швея ${found.sewerName}`}
                    {found.sewerName && found.cutterName && ' · '}
                    {found.cutterName && `закройщик ${found.cutterName}`}
                    {found.packerName && ` · упаковщик ${found.packerName}`}
                  </p>
                </div>
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

            {/* Целую вещь можно положить на полку сразу — выберите какую.
                Если полку не выбрать, вещь встанет в очередь «ждёт полку». */}
            <div className="space-y-1.5">
              <Select value={shelfId} onValueChange={setShelfId}>
                <SelectTrigger>
                  <SelectValue placeholder="Полка — если кладёте вещь сразу" />
                </SelectTrigger>
                <SelectContent>
                  {shelves.map((sh) => (
                    <SelectItem key={sh.id} value={String(sh.id)}>
                      {sh.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Вещь целая и осмотр не нужен — выберите полку, и товар сразу станет
                доступен для заказов. Без полки он встанет в очередь на укладку
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Button
                onClick={() => handleProcess('stored')}
                disabled={processing !== null}
                className="h-14"
              >
                <Icon name="PackageCheck" size={18} className="mr-2" />
                {shelfId ? 'Сразу на полку' : 'На полку'}
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
