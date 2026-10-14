import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import Icon from '@/components/ui/icon';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RADIO_STATIONS, radioById } from '@/lib/radioStations';
import { fetchTvRadioForUser, setTvRadio } from '@/lib/varikiApi';
import RadioLogo from '@/components/crm/variki/radio/RadioLogo';

interface RadioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Выбор волны для телевизора цеха. Открывается из шапки рядом с QR.
 * Включить станцию может только сотрудник с открытой сменой.
 */
const RadioDialog = ({ open, onOpenChange }: RadioDialogProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [stationId, setStationId] = useState('');
  const [shiftOpen, setShiftOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !user?.id) return;
    let stop = false;
    setLoading(true);
    fetchTvRadioForUser(user.id)
      .then((data) => {
        if (stop) return;
        setStationId(data.stationId);
        setShiftOpen(data.shiftOpen);
      })
      .catch(() => {
        if (!stop) {
          toast({ title: 'Не удалось узнать, какая волна сейчас в цехе', variant: 'destructive' });
        }
      })
      .finally(() => {
        if (!stop) setLoading(false);
      });
    return () => {
      stop = true;
    };
  }, [open, user?.id, toast]);

  const choose = async (next: string) => {
    if (!user?.id || saving) return;
    setSaving(true);
    try {
      const saved = await setTvRadio(user.id, next);
      setStationId(saved);
      const station = radioById(saved);
      toast({
        title: station ? `В цехе играет ${station.name}` : 'Радио в цехе выключено',
      });
    } catch (e) {
      toast({
        title: 'Не удалось переключить волну',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const current = radioById(stationId);
  const locked = !loading && !shiftOpen;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="Radio" size={18} />
            Радио в цехе
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {locked
            ? 'Включить волну можно только с открытой сменой. Сначала откройте смену.'
            : 'Волна включается на телевизоре цеха. Выберите станцию — она запустится сразу.'}
        </p>

        <button
          type="button"
          disabled={loading || saving || locked}
          onClick={() => choose('')}
          className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left ${
            !current ? 'border-primary bg-primary/5' : 'border-border bg-card'
          }`}
        >
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
            <Icon name="Pause" size={20} />
          </span>
          <span>
            <span className="block font-semibold">Выключено</span>
            <span className="text-sm text-muted-foreground">Телевизор молчит</span>
          </span>
        </button>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {RADIO_STATIONS.map((station) => {
            const on = station.id === stationId;
            return (
              <button
                key={station.id}
                type="button"
                disabled={loading || saving || locked}
                onClick={() => choose(station.id)}
                className={`flex min-w-0 items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${
                  on
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-border bg-card hover:bg-muted/40'
                }`}
              >
                <RadioLogo station={station} size={48} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{station.name}</span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {station.city}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default RadioDialog;
