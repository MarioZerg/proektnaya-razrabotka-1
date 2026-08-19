import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchCertificates,
  certificateLink,
  type CertificateInfo,
} from '@/lib/varikiApi';

interface CertificatesDialogProps {
  itemId: number | null;
  itemTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Что реально лежит на складе по подарку.
 *
 * Админу нужно проверять загруженное: не перепутан ли файл, не залит ли дважды
 * один и тот же, кому какой сертификат ушёл. Раньше это было видно только по
 * счётчику «готово к выдаче» — цифра есть, а что за ней, непонятно.
 *
 * Каждый файл можно открыть. Ссылка ведёт на наш адрес, а не в хранилище: по
 * прямой ссылке сертификат скачал бы любой, кому её переслали.
 */
const CertificatesDialog = ({
  itemId,
  itemTitle,
  open,
  onOpenChange,
}: CertificatesDialogProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [list, setList] = useState<CertificateInfo[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !itemId) return;
    setLoading(true);
    fetchCertificates(itemId, user?.id)
      .then(setList)
      .catch((e) =>
        toast({
          title: 'Не удалось загрузить список',
          description: e instanceof Error ? e.message : '',
          variant: 'destructive',
        }),
      )
      .finally(() => setLoading(false));
  }, [open, itemId, user?.id, toast]);

  const free = list.filter((c) => !c.issuedAt).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Сертификаты: {itemTitle}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : !list.length ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <Icon name="FileX" size={28} className="mx-auto mb-2 opacity-40" />
            Пока ничего не загружено
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Всего {list.length}, свободно {free}, выдано {list.length - free}
            </p>

            <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
              {list.map((c) => (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {c.fileName || 'Без названия'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Загрузил {c.uploadedByName || '—'}
                      {c.uploadedAt && ` · ${formatDateTime(c.uploadedAt)}`}
                    </p>
                    {/* Кому ушёл файл — важнее всего при разборе спорных случаев:
                        сотрудник говорит «не получил», а тут видно дату и имя. */}
                    {c.issuedAt && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Выдан: {c.issuedTo || '—'} · {formatDateTime(c.issuedAt)}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {c.issuedAt ? (
                      <Badge variant="outline">Выдан</Badge>
                    ) : (
                      <Badge variant="secondary">Свободен</Badge>
                    )}
                    <Button asChild size="sm" variant="outline">
                      <a
                        href={certificateLink(c.id, user?.id)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Icon name="Eye" size={15} className="mr-1.5" />
                        Открыть
                      </a>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default CertificatesDialog;
