import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { Button } from '@/components/ui/button';

const navLinks = [
  { label: 'Возможности', id: 'features' },
  { label: 'Модули', id: 'modules' },
  { label: 'Тарифы', id: 'pricing' },
  { label: 'Вопросы', id: 'faq' },
];

interface HeaderProps {
  onLogin: () => void;
}

const Header = ({ onLogin }: HeaderProps) => {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollTo = (id: string) => {
    setMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-background/85 backdrop-blur-lg border-b border-border shadow-sm'
          : 'bg-transparent'
      }`}
    >
      <div className="container flex h-16 items-center justify-between">
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="flex items-center gap-2.5"
        >
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-accent">
            <Icon name="Compass" size={20} />
          </span>
          <span className="text-lg font-extrabold tracking-tight text-primary">
            Ориентир
          </span>
        </button>

        <nav className="hidden md:flex items-center gap-8">
          {navLinks.map((l) => (
            <button
              key={l.id}
              onClick={() => scrollTo(l.id)}
              className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
            >
              {l.label}
            </button>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-3">
          <Button
            variant="ghost"
            onClick={onLogin}
            className="font-semibold text-primary hover:bg-secondary"
          >
            <Icon name="LogIn" size={16} className="mr-1.5" />
            Вход
          </Button>
          <Button
            onClick={onLogin}
            className="bg-accent text-accent-foreground hover:bg-accent/90 font-semibold shadow-sm"
          >
            Попробовать бесплатно
          </Button>
        </div>

        <button
          className="md:hidden grid h-10 w-10 place-items-center rounded-lg text-primary"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Меню"
        >
          <Icon name={menuOpen ? 'X' : 'Menu'} size={22} />
        </button>
      </div>

      {menuOpen && (
        <div className="md:hidden border-t border-border bg-background/95 backdrop-blur-lg animate-fade-in">
          <div className="container flex flex-col gap-1 py-4">
            {navLinks.map((l) => (
              <button
                key={l.id}
                onClick={() => scrollTo(l.id)}
                className="rounded-lg px-3 py-2.5 text-left text-sm font-medium text-foreground hover:bg-secondary"
              >
                {l.label}
              </button>
            ))}
            <div className="mt-2 flex flex-col gap-2">
              <Button variant="outline" onClick={onLogin} className="w-full font-semibold">
                Вход
              </Button>
              <Button
                onClick={onLogin}
                className="w-full bg-accent text-accent-foreground hover:bg-accent/90 font-semibold"
              >
                Попробовать бесплатно
              </Button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};

export default Header;
