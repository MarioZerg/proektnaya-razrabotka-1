import { useState } from 'react';
import Header from '@/components/erp/Header';
import Hero from '@/components/erp/Hero';
import LogoStrip from '@/components/erp/LogoStrip';
import Features from '@/components/erp/Features';
import Modules from '@/components/erp/Modules';
import Pricing from '@/components/erp/Pricing';
import Faq from '@/components/erp/Faq';
import CtaBanner from '@/components/erp/CtaBanner';
import Footer from '@/components/erp/Footer';
import LoginDialog from '@/components/erp/LoginDialog';

const Index = () => {
  const [loginOpen, setLoginOpen] = useState(false);
  const openLogin = () => setLoginOpen(true);

  return (
    <div className="min-h-screen bg-background">
      <Header onLogin={openLogin} />
      <main>
        <Hero onLogin={openLogin} />
        <LogoStrip />
        <Features />
        <Modules />
        <Pricing onLogin={openLogin} />
        <Faq />
        <CtaBanner onLogin={openLogin} />
      </main>
      <Footer />
      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} />
    </div>
  );
};

export default Index;
