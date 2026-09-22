import { useEffect } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { useAuth } from '@/context/AuthContext';
import ProsecutorCaseHeader from '@/components/legal/ProsecutorCaseHeader';
import ProsecutorCasePosition from '@/components/legal/ProsecutorCasePosition';
import ProsecutorCaseFacts from '@/components/legal/ProsecutorCaseFacts';
import ProsecutorCaseMaterials from '@/components/legal/ProsecutorCaseMaterials';

/**
 * Материалы по обращению Новиковой А.А. в прокуратуру Дзержинского района г. Ярославля
 * (требование от 17.09.2026 № 202-4260-2026/20780003/Исорг714-26).
 *
 * Раздел закрыт наглухо: только администратор и только по прямой ссылке. В меню его нет,
 * от поисковиков закрыт и в robots.txt, и мета-тегом noindex прямо на странице — здесь
 * персональные данные человека, суммы переводов и позиция ИП по проверке. Такое не должно
 * попасть ни в выдачу, ни на глаза сотрудникам.
 *
 * Страница — не «красивая витрина», а рабочий комплект к визиту в прокуратуру: готовые
 * пояснения одним PDF, платёжные квитанции и короткая хронология, чтобы перед приёмом
 * можно было освежить факты и даты.
 *
 * Разбита на четыре блока по назначению:
 *   · ProsecutorCaseHeader    — шапка и документы на печать;
 *   · ProsecutorCasePosition  — позиция ИП по существу;
 *   · ProsecutorCaseFacts     — выплаты и хронология;
 *   · ProsecutorCaseMaterials — чек-лист и файлы дела.
 * Сама фактура (суммы, даты, номера квитанций) — в prosecutorCaseData.
 */
const ProsecutorCase = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // Мета-тег ставим прямо здесь: index.html один на все страницы, а закрыть нужно
  // только эту. Убираем за собой при уходе, иначе noindex останется висеть на
  // остальных разделах — SPA страницу не перезагружает.
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow, noarchive, nosnippet';
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  if (!isAdmin) {
    return (
      <CrmLayout>
        <p className="text-sm text-muted-foreground">Раздел доступен только администратору.</p>
      </CrmLayout>
    );
  }

  return (
    <CrmLayout>
      <div className="mx-auto max-w-4xl space-y-6 pb-12">
        <ProsecutorCaseHeader />
        <ProsecutorCasePosition />
        <ProsecutorCaseFacts />
        <ProsecutorCaseMaterials />
      </div>
    </CrmLayout>
  );
};

export default ProsecutorCase;
