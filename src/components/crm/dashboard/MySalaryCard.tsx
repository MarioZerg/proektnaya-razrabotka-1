import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { formatMoney } from '@/components/crm/dashboard/dashboardShared';

interface MySalaryCardProps {
  salary: number | null;
  loading: boolean;
}

const MySalaryCard = ({ salary, loading }: MySalaryCardProps) => {
  return (
    <Card className="border-border shadow-none">
      <CardHeader>
        <CardTitle className="text-base">Зарплата к выплате</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : (
          <p className="text-2xl font-bold">{formatMoney(salary || 0)} ₽</p>
        )}
      </CardContent>
    </Card>
  );
};

export default MySalaryCard;
