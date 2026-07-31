import CrmLayout from '@/components/crm/CrmLayout';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const placeholderTables = [
  { title: 'Сдельная оплата (пошив)', columns: ['Сотрудник', 'Изделие', 'Кол-во', 'Ставка', 'Сумма'] },
  { title: 'Оклад', columns: ['Сотрудник', 'Роль', 'Оклад', 'Отработано смен', 'К начислению'] },
  { title: 'Премии и удержания', columns: ['Сотрудник', 'Тип', 'Сумма', 'Комментарий', 'Дата'] },
];

const RatesSettings = () => {
  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Тарифы</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Начисления по ролям — состав таблиц уточняется
          </p>
        </div>

        {placeholderTables.map((t) => (
          <Card key={t.title} className="border-border shadow-none">
            <CardHeader>
              <CardTitle className="text-base">{t.title}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    {t.columns.map((c) => (
                      <TableHead key={c}>{c}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell colSpan={t.columns.length} className="text-center text-muted-foreground">
                      Пока нет данных
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}
      </div>
    </CrmLayout>
  );
};

export default RatesSettings;
