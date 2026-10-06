import type { AccessProfile } from '@receptly/shared';
import { useState, useEffect, useRef, Suspense } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  Zap,
  Workflow,
  FileText,
  BookOpen,
  ShoppingBag,
  CalendarDays,
  ShieldCheck,
  CreditCard,
  CalendarClock,
  BarChart3,
  ScrollText,
  Smartphone,
  Settings,
  Bell,
  LogOut,
  ContactRound,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { WhatsAppStatus, ActivityLog } from '@receptly/shared';
import { useAuth, logout } from '../lib/auth';
import { api } from '../lib/api';
import { useRealtime } from '../lib/realtime';
import { Brand, Button, Avatar, ConnectionStatus, Dialog, Skeleton, ErrorState, toast } from './ui';
const groups = [
  {
    label: 'MAIN',
    items: [
      ['Overview', '', LayoutDashboard],
      ['Inbox', 'inbox', MessageSquare],
      ['Leads', 'leads', Users],
    ],
  },
  {
    label: 'AUTOMATION',
    items: [
      ['Auto replies', 'rules', Zap],
      ['Automations', 'automations', Workflow],
      ['Templates', 'templates', FileText],
      ['Knowledge base', 'knowledge-base', BookOpen],
      ['Catalog', 'catalog', ShoppingBag],
      ['Schedule', 'schedule', CalendarClock],
      ['Holidays', 'holidays', CalendarDays],
      ['Contacts', 'contacts', ContactRound],
    ],
  },
  {
    label: 'INSIGHTS',
    items: [
      ['Analytics', 'analytics', BarChart3],
      ['Activity logs', 'logs', ScrollText],
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      ['WhatsApp', 'whatsapp', Smartphone],
      ['Billing', 'billing', CreditCard],
      ['Settings', 'settings', Settings],
    ],
  },
];
export function Protected() {
  const { user, ready } = useAuth();
  if (!ready) return <Skeleton />;
  if (!user) return <Navigate to="/login" replace />;
  return <DashboardLayout />;
}
function DashboardLayout() {
  const user = useAuth((s) => s.user)!;
  const location = useLocation();
  const access = useQuery({
    queryKey: ['account', 'access', user.uid],
    queryFn: () => api<{ admin: boolean; access: AccessProfile }>('account/access'),
    refetchInterval: 30000,
    retry: false,
  });
  const [drawer, setDrawer] = useState(false);
  const [drawerClosing, setDrawerClosing] = useState(false);
  const drawerCloseTimer = useRef<number | null>(null);
  const drawerOpenRef = useRef(false);
  const [notifications, setNotifications] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('receptly.sidebarCollapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [accountOpen, setAccountOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  function openDrawer() {
    if (drawerCloseTimer.current !== null) window.clearTimeout(drawerCloseTimer.current);
    drawerOpenRef.current = true;
    setDrawerClosing(false);
    setDrawer(true);
  }
  function closeDrawer() {
    if (!drawerOpenRef.current) return;
    setDrawerClosing(true);
    if (drawerCloseTimer.current !== null) window.clearTimeout(drawerCloseTimer.current);
    drawerCloseTimer.current = window.setTimeout(() => {
      drawerOpenRef.current = false;
      setDrawer(false);
      setDrawerClosing(false);
      drawerCloseTimer.current = null;
    }, 240);
  }
  useEffect(() => {
    closeDrawer();
    setAccountOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeMobileDrawer = () => {
      if (desktop.matches) closeDrawer();
    };
    desktop.addEventListener('change', closeMobileDrawer);
    return () => {
      desktop.removeEventListener('change', closeMobileDrawer);
      if (drawerCloseTimer.current !== null) window.clearTimeout(drawerCloseTimer.current);
    };
  }, []);
  useEffect(() => {
    if (!accountOpen) return;
    accountRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const close = (event: PointerEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [accountOpen]);
  async function signOutAccount() {
    setSigningOut(true);
    try {
      await logout();
    } catch {
      toast('Unable to sign out. Please try again.', 'error');
    } finally {
      setSigningOut(false);
    }
  }
  const status = useQuery({
    queryKey: ['whatsapp'],
    queryFn: () => api<WhatsAppStatus>('whatsapp/status'),
    refetchInterval: 30000,
  });
  const logs = useQuery({
    queryKey: ['logs', 'notifications'],
    queryFn: () => api<ActivityLog[]>('logs?limit=20'),
  });
  useRealtime();
  const activeTitle =
    location.pathname === '/dashboard/admin'
      ? 'Admin panel'
      : groups
          .flatMap((g) => g.items)
          .find((i) => location.pathname === `/dashboard${i[1] ? `/${i[1]}` : ''}`)?.[0] ||
        'Workspace';
  const sidebar = (
    <>
      <Link
        to="/"
        className="sidebar-brand"
        aria-label="Receptly home"
        onClick={closeDrawer}
      >
        <Brand />
      </Link>
      <Button
        className="sidebar-collapse"
        variant="ghost"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
        onClick={() => {
          setCollapsed(!collapsed);
          try {
            localStorage.setItem('receptly.sidebarCollapsed', String(!collapsed));
          } catch {
            /* Preference storage is optional. */
          }
        }}
      >
        {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
      </Button>
      <div className="workspace-label">
        <span className="workspace-icon">R</span>
        <div>
          My workspace<small>Business account</small>
        </div>
      </div>
      <nav aria-label="Dashboard navigation">
        {access.data?.admin && (
          <div className="nav-group">
            <small>PLATFORM</small>
            <NavLink
              to="/dashboard/admin"
              end
              title="Admin panel"
              aria-label="Admin panel"
              onClick={closeDrawer}
            >
              <ShieldCheck size={18} />
              <span className="nav-label">Admin panel</span>
            </NavLink>
          </div>
        )}
        {groups.map((group) => (
          <div className="nav-group" key={group.label}>
            <small>{group.label}</small>
            {group.items.map(([label, url, Icon]) => {
              const I = Icon as typeof Users;
              return (
                <NavLink
                  end
                  to={`/dashboard${url ? `/${url}` : ''}`}
                  key={String(url)}
                  title={String(label)}
                  aria-label={String(label)}
                  onClick={() => {
                    closeDrawer();
                  }}
                >
                  <I size={18} />
                  <span className="nav-label">{String(label)}</span>
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="sidebar-account">
        <div>
          <Avatar name={user.displayName || user.email || 'You'} photoURL={user.photoURL} />
          <span>
            {user.displayName || 'My account'}
            <small>
              {user.email} · {access.data?.access?.tier === 'pro' ? 'Pro' : 'Free'}
            </small>
          </span>
          <Button
            variant="ghost"
            aria-label="Sign out"
            disabled={signingOut}
            onClick={() => void signOutAccount()}
          >
            <LogOut size={17} />
          </Button>
        </div>
      </div>
    </>
  );
  return (
    <div className={`dashboard-layout ${collapsed ? 'sidebar-is-collapsed' : ''}`}>
      <aside className="desktop-sidebar">{sidebar}</aside>
      {drawer && (
        <Dialog
          className={`navigation-drawer ${drawerClosing ? 'is-closing' : ''}`}
          title={String(activeTitle)}
          onClose={closeDrawer}
        >
          <div className="mobile-sidebar">{sidebar}</div>
        </Dialog>
      )}
      <div className="dashboard-workspace">
        <header className="app-header">
          <div>
            <Button
              className="mobile-menu"
              variant="ghost"
              aria-label={drawer ? 'Close navigation' : 'Open navigation'}
              aria-expanded={drawer}
              onClick={() => (drawer ? closeDrawer() : openDrawer())}
            >
              <span className="navigation-toggle-lines" aria-hidden="true"><i /><i /></span>
            </Button>
            <span className="desktop-page-name">{String(activeTitle)}</span>
            <Link to="/" className="mobile-app-name" aria-label="Receptly home">
              Receptly.
            </Link>
          </div>
          <div>
            <Link to="/dashboard/whatsapp" className="header-connection">
              <ConnectionStatus status={status.data?.status} failed={status.isError} />
            </Link>
            <Button
              variant="ghost"
              aria-label="Notifications"
              onClick={() => setNotifications(true)}
            >
              <Bell size={19} />
              {logs.data?.some(
                (l) =>
                  l.severity === 'warning' || l.severity === 'error' || l.type === 'lead_created',
              ) && <i className="notification-dot" />}
            </Button>
            <div
              className="account-menu-wrap"
              ref={accountRef}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setAccountOpen(false);
                  accountRef.current?.querySelector<HTMLButtonElement>('.account-trigger')?.focus();
                }
                if (accountOpen && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault();
                  const items = Array.from(
                    accountRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') || [],
                  );
                  const index = items.indexOf(document.activeElement as HTMLElement);
                  const next =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? items.length - 1
                        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) %
                          items.length;
                  items[next]?.focus();
                }
              }}
            >
              <Button
                className="account-trigger"
                variant="ghost"
                aria-label="Account menu"
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                onClick={() => setAccountOpen(!accountOpen)}
              >
                <Avatar name={user.displayName || user.email || 'You'} photoURL={user.photoURL} />
              </Button>
              {accountOpen && (
                <div className="account-dropdown" role="menu" aria-label="Account">
                  <div className="account-summary">
                    <strong>{user.displayName || 'My account'}</strong>
                    <small>
                      {user.email} · {access.data?.access?.tier === 'pro' ? 'Pro' : 'Free'}
                    </small>
                  </div>
                  <Link
                    role="menuitem"
                    to="/dashboard/settings"
                    onClick={() => setAccountOpen(false)}
                  >
                    <Settings size={17} /> Settings
                  </Link>
                  <Button
                    role="menuitem"
                    variant="ghost"
                    disabled={signingOut}
                    onClick={() => void signOutAccount()}
                  >
                    <LogOut size={17} /> {signingOut ? 'Signing out…' : 'Sign out'}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </header>
        <div
          className={`dashboard-content ${location.pathname.includes('/inbox') ? 'inbox-content' : ''}`}
        >
          <Suspense fallback={<Skeleton />}>
            <Outlet />
          </Suspense>
        </div>
      </div>
      {notifications && (
        <Dialog title="Notifications" onClose={() => setNotifications(false)}>
          {logs.isLoading ? (
            <Skeleton variant="list" />
          ) : logs.isError ? (
            <ErrorState error={logs.error} retry={() => void logs.refetch()} />
          ) : logs.data?.filter(
              (l) =>
                l.severity === 'warning' || l.severity === 'error' || l.type === 'lead_created',
            ).length ? (
            logs.data
              .filter(
                (l) =>
                  l.severity === 'warning' || l.severity === 'error' || l.type === 'lead_created',
              )
              .map((l) => (
                <div className="notification-item" key={l.id}>
                  <strong>{l.message}</strong>
                  <small>{new Date(l.timestamp).toLocaleString()}</small>
                  <Link to="/dashboard/logs" onClick={() => setNotifications(false)}>
                    View activity
                  </Link>
                </div>
              ))
          ) : (
            <p>
              You’re all caught up. Important connection and conversation alerts will appear here.
            </p>
          )}
        </Dialog>
      )}
    </div>
  );
}
