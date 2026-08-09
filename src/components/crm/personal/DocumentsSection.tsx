import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { formatDateTime } from '@/lib/dateUtils';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  rejectDocs,
  unblockDocs,
  uploadUserDoc,
  type DocType,
  type PersonalData,
} from '@/lib/personalDataApi';

interface DocumentsSectionProps {
  data: PersonalData;
  userId: number;
  actorId: number;
  /** Админ видит сами сканы, сотрудник — только факт загрузки. */
  isAdmin: boolean;
  onChanged: () => void;
}

/** Что именно снимать — люди присылают обложку паспорта вместо разворота. */
const HINTS: Record<DocType, string> = {
  passport_main: 'Разворот с фотографией — тот, где ФИО, дата рождения и номер',
  passport_registration: 'Страница со штампом о регистрации по месту жительства',
  snils: 'Зелёная карточка или справка из Госуслуг с номером СНИЛС',
};

/** Сканы паспорта и СНИЛС. Принимаем только фото и PDF: по фото видно, что документ
 * подлинный, а мелкие пересжатые картинки из мессенджеров не читаются. */
const DocumentsSection = ({
  data,
  userId,
  actorId,
  isAdmin,
  onChanged,
}: DocumentsSectionProps) => {
  const { toast } = useToast();
  const refs = useRef<Record<string, HTMLInputElement | null>>({});
  const [uploading, setUploading] = useState<DocType | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const handleReject = async () => {
    setBusy(true);
    try {
      await rejectDocs({ userId, actorId, reason: reason.trim() });
      toast({
        title: 'Документы отклонены',
        description: 'Сотрудник увидит причину и получит новый срок',
      });
      setRejectOpen(false);
      setReason('');
      onChanged();
    } catch (e) {
      toast({
        title: 'Не удалось отклонить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleUnblock = async () => {
    setBusy(true);
    try {
      await unblockDocs(userId, actorId);
      toast({
        title: 'Сотрудник возвращён в работу',
        description: 'Дан новый срок на загрузку документов — 7 дней',
      });
      onChanged();
    } catch (e) {
      toast({
        title: 'Не удалось вернуть в работу',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (docType: DocType, file: File) => {
    if (file.size > 12 * 1024 * 1024) {
      toast({
        title: 'Файл слишком большой',
        description: 'Максимум 12 МБ — снимите документ с меньшим разрешением',
        variant: 'destructive',
      });
      return;
    }
    setUploading(docType);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await uploadUserDoc({
        userId,
        actorId,
        docType,
        fileBase64: base64,
        mimeType: file.type,
        fileName: file.name,
      });
      toast({ title: 'Документ загружен' });
      onChanged();
    } catch (e) {
      toast({
        title: 'Не удалось загрузить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setUploading(null);
    }
  };

  const uploaded = new Map(data.documents.map((d) => [d.docType, d]));

  return (
    <div className="space-y-3 rounded-md border border-border p-4">
      <div>
        <p className="font-bold">Документы</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Нужны для оформления договора. Снимайте при хорошем свете, чтобы все цифры
          читались — по размытому фото данные внести нельзя
        </p>
      </div>

      <div className="space-y-2">
        {data.requiredDocs.map((req) => {
          const doc = uploaded.get(req.docType);
          return (
            <div
              key={req.docType}
              className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border p-3"
            >
              <div className="flex min-w-0 items-start gap-2.5">
                <Icon
                  name={doc ? 'CircleCheck' : 'CircleDashed'}
                  size={18}
                  className={`mt-0.5 shrink-0 ${
                    doc ? 'text-emerald-600' : 'text-muted-foreground'
                  }`}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{req.label}</p>
                  <p className="text-xs text-muted-foreground">{HINTS[req.docType]}</p>
                  {doc && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Загружен {formatDateTime(doc.uploadedAt)}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {isAdmin && doc?.fileUrl && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={doc.fileUrl} target="_blank" rel="noreferrer">
                      <Icon name="Eye" size={14} className="mr-1.5" />
                      Открыть
                    </a>
                  </Button>
                )}
                <input
                  ref={(el) => (refs.current[req.docType] = el)}
                  type="file"
                  accept="image/jpeg,image/png,image/heic,image/webp,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(req.docType, f);
                    e.target.value = '';
                  }}
                />
                <Button
                  variant={doc ? 'ghost' : 'default'}
                  size="sm"
                  disabled={uploading === req.docType}
                  onClick={() => refs.current[req.docType]?.click()}
                >
                  {uploading === req.docType ? (
                    <Icon name="Loader2" size={14} className="mr-1.5 animate-spin" />
                  ) : (
                    <Icon name="Upload" size={14} className="mr-1.5" />
                  )}
                  {doc ? 'Заменить' : 'Загрузить'}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Админу — управление сроком: отклонить некачественные сканы или вернуть
          заблокированного сотрудника в работу. */}
      {isAdmin && (
        <div className="space-y-2 border-t border-border pt-3">
          {data.docsStatus.state === 'blocked' && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <Icon name="ShieldAlert" size={18} className="mt-0.5 shrink-0" />
              <p>
                Доступ приостановлен: документы не сданы в срок. Сотрудник не может
                работать, пока вы не вернёте его в систему
              </p>
            </div>
          )}
          {data.docsStatus.state === 'review' && (
            <p className="text-sm text-muted-foreground">
              Документы сданы и ждут вашей проверки — срок остановлен
            </p>
          )}
          {data.docsStatus.state === 'countdown' && (
            <p className="text-sm text-muted-foreground">
              Осталось дней на загрузку: {data.docsStatus.daysLeft}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {data.docsStatus.state === 'blocked' && (
              <Button size="sm" disabled={busy} onClick={handleUnblock}>
                <Icon name="LockOpen" size={14} className="mr-1.5" />
                Вернуть в работу
              </Button>
            )}
            {uploaded.size > 0 && data.docsStatus.state !== 'done' && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setRejectOpen(true)}
              >
                <Icon name="X" size={14} className="mr-1.5" />
                Отклонить документы
              </Button>
            )}
          </div>

          {rejectOpen && (
            <div className="space-y-2 rounded-md border border-border p-3">
              <Label className="text-sm">Что не так с документами</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Например: на фото паспорта не читается номер — переснимите при дневном свете"
                rows={2}
              />
              <p className="text-xs text-muted-foreground">
                Сотрудник увидит это сообщение и получит новые 7 дней на загрузку
              </p>
              <div className="flex gap-2">
                <Button size="sm" disabled={busy || !reason.trim()} onClick={handleReject}>
                  Отклонить и дать новый срок
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRejectOpen(false)}>
                  Отмена
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Сканы видит только администратор. Они используются исключительно для оформления
        договора и выплат
      </p>
    </div>
  );
};

export default DocumentsSection;