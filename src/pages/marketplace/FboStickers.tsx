import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import { stickerItems } from '@/lib/stickerItems';
import { fetchEmployees, type Employee } from '@/lib/usersApi';

const FboStickers = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  const [itemId, setItemId] = useState('');
  const [marketplaceId, setMarketplaceId] = useState('');
  const [cluster, setCluster] = useState('');
  const [cutterId, setCutterId] = useState('');
  const [seamstressId, setSeamstressId] = useState('');

  useEffect(() => {
    fetchEmployees()
      .then(setEmployees)
      .finally(() => setLoading(false));
  }, []);

  const cutters = employees.filter((e) => e.role === 'cutter');
  const seamstresses = employees.filter((e) => e.role === 'sewer');

  return (
    <CrmLayout>
      <div className="space-y-6">
        <h1 className="text-xl font-bold">Печать ленты стикеров</h1>

        <Card className="border-border shadow-none">
          <CardContent className="space-y-4 pt-6">
            <div className="space-y-1.5">
              <Label>Товар</Label>
              <Select value={itemId} onValueChange={setItemId}>
                <SelectTrigger>
                  <SelectValue placeholder="---" />
                </SelectTrigger>
                <SelectContent>
                  {stickerItems.map((it, idx) => (
                    <SelectItem key={idx} value={String(idx)}>
                      {it.material} {it.width}х{it.height}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Маркетплейс</Label>
              <Select value={marketplaceId} onValueChange={setMarketplaceId}>
                <SelectTrigger>
                  <SelectValue placeholder="---" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">OZON</SelectItem>
                  <SelectItem value="2">WB</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Кластер</Label>
              <Select value={cluster} onValueChange={setCluster}>
                <SelectTrigger>
                  <SelectValue placeholder="---" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">---</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Закройщик</Label>
              <Select value={cutterId} onValueChange={setCutterId} disabled={loading}>
                <SelectTrigger>
                  <SelectValue placeholder="---" />
                </SelectTrigger>
                <SelectContent>
                  {cutters.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Швея</Label>
              <Select value={seamstressId} onValueChange={setSeamstressId} disabled={loading}>
                <SelectTrigger>
                  <SelectValue placeholder="---" />
                </SelectTrigger>
                <SelectContent>
                  {seamstresses.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <Button className="bg-emerald-600 text-white hover:bg-emerald-700">
                Сгенерировать стикер
              </Button>
              <Button variant="outline">
                <Icon name="FileSpreadsheet" size={16} className="mr-1.5" />
                Загрузить из Excel
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </CrmLayout>
  );
};

export default FboStickers;
