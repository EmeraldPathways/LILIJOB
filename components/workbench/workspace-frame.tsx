"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  Compass,
  History,
  LogOut,
  Mail,
  Menu,
  Settings2,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import type { ChatGPTUser } from "../../app/chatgpt-auth";

type WorkspaceFrameProps = {
  user: ChatGPTUser;
  children: ReactNode;
};

const navigationGroups = [
  {
    label: "Workspace",
    links: [
      { label: "Companies", href: "/", icon: Building2 },
      { label: "Email", href: "/email", icon: Mail },
      { label: "AI assistant", href: "/ai", icon: Sparkles },
    ],
  },
  {
    label: "Manage",
    links: [
      { label: "Imports", href: "/imports", icon: Upload },
      { label: "Research history", href: "/history", icon: History },
      { label: "Settings", href: "/settings", icon: Settings2 },
    ],
  },
] as const;

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/" || pathname.startsWith("/company/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function WorkspaceFrame({ user, children }: WorkspaceFrameProps) {
  const pathname = usePathname() ?? "/";
  const [openPath, setOpenPath] = useState<string | null>(null);
  const mobileOpen = openPath === pathname;
  const drawerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!mobileOpen) return;
    const drawer = drawerRef.current;
    const menu = menuRef.current;
    const controls = () => Array.from(drawer?.querySelectorAll<HTMLElement>('a[href],button') ?? []);
    controls()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if(event.key === 'Escape'){event.preventDefault();setOpenPath(null);}
      if(event.key !== 'Tab') return;
      const nodes = controls(); const first = nodes[0]; const last = nodes[nodes.length-1];
      if(event.shiftKey && document.activeElement === first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey && document.activeElement === last){event.preventDefault();first?.focus();}
    };
    const desktop = window.matchMedia('(min-width:821px)');
    const resize = () => {if(desktop.matches)setOpenPath(null);};
    document.addEventListener('keydown', onKey); desktop.addEventListener('change', resize);
    return () => {document.removeEventListener('keydown', onKey);desktop.removeEventListener('change', resize);menu?.focus();};
  }, [mobileOpen]);

  return (
    <div className="workspace-frame">
      <header className="workspace-frame__topbar" inert={mobileOpen}>
        <button
          ref={menuRef}
          className="workspace-frame__menu-button"
          type="button"
          aria-label="Open navigation"
          aria-controls="workspace-primary-navigation"
          aria-expanded={mobileOpen}
          onClick={() => setOpenPath(pathname)}
        >
          <Menu size={18} aria-hidden="true" />
        </button>

        <Link className="workspace-frame__brand" href="/">
          <span className="workspace-frame__brand-mark" aria-hidden="true">
            <Compass size={19} />
          </span>
          <span>
            <strong>Dublin Tech Compass</strong>
            <small>Private research workspace</small>
          </span>
        </Link>

        <div className="workspace-frame__topbar-spacer" />

        <div
          className="workspace-frame__top-account"
          aria-label={`Signed in as ${user.email}`}
        >
          <span className="workspace-frame__avatar" aria-hidden="true">
            {user.displayName.slice(0, 1).toUpperCase()}
          </span>
          <span className="workspace-frame__account-copy">
            <strong>{user.displayName}</strong>
            <small>{user.email}</small>
          </span>
        </div>

        <a
          className="workspace-frame__signout"
          href="/signout-with-chatgpt?return_to=%2F"
          target="_top"
        >
          <LogOut size={15} aria-hidden="true" />
          <span>Sign out</span>
        </a>
      </header>

      <div className="workspace-frame__layout">
        {mobileOpen && (
          <button
            className="workspace-frame__scrim"
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpenPath(null)}
          />
        )}

        <aside
          ref={drawerRef}
          role={mobileOpen ? "dialog" : undefined}
          aria-modal={mobileOpen ? true : undefined}
          className={`workspace-frame__sidebar${mobileOpen ? " workspace-frame__sidebar--open" : ""}`}
          id="workspace-primary-navigation"
          aria-label="Primary navigation"
        >
          <div className="workspace-frame__sidebar-heading">
            <span>Navigation</span>
            <button
              className="workspace-frame__close-button"
              type="button"
              aria-label="Close navigation"
              onClick={() => setOpenPath(null)}
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>

          {navigationGroups.map((group) => (
            <nav
              className="workspace-frame__nav-group"
              aria-label={group.label}
              key={group.label}
            >
              <p className="workspace-frame__group-label">{group.label}</p>
              <div className="workspace-frame__nav-links">
                {group.links.map(({ label, href, icon: Icon }) => {
                  const active = isActivePath(pathname, href);

                  return (
                    <Link
                      className={`workspace-frame__nav-link${active ? " workspace-frame__nav-link--active" : ""}`}
                      href={href}
                      aria-current={active ? "page" : undefined}
                      key={href}
                      onClick={() => setOpenPath(null)}
                    >
                      <Icon size={17} aria-hidden="true" />
                      <span>{label}</span>
                    </Link>
                  );
                })}
              </div>
            </nav>
          ))}
        </aside>

        {pathname.startsWith("/company/") ? (
          <div className="workspace-frame__content" inert={mobileOpen}>{children}</div>
        ) : (
          <main className="workspace-frame__content" inert={mobileOpen}>{children}</main>
        )}
      </div>
    </div>
  );
}
