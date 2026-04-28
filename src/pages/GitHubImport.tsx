import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Github, Folder, Search, Loader2, CheckCircle2, ChevronRight } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { ScrollArea } from '../components/ui/scroll-area';

interface Repository {
  id: number;
  name: string;
  full_name: string;
  description: string;
  html_url: string;
  stargazers_count: number;
  language: string;
  updated_at: string;
  owner: {
    avatar_url: string;
  }
}

import { auth } from '../lib/firebase';
import { GithubAuthProvider, linkWithPopup } from 'firebase/auth';

export default function GitHubImport() {
  const [token, setToken] = useState<string | null>(null);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState<number | null>(null);
  const [importStatus, setImportStatus] = useState<'idle' | 'fetching' | 'cloning' | 'success'>('idle');
  const navigate = useNavigate();

  useEffect(() => {
    const ghToken = localStorage.getItem('gh_token');
    if (ghToken) {
      setToken(ghToken);
      fetchRepos(ghToken);
    }
  }, [navigate]);

  const connectGitHub = async () => {
    setLoading(true);
    try {
      const provider = new GithubAuthProvider();
      provider.addScope('repo');
      
      let result;
      if (auth.currentUser) {
        // Use linkWithPopup if logged in to avoid account-exists error
        result = await linkWithPopup(auth.currentUser, provider);
      } else {
        navigate('/auth');
        return;
      }

      const credential = GithubAuthProvider.credentialFromResult(result);
      const tk = credential?.accessToken;
      if (tk) {
        localStorage.setItem('gh_token', tk);
        setToken(tk);
        fetchRepos(tk);
        toast.success('GitHub connected successfully');
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Failed to connect GitHub');
    } finally {
      setLoading(false);
    }
  };

  const fetchRepos = async (tk: string) => {
    setLoading(true);
    try {
      const res = await fetch('https://api.github.com/user/repos?sort=updated&per_page=100', {
        headers: {
          'Authorization': `token ${tk}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      if (!res.ok) throw new Error('Failed to fetch repositories');
      const data = await res.json();
      setRepos(data);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async (repo: Repository) => {
    setImporting(repo.id);
    setImportStatus('fetching');
    
    try {
      toast.info(`Analyzing ${repo.name}...`);
      
      setImportStatus('cloning');
      toast.info('Downloading repository on server...');
      
      const importRes = await fetch('/api/import-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          repoFullName: repo.full_name,
          token: token,
          simId: repo.name 
        })
      });
      
      if (!importRes.ok) {
        const errorText = await importRes.text();
        throw new Error(`Failed to start import: ${importRes.status} ${errorText}`);
      }
      
      const uploadData = await importRes.json();
      
      setImportStatus('success');
      toast.success(`Successfully connected to ${repo.name}`);
      
      const projects = JSON.parse(localStorage.getItem('imported_projects') || '[]');
      projects.push({
        id: Date.now(),
        name: repo.name,
        fullName: repo.full_name,
        lastImport: new Date().toISOString(),
        status: 'active',
        simId: uploadData.simId
      });
      localStorage.setItem('imported_projects', JSON.stringify(projects));
      
      setTimeout(() => {
        navigate('/' + uploadData.simId);
      }, 1000);
      
    } catch (err: any) {
      toast.error(err.message);
      setImportStatus('idle');
      setImporting(null);
    }
  };

  const filteredRepos = repos.filter(r => 
    r.name.toLowerCase().includes(search.toLowerCase()) || 
    (r.description && r.description.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Import Project</h1>
          <p className="text-neutral-500">Connect your GitHub repository to start building.</p>
        </div>
        <Button variant="outline" onClick={() => fetchRepos(token!)} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Loader2 className="mr-2 h-4 w-4" />}
          Refresh List
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
            <Input 
              placeholder="Search repositories..." 
              className="pl-10"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {!token ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-4">
              <Github className="h-12 w-12 text-neutral-300" />
              <div className="text-center">
                <h3 className="font-semibold text-lg">GitHub not connected</h3>
                <p className="text-sm text-neutral-500 mb-4">Connect your GitHub account to import repositories.</p>
                <Button onClick={connectGitHub} disabled={loading}>
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Github className="mr-2 h-4 w-4" />}
                  Connect GitHub account
                </Button>
              </div>
            </div>
          ) : (
            <ScrollArea className="h-[500px] pr-4">
              {loading ? (
                <div className="flex flex-col items-center justify-center h-48 space-y-4">
                  <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
                  <p className="text-sm text-neutral-500">Loading your repositories...</p>
                </div>
              ) : filteredRepos.length > 0 ? (
                <div className="space-y-4">
                  {filteredRepos.map((repo) => (
                    <div 
                      key={repo.id}
                      className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-neutral-50 transition-colors group"
                    >
                      <div className="flex items-center space-x-4">
                        <div className="h-10 w-10 rounded-full bg-neutral-100 flex items-center justify-center border overflow-hidden">
                          {repo.owner.avatar_url ? (
                            <img src={repo.owner.avatar_url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <Folder className="h-5 w-5 text-neutral-400" />
                          )}
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center space-x-2">
                            <h3 className="font-semibold leading-none">{repo.name}</h3>
                            {repo.language && (
                              <Badge variant="secondary" className="text-[10px] uppercase py-0 px-1.5 h-4">
                                {repo.language}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-neutral-500 line-clamp-1 max-w-[300px]">
                            {repo.description || 'No description provided'}
                          </p>
                          <p className="text-[10px] text-neutral-400">
                            Updated {new Date(repo.updated_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>

                      <div>
                        {importing === repo.id ? (
                          <div className="flex items-center space-x-3 text-sm font-medium">
                            {importStatus === 'success' ? (
                              <div className="flex items-center text-green-600">
                                <CheckCircle2 className="mr-2 h-4 w-4" />
                                Success
                              </div>
                            ) : (
                              <div className="flex items-center text-neutral-600">
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                {importStatus === 'fetching' ? 'Analyzing...' : 'Taking code...'}
                              </div>
                            )}
                          </div>
                        ) : (
                          <Button 
                            size="sm" 
                            onClick={() => handleImport(repo)}
                            disabled={importing !== null}
                            className="opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            Import <ChevronRight className="ml-1 h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-48 space-y-2">
                  <Github className="h-12 w-12 text-neutral-200" />
                  <p className="font-medium text-neutral-500">No repositories found</p>
                  <p className="text-sm text-neutral-400">Try searching for something else or refresh the list.</p>
                </div>
              )}
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
