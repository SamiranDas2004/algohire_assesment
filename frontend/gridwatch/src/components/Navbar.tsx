import { NavLink, useNavigate } from 'react-router-dom';
import { Activity, Bell, LayoutDashboard, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Button } from './ui/button';
import { Badge } from './ui/badge';

export function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <nav className="h-14 bg-slate-900 border-b border-slate-800 flex items-center px-6 gap-6 sticky top-0 z-50">
      <div className="flex items-center gap-2 mr-2">
        <div className="p-1.5 bg-blue-500/20 rounded-lg border border-blue-500/20">
          <Activity className="w-4 h-4 text-blue-400" />
        </div>
        <span className="font-bold text-white">GridWatch</span>
      </div>

      <NavLink
        to="/dashboard"
        className={({ isActive }) =>
          `flex items-center gap-1.5 text-sm font-medium transition-colors ${isActive ? 'text-white' : 'text-slate-400 hover:text-white'}`
        }
      >
        <LayoutDashboard className="w-4 h-4" />
        Dashboard
      </NavLink>

      <NavLink
        to="/alerts"
        className={({ isActive }) =>
          `flex items-center gap-1.5 text-sm font-medium transition-colors ${isActive ? 'text-white' : 'text-slate-400 hover:text-white'}`
        }
      >
        <Bell className="w-4 h-4" />
        Alerts
      </NavLink>

      <div className="ml-auto flex items-center gap-3">
        <div className="text-right">
          <p className="text-sm text-white font-medium leading-none">{user?.name}</p>
          <div className="flex items-center justify-end gap-1 mt-1">
            <Badge variant={user?.role === 'supervisor' ? 'escalated' : 'default'} className="text-xs py-0">
              {user?.role}
            </Badge>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => { logout(); navigate('/login'); }}>
          <LogOut className="w-4 h-4" />
        </Button>
      </div>
    </nav>
  );
}
