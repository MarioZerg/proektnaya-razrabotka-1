import { useEffect, useRef, useState } from 'react';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { roleLabels, type Role } from '@/lib/roles';
import { fetchEmployees, type Employee } from '@/lib/usersApi';
import { createContract } from '@/lib/contractsApi';

interface UploadContractDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
  actorId?: number;
  actorName?: string;
}

/** Админ загружает документ на сотрудника. Пока документ не подписан, сотрудник не
 * может работать в системе — поэтому загрузка сразу означает блокировку. */
const UploadContractDialog = ({
  open,
  onOpenChange,
  onDone,
  actorId,
  actorName,
}: UploadContractDialogProps) => {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [userId, setUserId] = useState('');
  const [title, setTitle] = useState('');
  const [fileBase64, setFileBase64] = useState('');
  const [fileName, setFileName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) fetchEmployees().then((list) => setEmployees(list.filter((e) => e.isActive)));
  }, [open]);

  const reset = () => {
    setUserId('');
    setTitle('');
    setFileBase64('');
    setFileName('');
  };

  const handleFile = (file: File) => {
    // Файл уходит в хранилище как есть, поэтому крупные документы не принимаем:
    // договор на 10+ МБ — это почти всегда скан плохого качества.
    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: 'Файл слишком большой',
        description: 'Максимум 10 МБ — сожмите документ или сохраните в PDF',
        variant: 'destructive',
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setFileBase64(String(reader.result));
      setFileName(file.name);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    if (!userId || !title.trim() || !fileBase64) return;
    setSaving(true);
    try {
      await createContract({
        userId: Number(userId),
        title: title.trim(),
        fileBase64,
        fileName,
        actorId,
        actorName,
      });
      toast({
        title: 'Документ направлен на подпись',
        description: 'Сотрудник не сможет работать в системе, пока не подпишет',
      });
      reset();
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast({
        title: 'Не удалось загрузить документ',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Направить документ на подпись</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Сотрудник</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите сотрудника" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={String(e.id)}>
                    {e.fullName} · {roleLabels[e.role as Role] || e.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Название документа</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Трудовой договор №12 от 01.08.2026"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Файл документа</Label>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start"
              onClick={() => fileRef.current?.click()}
            >
              <Icon name={fileName ? 'FileCheck' : 'Upload'} size={16} className="mr-2" />
              {fileName || 'Выбрать файл (PDF, Word, фото)'}
            </Button>
          </div>

          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <Icon name="TriangleAlert" size={18} className="mt-0.5 shrink-0" />
            <p>
              Пока сотрудник не подпишет документ, он не сможет пользоваться системой — при
              входе его встретит экран подписания.
            </p>
          </div>

          <Button
            className="w-full"
            disabled={saving || !userId || !title.trim() || !fileBase64}
            onClick={handleSubmit}
          >
            {saving ? (
              <Icon name="Loader2" size={16} className="mr-2 animate-spin" />
            ) : (
              <Icon name="Send" size={16} className="mr-2" />
            )}
            Направить на подпись
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UploadContractDialog;
