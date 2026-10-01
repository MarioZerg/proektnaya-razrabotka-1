import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import type { WorkshopDetail } from '@/lib/workshopsApi';

interface WorkshopGeneralCardProps {
  workshop: WorkshopDetail;
  name: string;
  setName: (v: string) => void;
  status: 'active' | 'inactive';
  setStatus: (v: 'active' | 'inactive') => void;
  onBack: () => void;
}

/** Шапка страницы цеха: возврат к списку, название, статус и смены. */
const WorkshopGeneralCard = ({
  workshop,
  name,
  setName,
  status,
  setStatus,
  onBack,
}: WorkshopGeneralCardProps) => (
  <>
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-11 w-11 shrink-0 sm:h-9 sm:w-9"
        onClick={onBack}
        aria-label="К списку цехов"
      >
        <Icon name="ArrowLeft" size={20} />
      </Button>
      <h1 className="min-w-0 truncate text-xl font-bold">{workshop.name}</h1>
    </div>

    <Card className="border-border shadow-none">
      <CardContent className="grid grid-cols-1 gap-4 pt-6 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Название цеха</Label>
          <Input
            value={name}
            className="h-11 md:h-10"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Статус</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as 'active' | 'inactive')}>
            <SelectTrigger className="h-11 text-base md:h-10 md:text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Активен</SelectItem>
              <SelectItem value="inactive">Неактивен</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>

    {workshop.shifts.length > 0 && (
      <div className="flex flex-wrap gap-2">
        {workshop.shifts.map((s) => (
          <Badge key={s.number} variant="secondary" className="px-2 py-1 text-sm">
            Смена № {s.number} — {s.employeesCount} сотр.
          </Badge>
        ))}
      </div>
    )}
  </>
);

export default WorkshopGeneralCard;
