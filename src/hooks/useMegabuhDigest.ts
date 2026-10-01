import { createElement, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ToastAction } from '@/components/ui/toast';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { isMegabuhRole } from '@/lib/roles';
import { playMegabuhReplySound } from '@/lib/megabuhSound';
import {
  deliverDigestMessage,
  isMegabuhDialogue,
  makeNewsMessage,
  markDigestToastShown,
  needsDigestCheck,
  peekPendingDigest,
  runMegabuhDigestCheck,
  shouldToastDigest,
} from '@/lib/megabuhDigest';

const FIRST_CHECK_MS = 12_000;
const REPEAT_MS = 45_000;

/**
 * Раз в сутки МЕГАБУХ обходит новости OZON / WB / Яндекс Маркета.
 * В чат и всплывашку попадает только когда бухгалтер не переписывается с агентом.
 */
export const useMegabuhDigest = () => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const running = useRef(false);
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  const userId = user?.id;
  const role = user?.role;

  const tick = useRef(async () => {});
  tick.current = async () => {
    if (!userId || !role || !isMegabuhRole(role) || running.current) return;

    const flushPending = () => {
      if (isMegabuhDialogue(userId, role, pathRef.current)) return;
      const pending = peekPendingDigest(userId, role);
      if (!pending) return;
      const msg = makeNewsMessage(pending.content, pending.digestDay, pending.at);
      deliverDigestMessage(userId, role, msg);
      playMegabuhReplySound();
      const onChat = pathRef.current === '/crm/chat';
      if (!onChat && shouldToastDigest(userId, role, pending.digestDay)) {
        const line =
          pending.content
            .split('\n')
            .map((s) => s.trim())
            .find((s) => s && !/^новости маркетплейсов/i.test(s))
          || 'Есть новости OZON, WB и Яндекс Маркета';
        toast({
          title: 'МЕГАБУХ',
          description: line.length > 110 ? `${line.slice(0, 107)}…` : line,
          duration: 9000,
          action: createElement(
            ToastAction,
            { altText: 'Открыть чат', onClick: () => navigate('/crm/chat') },
            'Читать',
          ),
        });
      }
      markDigestToastShown(userId, role, pending.digestDay);
    };

    flushPending();
    if (isMegabuhDialogue(userId, role, pathRef.current) || !needsDigestCheck(userId, role)) return;

    running.current = true;
    try {
      const msg = await runMegabuhDigestCheck(userId, role);
      if (msg) flushPending();
    } catch {
      // Обход фоновый: чат от этого не ломается, повторим в следующем интервале.
    } finally {
      running.current = false;
    }
  };

  useEffect(() => {
    if (!userId || !role || !isMegabuhRole(role)) return undefined;
    const run = () => {
      void tick.current();
    };
    const start = window.setTimeout(run, FIRST_CHECK_MS);
    const iv = window.setInterval(run, REPEAT_MS);
    const onVis = () => {
      if (document.visibilityState === 'visible') run();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [userId, role]);

  useEffect(() => {
    if (!userId || !role || !isMegabuhRole(role)) return;
    if (location.pathname === '/crm/chat') return;
    void tick.current();
  }, [location.pathname, userId, role]);
};
