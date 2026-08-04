import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { kioskLoginByCode, type KioskUser, type KioskShift } from '@/lib/kioskApi';
import { playScanSound, playScanErrorSound } from '@/lib/scanSound';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { roleLabels } from '@/lib/roles';
import type { Role } from '@/lib/roles';

/** Терминал цеха (киоск). Полноэкранный экран для планшета в цехе: сотрудник входит
 * сканированием личного QR-кода с бейджа (формат "{id}-{смена}-{дата}"), пароль не нужен.
 * Номер цеха берётся из адреса: /kiosk/1 — терминал первого цеха. */
const KioskTerminal = () => {
  const { workshopId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<KioskUser | null>(null);
  const [shift, setShift] = useState<KioskShift | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loginWithCode = useCallback(
    async (value: string) => {
      if (!value) return;
      setCode('');
      setLoading(true);
      try {
        const data = await kioskLoginByCode(value);
        playScanSound();
        setUser(data.user);
        setShift(data.shift);
      } catch (e) {
        playScanErrorSound();
        toast({
          title: 'Не удалось войти',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    },
    [toast]
  );

  const handleLogin = () => loginWithCode(code.trim());

  // Вход по ссылке из персонального QR сотрудника: /kiosk/1?barcode=3-20-20250513
  useEffect(() => {
    const barcode = searchParams.get('barcode');
    if (barcode && !user && !loading) {
      loginWithCode(barcode.trim());
      searchParams.delete('barcode');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useScannerAutoSubmit(code, handleLogin, !loading && !user);

  useEffect(() => {
    inputRef.current?.focus();
  }, [user]);

  const handleLogout = () => {
    setUser(null);
    setShift(null);
    setCode('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <div className="w-full max-w-xl space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Терминал цеха №{workshopId}</h1>
          <p className="mt-2 text-muted-foreground">
            {user ? 'Вы вошли в систему' : 'Отсканируйте свой QR-код с бейджа'}
          </p>
        </div>

        {!user ? (
          <Card className="border-primary/30 bg-primary/5 shadow-none">
            <CardContent className="space-y-4 pt-6">
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                <Icon name="ScanLine" size={28} />
                <span className="text-lg">Поднесите QR-код к сканеру</span>
              </div>
              <div className="flex gap-2">
                <Input
                  ref={inputRef}
                  autoFocus
                  placeholder="Код сотрудника"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  disabled={loading}
                  className="h-14 text-center font-mono-tech text-lg"
                />
                <Button size="lg" className="h-14" onClick={handleLogin} disabled={loading || !code.trim()}>
                  {loading ? <Icon name="Loader2" size={20} className="animate-spin" /> : 'Войти'}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-border shadow-none">
            <CardContent className="space-y-4 pt-6">
              <div className="flex items-center gap-3">
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
                  {user.name
                    .split(' ')
                    .map((p) => p[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xl font-bold">{user.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {roleLabels[user.role as Role] || user.role}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
                <span className="text-sm text-muted-foreground">Смена:</span>
                {shift?.isOpen ? (
                  <>
                    <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Открыта</Badge>
                    {shift.shiftNumber != null && (
                      <span className="text-sm">Смена №{shift.shiftNumber}</span>
                    )}
                  </>
                ) : (
                  <Badge variant="secondary">Закрыта</Badge>
                )}
              </div>

              <Button variant="outline" size="lg" className="w-full" onClick={handleLogout}>
                <Icon name="LogOut" size={18} className="mr-2" />
                Выйти
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default KioskTerminal;