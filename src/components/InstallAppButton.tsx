import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';

/**
 * Кнопка «Скачать для Android».
 *
 * Отдаёт готовый файл приложения. Сотруднику не нужно искать установку в меню
 * браузера: нажал, файл скачался, открыл — приложение на экране.
 *
 * Кнопка прячется, когда приложение уже открыто как приложение, и на компьютерах
 * с iPhone/iPad, где файл всё равно не установить.
 */
const InstallAppButton = () => {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (standalone || ios) setHidden(true);
  }, []);

  if (hidden) return null;

  return (
    <div className="space-y-1.5">
      <Button asChild variant="outline" className="h-12 w-full rounded-sm">
        <a href="/download/megatul.apk" download="megatul.apk">
          <Icon name="Smartphone" size={18} className="mr-2" />
          Скачать для Android
        </a>
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Откройте скачанный файл и разрешите установку — приложение появится на экране
      </p>
    </div>
  );
};

export default InstallAppButton;
