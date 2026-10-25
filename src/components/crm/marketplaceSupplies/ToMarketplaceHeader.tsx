import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Icon from '@/components/ui/icon';
import type { SupplyType } from '@/lib/marketplaceSuppliesApi';
import type { Shop } from '@/lib/marketplaceIntegrationsApi';
import { createOptions } from '@/components/crm/marketplaceSupplies/toMarketplaceConstants';

const ToMarketplaceHeader = ({
  currentShop,
  creating,
  availableCreateOptions,
  onCreate,
}: {
  currentShop: Shop | null;
  creating: boolean;
  availableCreateOptions: typeof createOptions;
  onCreate: (marketplace: string, type: SupplyType) => void;
}) => (
  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
    <div className="min-w-0">
      <h1 className="text-xl font-bold">Поставка в маркет</h1>
      <p className="mt-1 hidden text-sm text-muted-foreground sm:block">
        {currentShop
          ? `Отгрузка готового товара магазина «${currentShop.name}» на маркетплейс`
          : 'Формирование отгрузки готового товара со склада на маркетплейс'}
      </p>
    </div>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button disabled={creating} className="w-full shrink-0 sm:w-auto">
          <Icon name="Plus" size={16} className="mr-2" />
          Создать поставку
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {availableCreateOptions.map((opt) => (
          <DropdownMenuItem key={opt.label} onClick={() => onCreate(opt.marketplace, opt.type)}>
            {opt.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);

export default ToMarketplaceHeader;
