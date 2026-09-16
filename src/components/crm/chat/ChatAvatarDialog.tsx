import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import ChatAvatar from '@/components/crm/chat/ChatAvatar';
import { prepareAvatar } from '@/lib/avatarImage';

interface ChatAvatarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  /** Что стоит сейчас: своё фото, снимок из MAX или ничего. */
  currentUrl: string | null;
  /** Фото поставлено вручную — значит, его можно убрать. */
  ownAvatar: boolean;
  saving: boolean;
  /** null — убрать своё фото. */
  onSave: (base64: string | null) => Promise<void>;
}

/**
 * Своё фото — сотрудник ставит его сам, не дожидаясь администратора.
 *
 * Раньше фотографию мог загрузить только админ через карточку сотрудника, и до него
 * доходили единицы: в чате висели кружки с инициалами, а в переписке двух Лен и трёх
 * Наташ не разобрать, кто кому отвечает. Просить админа из-за такой мелочи никто не
 * шёл — поэтому смена фото живёт там же, где переписка.
 */
const ChatAvatarDialog = ({
  open,
  onOpenChange,
  name,
  currentUrl,
  ownAvatar,
  saving,
  onSave,
}: ChatAvatarDialogProps) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [preparing, setPreparing] = useState(false);

  // Закрыли окно — забываем выбранный снимок: в следующий раз человек открывает
  // его заново и не должен наткнуться на прошлую неудачную попытку.
  useEffect(() => {
    if (!open) {
      setPreview(null);
      setError('');
    }
  }, [open]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setPreparing(true);
    try {
      // Кадр с телефона обрезается и сжимается здесь, в браузере: на сервер уходит
      // около 30 КБ вместо шести мегабайт, и загрузка идёт даже на слабой связи.
      setPreview(await prepareAvatar(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось открыть фотографию');
    } finally {
      setPreparing(false);
    }
  };

  const apply = async (base64: string | null) => {
    setError('');
    try {
      await onSave(base64);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить фото');
    }
  };

  const shown = preview || currentUrl;
  const busy = saving || preparing;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Подтверждение «Закрыть окно?» нужно только когда снимок выбран, но не
          сохранён. Спрашивать его у человека, который просто заглянул посмотреть
          своё фото, — лишний вопрос на пустом месте. */}
      <DialogContent className="max-w-sm" confirmClose={Boolean(preview)}>
        <DialogHeader>
          <DialogTitle>Ваше фото</DialogTitle>
          <DialogDescription>
            Его увидят коллеги в чате — по лицу вас узнают быстрее, чем по инициалам
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          <ChatAvatar name={name} url={shown} size="lg" />

          {error && (
            <p className="flex items-center gap-1.5 text-center text-sm text-destructive">
              <Icon name="TriangleAlert" size={14} className="shrink-0" />
              {error}
            </p>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              // Поле сбрасываем сразу: без этого выбор того же файла второй раз
              // (например, после ошибки) не вызывает событие и кнопка выглядит сломанной.
              e.target.value = '';
              await pick(file);
            }}
          />

          <div className="flex w-full flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <Icon
                name={preparing ? 'Loader2' : 'Camera'}
                size={16}
                className={`mr-2 ${preparing ? 'animate-spin' : ''}`}
              />
              {preparing ? 'Готовим фото...' : shown ? 'Выбрать другое фото' : 'Выбрать фото'}
            </Button>

            {preview && (
              <Button type="button" disabled={busy} onClick={() => apply(preview)}>
                <Icon
                  name={saving ? 'Loader2' : 'Check'}
                  size={16}
                  className={`mr-2 ${saving ? 'animate-spin' : ''}`}
                />
                {saving ? 'Сохраняем...' : 'Поставить это фото'}
              </Button>
            )}

            {ownAvatar && !preview && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={busy}
                onClick={() => apply(null)}
              >
                <Icon name="Trash2" size={16} className="mr-2" />
                Убрать фото
              </Button>
            )}
          </div>

          <p className="text-center text-xs text-muted-foreground">
            Подойдёт обычный снимок с телефона — лишнее обрежется по центру автоматически
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ChatAvatarDialog;
