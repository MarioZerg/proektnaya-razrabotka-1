import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useSidebar } from '@/components/ui/sidebar';

/** Закрывает выехавшее меню на телефоне после перехода в раздел.
 *
 * Зачем: на телефоне меню выезжает поверх страницы. Раньше после нажатия на пункт оно
 * так и оставалось открытым и закрывало собой весь экран — приходилось искать узкую
 * полоску сбоку и попадать по ней пальцем, чтобы увидеть саму страницу. Теперь меню
 * убирается само, как только человек выбрал раздел.
 *
 * Живёт отдельным компонентом, потому что useSidebar работает только ВНУТРИ
 * SidebarProvider, а сам провайдер объявлен в CrmLayout. */
const CloseSidebarOnNavigate = () => {
  const { pathname } = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
  // Первый заход не считается переходом — иначе меню «моргало» бы при открытии CRM.
  const previous = useRef(pathname);

  useEffect(() => {
    if (previous.current !== pathname) {
      previous.current = pathname;
      if (isMobile) setOpenMobile(false);
    }
  }, [pathname, isMobile, setOpenMobile]);

  return null;
};

export default CloseSidebarOnNavigate;
