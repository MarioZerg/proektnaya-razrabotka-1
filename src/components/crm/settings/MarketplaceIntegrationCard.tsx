import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { MarketplaceConfigItem } from '@/lib/marketplaceIntegrationsConfig';
import type { MarketplaceIntegration } from '@/lib/marketplaceIntegrationsApi';

interface MarketplaceIntegrationCardProps {
  config: MarketplaceConfigItem;
  integration: MarketplaceIntegration | undefined;
  saving: boolean;
  onSave: (credentials: Record<string, string>, isEnabled: boolean) => Promise<void>;
  onToggle: (isEnabled: boolean) => Promise<void>;
}

const MarketplaceIntegrationCard = ({
  config,
  integration,
  saving,
  onSave,
  onToggle,
}: MarketplaceIntegrationCardProps) => {
  const [values, setValues] = useState<Record<string, string>>(integration?.credentials || {});
  const [dirty, setDirty] = useState(false);

  const isEnabled = integration?.isEnabled || false;
  const isConnected = Boolean(
    integration && config.fields.every((f) => (integration.credentials[f.key] || '').trim())
  );

  const handleChange = (key: string, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    await onSave(values, isEnabled);
    setDirty(false);
  };

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className={`text-base font-bold ${config.className}`}>{config.name}</CardTitle>
          <Badge variant={isConnected ? 'default' : 'secondary'} className={isConnected ? 'bg-emerald-600 hover:bg-emerald-600' : ''}>
            {isConnected ? 'Подключено' : 'Не подключено'}
          </Badge>
        </div>
        <Switch
          checked={isEnabled}
          disabled={!isConnected || saving}
          onCheckedChange={(checked) => onToggle(checked)}
        />
      </CardHeader>
      <CardContent className="space-y-3">
        {config.fields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <Label>{field.label}</Label>
            <Input
              type={field.secret ? 'password' : 'text'}
              placeholder={field.placeholder}
              value={values[field.key] || ''}
              onChange={(e) => handleChange(field.key, e.target.value)}
            />
          </div>
        ))}
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          disabled={saving || !dirty}
          onClick={handleSave}
        >
          {saving ? <Icon name="Loader2" size={14} className="mr-1.5 animate-spin" /> : null}
          Сохранить
        </Button>
      </CardContent>
    </Card>
  );
};

export default MarketplaceIntegrationCard;
