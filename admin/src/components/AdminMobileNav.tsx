import { NavLink, useLocation } from 'react-router-dom';
import { Icon, type IconName } from './ui';

const MOBILE_NAV: { to: string; label: string; icon: IconName; match: string; roles: string[] }[] = [
  { to: '/telecaller/dashboard', label: 'Dashboard', icon: 'dashboard', match: '/telecaller/dashboard', roles: ['TELECALLER'] },
  { to: '/audit/dashboard', label: 'QC Dashboard', icon: 'dashboard', match: '/audit/dashboard', roles: ['AUDITOR'] },
  { to: '/audit', label: 'QA Queue', icon: 'fact_check', match: '/audit', roles: ['AUDITOR'] },
  { to: '/', label: 'Dashboard', icon: 'dashboard', match: '/', roles: ['ADMIN'] },
  { to: '/records', label: 'Records', icon: 'folder_open', match: '/records', roles: ['ADMIN', 'MANAGER'] },
  { to: '/telecaller/records', label: 'Calling Queue', icon: 'call', match: '/telecaller/records', roles: ['TELECALLER'] },
  { to: '/map', label: 'Map', icon: 'pin_drop', match: '/map', roles: ['ADMIN', 'MANAGER', 'AUDITOR'] },
  { to: '/logs', label: 'Logs', icon: 'receipt_long', match: '/logs', roles: ['ADMIN'] },
  { to: '/settings', label: 'Settings', icon: 'settings', match: '/settings', roles: ['ADMIN'] },
];

/** Role-scoped mobile bottom navigation — admins see everything, office
 * roles (manager / auditor) a trimmed list. */
export function AdminMobileNav({ role }: { role: string }) {
  const location = useLocation();

  return (
    <nav className="admin-mobile-nav" aria-label="Mobile Navigation">
      {MOBILE_NAV.filter(item => item.roles.includes(role)).map((item) => {
        const isActive =
          item.match === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(item.match) && !(item.to === '/audit' && location.pathname === '/audit/dashboard');

        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={`admin-mobile-nav-item ${isActive ? 'active' : ''}`}
            title={item.label}
          >
            <Icon
              name={item.icon}
              size={20}
              className={isActive ? 'nav-icon-active' : ''}
            />
            <span className="admin-mobile-nav-label">{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
