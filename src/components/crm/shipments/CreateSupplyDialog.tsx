import { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import type { Supplier } from '@/lib/suppliersApi';
import type { Material } from '@/lib/materialsApi';
import type { ItemRow } from '@/components/crm/shipments/fromSupplierShared';
import SupplyReceiveRows from '@/components/crm/shipments/SupplyReceiveRows';

interface CreateSupplyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenCreate: () => void;
  suppliers: Supplier[];
  materials: Material[];
  comment: string;
  setComment: (value: string) => void;
  rows: ItemRow[];
  setRows: Dispatch<SetStateAction<ItemRow[]>>;
  saving: boolean;
  onSave: () => void;
}

const CreateSupplyDialog = ({
  open,
  onOpenChange,
  onOpenCreate,
  suppliers,
  materials,
  comment,
  setComment,
  rows,
  setRows,
  saving,
  onSave,
}: CreateSupplyDialogProps) => {
  return (
    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-bold">Отгрузка от поставщика</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Стикеры печатаются сразу, на склад ткань встанет после проверки
        </p>
      </div>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild>
          <Button className="w-full shrink-0 sm:w-auto" onClick={onOpenCreate}>
            <Icon name="Plus" size={16} className="mr-2" />
            Новая приёмка
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Приёмка от поставщика</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Материалы</Label>
              <SupplyReceiveRows
                rows={rows}
                setRows={setRows}
                materials={materials}
                suppliers={suppliers}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Комментарий</Label>
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
            </div>

            <Button className="w-full" onClick={onSave} disabled={saving}>
              {saving ? 'Отправка...' : 'Отправить на подтверждение'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CreateSupplyDialog;
