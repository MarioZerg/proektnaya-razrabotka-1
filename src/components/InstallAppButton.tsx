import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';

/**
 * Кнопка «Скачать для Android».
 *
 * Отдаёт готовый файл приложения. Сотруднику не нужно искать установку в меню
 * браузера: нажал, файл скачался, открыл — приложение на экране.
 *
 * Кнопка видна всегда. Раньше она пряталась, если система уже открыта с ярлыка,
 * — но тогда её не видели и те, кто заходил с ярлыка старой версии, чтобы скачать
 * настоящее приложение.
 */
const InstallAppButton = () => (
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

export default InstallAppButton;
