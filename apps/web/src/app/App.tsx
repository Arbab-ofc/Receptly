import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { PublicLayout, Home, Features, Contact, Legal, Documentation } from '../pages/Marketing';
import { AuthPage } from '../pages/Auth';
import { Protected } from '../components/DashboardLayout';
import { Skeleton, Toast, Brand } from '../components/ui';
import { updatePageMetadata } from '../lib/page-metadata';
const Pricing = lazy(() => import('../pages/Pricing'));
const Billing = lazy(() => import('../pages/Billing'));
const Admin = lazy(() => import('../pages/Admin'));
const Overview = lazy(() => import('../pages/Overview'));
const Resources = lazy(() => import('../pages/Resources'));
const Schedule = lazy(() => import('../pages/Schedule'));
const Settings = lazy(() => import('../pages/Settings'));
const WhatsApp = lazy(() => import('../pages/WhatsApp'));
const Inbox = lazy(() => import('../pages/Inbox'));
const Automations = lazy(() => import('../pages/Automations'));
const Analytics = lazy(() => import('../pages/Insights').then((m) => ({ default: m.Analytics })));
const Logs = lazy(() => import('../pages/Insights').then((m) => ({ default: m.Logs })));
export function App() {
  const location = useLocation();
  useEffect(() => {
    updatePageMetadata(location.pathname);
  }, [location.pathname]);
  return (
    <>
      <Suspense fallback={<Skeleton />}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/features" element={<Features />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/login" element={<AuthPage />} />
            <Route path="/register" element={<AuthPage signup />} />
            <Route path="/signup" element={<AuthPage signup />} />
            <Route path="/privacy" element={<Legal type="privacy" />} />
            <Route path="/terms" element={<Legal type="terms" />} />
            <Route path="/documentation" element={<Documentation />} />
            <Route
              path="*"
              element={
                <div className="container not-found">
                  <Brand />
                  <span className="eyebrow">404 · A LITTLE OFF TRACK</span>
                  <h1>
                    Let’s get you
                    <br />
                    back to the conversation.
                  </h1>
                  <p>The page you’re looking for isn’t here.</p>
                  <div>
                    <Link className="button button--primary" to="/">
                      Back home
                    </Link>
                    <Link className="button button--outline" to="/dashboard">
                      Go to dashboard
                    </Link>
                  </div>
                </div>
              }
            />
          </Route>
          <Route path="/dashboard" element={<Protected />}>
            <Route index element={<Overview />} />
            <Route path="billing" element={<Billing />} />
            <Route path="admin" element={<Admin />} />
            <Route path="inbox" element={<Inbox />} />
            <Route path="rules" element={<Resources kind="rules" />} />
            <Route path="templates" element={<Resources kind="templates" />} />
            <Route path="knowledge-base" element={<Resources kind="knowledge-base" />} />
            <Route path="contacts" element={<Resources kind="contacts" />} />
            <Route path="leads" element={<Resources kind="leads" />} />
            <Route path="automations" element={<Automations />} />
            <Route path="catalog" element={<Resources kind="catalog" />} />
            <Route path="holidays" element={<Resources kind="holidays" />} />
            <Route path="schedule" element={<Schedule />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="logs" element={<Logs />} />
            <Route path="whatsapp" element={<WhatsApp />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </Suspense>
      <Toast />
    </>
  );
}
