import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import { roleLabels, type Role } from '@/lib/roles';

/**
 * Полоса «вы смотрите панель сотрудника».
 *
 * Висит поверх всех страниц, пока администратор работает в чужом аккаунте. Нужна
 * именно заметная: без неё легко забыть, в чьей учётной записи находишься, и,
 * например, закрыть смену не тому человеку или списать материал не с того рулона.
 */
const ImpersonationBar = () => {
  const { user, stopImpersonation } = useAuth();
  const navigate = useNavigate();

  if (!user?.isImpersonated) return null;

  const handleReturn = () => {
    stopImpersonation();
    // Возвращаем на список сотрудников — именно оттуда админ и заходил в чужой
    // аккаунт. Раньше здесь стоял несуществующий адрес /employees, и выход из
    // режима просмотра приводил на страницу 404.
    navigate('/crm/settings/users');
  };

  return (
    <div className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-500 px-3 py-2 text-center text-sm text-amber-950">
      <span className="flex items-center gap-2">
        <Icon name="Eye" size={16} />
        <span>
          Вы в аккаунте <strong>{user.name}</strong>
          {user.role ? ` — ${roleLabels[user.role as Role] || user.role}` : ''}
        </span>
      </span>
      <Button
        size="sm"
        variant="secondary"
        className="h-7 bg-amber-950 text-amber-50 hover:bg-amber-900"
        onClick={handleReturn}
      >
        Вернуться к себе
      </Button>
    </div>
  );
};

export default ImpersonationBar;