import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { fetchOwnAvatar, setOwnAvatar } from '@/lib/usersApi';

/** Телефон снимает по несколько мегабайт. В кружок профиля хватает квадрата 512. */
const shrinkPhoto = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = 512;
      const canvas = document.createElement('canvas');
      canvas.width = side;
      canvas.height = side;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Не удалось подготовить фото'));
        return;
      }
      const scale = Math.max(side / img.width, side / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (side - w) / 2, (side - h) / 2, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Это не фотография'));
    };
    img.src = url;
  });

/** Иконка у QR: своё фото профиля, по нажатию — окно загрузки. */
const MyAvatarButton = () => {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stop = false;
    fetchOwnAvatar()
      .then((url) => {
        if (!stop) setAvatarUrl(url);
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, []);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      setDraft(await shrinkPhoto(file));
    } catch (e) {
      toast({
        title: 'Фото не открылось',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    }
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const res = await setOwnAvatar(draft);
      setAvatarUrl(res.avatarUrl);
      setDraft(null);
      setOpen(false);
      toast({ title: 'Фото профиля сохранено' });
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      toast({
        title: 'Не удалось сохранить фото',
        description:
          message.includes('Неизвестное действие') || message.includes('только: администратор')
            ? 'Загрузка своего фото ещё не подключена на сервере.'
            : message || undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const shown = draft || avatarUrl;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Фото профиля"
        title="Фото профиля"
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
        ) : (
          <span className="flex h-8 w-8 items-center justify-center">
            <Icon name="Camera" size={20} />
          </span>
        )}
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setDraft(null);
        }}
      >
        <DialogContent className="max-w-sm" confirmClose={false}>
          <DialogTitle>Фото профиля</DialogTitle>
          <div className="flex flex-col items-center gap-4">
            <div className="flex h-36 w-36 items-center justify-center overflow-hidden rounded-full border border-border bg-muted">
              {shown ? (
                <img src={shown} alt="" className="h-full w-full object-cover" />
              ) : (
                <Icon name="User" size={48} className="text-muted-foreground" />
              )}
            </div>
            <p className="text-center text-sm text-muted-foreground">
              Это фото появится на пузырьке смены и в дуэли.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                void pick(file);
              }}
            />
            <Button type="button" variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
              Выбрать фото
            </Button>
            <Button type="button" className="w-full" disabled={!draft || busy} onClick={() => void save()}>
              {busy ? 'Сохраняем…' : 'Сохранить'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default MyAvatarButton;
