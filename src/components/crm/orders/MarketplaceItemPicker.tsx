import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import Icon from '@/components/ui/icon';
import type { MarketplaceItem } from '@/lib/marketplaceItemsApi';

interface MarketplaceItemPickerProps {
  items: MarketplaceItem[];
  value: number | null;
  onChange: (itemId: number) => void;
}

const itemLabel = (item: MarketplaceItem) =>
  item.material && item.width && item.height
    ? `${item.material} ${item.width}x${item.height}`
    : item.name;

/** Поиск товара по материалу и размеру (из справочника "Товары на маркетплейсе") —
 * заменяет ручной ввод текста товара при создании заказов. */
const MarketplaceItemPicker = ({ items, value, onChange }: MarketplaceItemPickerProps) => {
  const [open, setOpen] = useState(false);
  const selected = items.find((i) => i.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          {selected ? itemLabel(selected) : 'Выберите материал и размер'}
          <Icon name="ChevronsUpDown" size={14} className="ml-2 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Поиск по материалу и размеру..." />
          <CommandList>
            <CommandEmpty>Ничего не найдено</CommandEmpty>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={itemLabel(item)}
                  onSelect={() => {
                    onChange(item.id);
                    setOpen(false);
                  }}
                >
                  <Icon
                    name="Check"
                    size={14}
                    className={`mr-2 ${value === item.id ? 'opacity-100' : 'opacity-0'}`}
                  />
                  {itemLabel(item)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default MarketplaceItemPicker;
