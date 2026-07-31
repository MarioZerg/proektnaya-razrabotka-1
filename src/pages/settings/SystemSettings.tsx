import { useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { workshopSettingsConfig } from '@/lib/workshopSettingsConfig';

const SystemSettings = () => {
  const [values, setValues] = useState<Record<string, string>>({});

  return (
    <CrmLayout>
      <div className="space-y-6">
        <h1 className="text-xl font-bold">Настройки системы</h1>

        <Card className="border-border shadow-none">
          <CardContent className="grid grid-cols-1 gap-4 pt-6 sm:grid-cols-2">
            {workshopSettingsConfig.map((item) => (
              <div key={item.key} className="space-y-1.5">
                <Label>{item.label}</Label>
                {item.type === 'select' ? (
                  <Select
                    value={values[item.key] || ''}
                    onValueChange={(v) => setValues((s) => ({ ...s, [item.key]: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      {item.options?.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type={item.type === 'number' ? 'number' : item.type === 'time' ? 'time' : 'text'}
                    value={values[item.key] || ''}
                    onChange={(e) => setValues((s) => ({ ...s, [item.key]: e.target.value }))}
                  />
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Button className="bg-emerald-600 text-white hover:bg-emerald-700">Сохранить</Button>

        <div className="flex flex-wrap gap-3">
          <Button variant="outline">Проверить дубли skuz в системе</Button>
          <Button variant="outline">Проверить наличие всех skuz в системе</Button>
          <Button variant="outline">Обновить склады OZON</Button>
          <Button variant="outline">Обновить склады WB</Button>
        </div>
      </div>
    </CrmLayout>
  );
};

export default SystemSettings;
