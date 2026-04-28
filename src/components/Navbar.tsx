import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { auth } from '../lib/firebase';
import { Button } from './ui/button';
import { LayoutDashboard, Home, LogOut, Terminal, Github, Globe } from 'lucide-react';

export default function Navbar() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await auth.signOut();
    navigate('/auth');
  };

  return (
    <nav className="border-b bg-white">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-bold text-xl tracking-tight">
          <Terminal className="w-6 h-6 text-primary" />
          <span>SimulPortal</span>
        </Link>

        {user && (
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" className="gap-2" asChild>
              <Link to="/">
                <Home className="w-4 h-4" />
                Home
              </Link>
            </Button>
            <Button variant="ghost" size="sm" className="gap-2" asChild>
              <Link to="/import">
                <Github className="w-4 h-4" />
                Import
              </Link>
            </Button>
            <Button variant="ghost" size="sm" className="gap-2" asChild>
              <Link to="/portal">
                <Globe className="w-4 h-4" />
                Portal
              </Link>
            </Button>
            <Button variant="ghost" size="sm" className="gap-2" asChild>
              <Link to="/dashboard">
                <LayoutDashboard className="w-4 h-4" />
                Analytics
              </Link>
            </Button>
            <div className="h-6 w-[1px] bg-neutral-200 mx-2" />
            <span className="text-sm text-neutral-500 mr-2 hidden sm:inline">
              {user.email}
            </span>
            <Button variant="outline" size="sm" onClick={handleLogout} className="gap-2">
              <LogOut className="w-4 h-4" />
              Logout
            </Button>
          </div>
        )}
      </div>
    </nav>
  );
}
