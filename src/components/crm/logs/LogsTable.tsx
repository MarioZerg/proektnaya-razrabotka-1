import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { stageIcons, type LogEvent } from '@/lib/logsApi';

interface LogsTableProps {
  items: LogEvent[];
  loading: boolean;
}

/** Категория события → иконка. По ней взгляд цепляется быстрее, чем по тексту. */
const categoryIcon = (category: string) =>
  stageIcons[category as keyof typeof stageIcons] || 'Activity';

const roleLabels: Record<string, string> = {
  sewer: 'Швея',
  cutter: 'Закройщик',
  packer: 'Упаковщик',
  storekeeper: 'Кладовщик',
  senior_storekeeper: 'Ст. кладовщик',
  cleaner: 'Уборщица',
  manager: 'Менеджер',
  admin: 'Админ',
};

const formatAt = (at: string) => {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const LogsTable = ({ items, loading }: LogsTableProps) => {
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загружаем журнал…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border p-8 text-center">
        <Icon name="ScrollText" size={28} className="mx-auto text-muted-foreground" />
        <p className="mt-2 font-medium">Записей нет</p>
        <p className="mt-1 text-sm text-muted-foreground">
          За выбранный период ничего не происходило — попробуйте другой день
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[110px]">Когда</TableHead>
            <TableHead>Кто</TableHead>
            <TableHead>Что сделал</TableHead>
            <TableHead>Заказ</TableHead>
            <TableHead>Цех</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((e, idx) => (
            <TableRow key={`${e.at}-${idx}`}>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                {formatAt(e.at)}
              </TableCell>
              <TableCell>
                <div className="font-medium leading-tight">{e.who}</div>
                {e.role && (
                  <div className="text-xs text-muted-foreground">
                    {roleLabels[e.role] || e.role}
                  </div>
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-start gap-1.5">
                  <Icon
                    name={categoryIcon(e.category)}
                    size={14}
                    className="mt-0.5 shrink-0 text-muted-foreground"
                  />
                  <div>
                    <div className="font-medium leading-tight">{e.actionTitle}</div>
                    {e.description && (
                      <div className="text-xs text-muted-foreground">{e.description}</div>
                    )}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                {e.orderNumber ? (
                  <div>
                    <div className="font-mono-tech text-xs">{e.orderNumber}</div>
                    {e.marketplace && (
                      <Badge variant="outline" className="mt-0.5 text-[10px]">
                        {e.marketplace}
                      </Badge>
                    )}
                    {e.storageBarcode && (
                      <div className="font-mono-tech text-[10px] text-muted-foreground">
                        полка {e.storageBarcode}
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {e.workshop || '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export default LogsTable;
